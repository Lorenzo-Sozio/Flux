import { createHash } from "node:crypto";

import { and, asc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { invoices, sdiSettings } from "@/db/schema";
import type { transmissionFile } from "@/lib/invoice-archive";
import { decryptSecret, encryptSecret } from "@/lib/tenant-db";

import { sdiProvider } from "./registry";
import { laterStatus, maySend, needsAttention, STATUS_WATCH_DAYS } from "./status";
import type { FetchLike, HeldToken, SdiContext, SdiEnvironment, SdiProvider, SdiStatus } from "./types";

/**
 * Handing issued invoices to the workspace's intermediary, and reading back what SDI said.
 *
 * ⚠️⚠️ **The claim decides who sends.** An invoice goes to `sending` by a conditional update
 * that applies only while nothing valid reached SDI (`maySend`); a double click, the automatic
 * send after issue and a colleague on the same page cannot hand the same file over twice — a
 * second copy would reach SDI as a duplicate and be discarded, and the first one's status with
 * it.
 *
 * ⚠️⚠️ **The file is the one frozen at issue**, with the intermediary's IdTrasmittente frozen
 * on the invoice by the claim (`sdi_transmitter`), and its SHA-256 kept: the XML downloaded
 * later is rebuilt from the same snapshots and must be the same bytes.
 *
 * ⚠️ A send that dies between the claim and the answer leaves `sending`; after
 * `STALE_SENDING_MINUTES` the job marks it `send_failed` and says to look at the
 * intermediary's portal before sending again — whether the file got there is unknown.
 */

// biome-ignore lint/suspicious/noExplicitAny: a tenant handle, from getDb or createTenantDb
type Db = any;
type Invoice = typeof invoices.$inferSelect;
type Settings = typeof sdiSettings.$inferSelect;

export const STALE_SENDING_MINUTES = 15;
/** Invoices asked about per workspace per run: Aruba allows twelve status reads a minute per address. */
export const STATUS_PER_RUN = 10;

export async function readSdiSettings(db: Db): Promise<Settings | null> {
  const [row] = await db.select().from(sdiSettings).where(eq(sdiSettings.id, "workspace"));
  return row ?? null;
}

function open(stored: string | null): string | null {
  if (!stored) return null;
  try {
    return decryptSecret(stored);
  } catch {
    // A token encrypted under a key since rotated: a new sign-in replaces it.
    return null;
  }
}

/** The provider and what it needs, or why there is none. */
export function contextFor(
  db: Db,
  settings: Settings | null,
  fetchImpl: FetchLike = fetch,
  now?: () => Date,
  /** Checking the credentials: the account is what the check finds, not what it needs. */
  options: { accountOptional?: boolean } = {},
): { provider: SdiProvider; ctx: SdiContext } | { reason: "manual" | "not_configured" } {
  const provider = sdiProvider(settings?.channel);
  if (!settings || !provider) return { reason: "manual" };
  const password = open(settings.password);
  // What this provider signs in with (a username and password; a token and a company): all of it.
  const needs = provider.credentials;
  if (
    !password ||
    (needs.includes("username") && !settings.username) ||
    (needs.includes("accountId") && !settings.accountId && !options.accountOptional)
  )
    return { reason: "not_configured" };
  const access = open(settings.accessToken);
  const token: HeldToken | null =
    access && settings.accessExpiresAt
      ? {
          accessToken: access,
          accessExpiresAt: settings.accessExpiresAt,
          refreshToken: open(settings.refreshToken),
          refreshExpiresAt: settings.refreshExpiresAt,
        }
      : null;
  return {
    provider,
    ctx: {
      environment: (settings.environment === "production" ? "production" : "demo") as SdiEnvironment,
      username: settings.username ?? "",
      password,
      accountId: settings.accountId ?? null,
      token,
      fetch: fetchImpl,
      now,
      saveToken: async (t) => {
        await db
          .update(sdiSettings)
          .set({
            accessToken: encryptSecret(t.accessToken),
            accessExpiresAt: t.accessExpiresAt,
            refreshToken: t.refreshToken ? encryptSecret(t.refreshToken) : null,
            refreshExpiresAt: t.refreshExpiresAt,
          })
          .where(eq(sdiSettings.id, "workspace"));
      },
    },
  };
}

/**
 * At issue, before the files are archived: an invoice of a workspace that sends through an
 * intermediary is built with the intermediary's transmitter from the start, so the XML archived,
 * the XML downloaded and the XML sent are one file. Returns whether it is to be sent at once.
 */
export async function prepareForSdi(db: Db, invoiceId: string): Promise<{ autoSend: boolean }> {
  const settings = await readSdiSettings(db);
  const provider = sdiProvider(settings?.channel);
  if (!settings || !provider) return { autoSend: false };
  // An intermediary that builds its own file (Fatture in Cloud) needs nothing frozen here.
  if (provider.transmitter)
    await db
      .update(invoices)
      .set({ sdiTransmitter: provider.transmitter })
      .where(and(eq(invoices.id, invoiceId), isNull(invoices.sdiStatus)));
  return { autoSend: settings.autoSend };
}

export type SendResult =
  | { ok: true; status: SdiStatus; fileName: string }
  | {
      ok: false;
      reason: "manual" | "not_configured" | "not_sendable" | "auth" | "invalid" | "unavailable" | "rate_limited";
      message?: string;
    };

/**
 * Hands one issued invoice to the intermediary.
 *
 * Claimed first, built from the snapshots with the intermediary's transmitter, sent, and the
 * answer written back: `pending` with the intermediary's file name, or `send_failed` with its
 * words.
 */
export async function sendToSdi(
  db: Db,
  invoiceId: string,
  options: { fetch?: FetchLike; now?: () => Date } = {},
): Promise<SendResult> {
  const settings = await readSdiSettings(db);
  const found = contextFor(db, settings, options.fetch, options.now);
  if ("reason" in found) return { ok: false, reason: found.reason };
  const { provider, ctx } = found;
  const now = options.now?.() ?? new Date();

  const [claimed]: Invoice[] = await db
    .update(invoices)
    .set({
      sdiStatus: "sending",
      sdiChannel: provider.id,
      sdiTransmitter: provider.transmitter,
      sdiRef: null,
      sdiSentXml: null,
      sdiStatusAt: now,
      sdiMessage: null,
    })
    .where(
      and(
        eq(invoices.id, invoiceId),
        eq(invoices.status, "issued"),
        or(isNull(invoices.sdiStatus), inArray(invoices.sdiStatus, ["send_failed", "error"])),
      ),
    )
    .returning();
  if (!claimed) return { ok: false, reason: "not_sendable" };

  let file: Awaited<ReturnType<typeof transmissionFile>>;
  try {
    // ⚠️ Loaded only here, where a file is built: the archive brings the PDF library, and every
    // page and job that imports this module for the settings or the statuses would carry a copy of
    // it — Next bundles per route, and the Worker's 10 MB had 264 KiB left.
    const { transmissionFile: build } = await import("@/lib/invoice-archive");
    file = await build(db, claimed);
  } catch (err) {
    await db
      .update(invoices)
      .set({ sdiStatus: "send_failed", sdiMessage: err instanceof Error ? err.message : String(err), sdiStatusAt: now })
      .where(eq(invoices.id, invoiceId));
    return { ok: false, reason: "invalid", message: err instanceof Error ? err.message : String(err) };
  }

  const sent = await provider.send(ctx, { name: file.name, xml: file.xml, document: file.document });
  if (!sent.ok) {
    await db
      .update(invoices)
      .set({ sdiStatus: "send_failed", sdiMessage: sent.message, sdiStatusAt: now })
      .where(and(eq(invoices.id, invoiceId), eq(invoices.sdiStatus, "sending")));
    return { ok: false, reason: sent.reason, message: sent.message };
  }
  await db
    .update(invoices)
    .set({
      sdiStatus: "pending",
      sdiFileName: sent.fileName,
      sdiRef: sent.ref ?? null,
      // The intermediary's own file when it built one (Fatture in Cloud): the XML Flux serves from now on.
      sdiSentXml: sent.sentXml ?? null,
      sdiFileSha256: sent.sentXml ? createHash("sha256").update(sent.sentXml, "utf8").digest("hex") : file.sha256,
      sdiSentAt: now,
      sdiStatusAt: now,
      sdiMessage: null,
    })
    .where(and(eq(invoices.id, invoiceId), eq(invoices.sdiStatus, "sending")));
  return { ok: true, status: "pending", fileName: sent.fileName };
}

export type StatusChange = { invoiceId: string; from: SdiStatus | null; to: SdiStatus; message: string | null };

/** Asks the intermediary about one invoice handed over earlier; writes a status only forward. */
export async function refreshSdiStatus(
  db: Db,
  invoice: Pick<Invoice, "id" | "sdiStatus" | "sdiChannel" | "sdiFileName" | "sdiRef" | "sdiSentAt">,
  found: { provider: SdiProvider; ctx: SdiContext },
  now = new Date(),
): Promise<StatusChange | null> {
  if ((!invoice.sdiFileName && !invoice.sdiRef) || invoice.sdiChannel !== found.provider.id) return null;
  const answer = await found.provider.status(found.ctx, {
    fileName: invoice.sdiFileName,
    ref: invoice.sdiRef,
    sentAt: invoice.sdiSentAt,
  });
  if (!answer.ok) {
    await db.update(invoices).set({ sdiCheckedAt: now }).where(eq(invoices.id, invoice.id));
    return null;
  }
  const from = (invoice.sdiStatus ?? null) as SdiStatus | null;
  if (answer.status === from || !laterStatus(from, answer.status)) {
    await db.update(invoices).set({ sdiCheckedAt: now }).where(eq(invoices.id, invoice.id));
    return null;
  }
  // Conditional on the status read: two runs crossing write the change once.
  const [written] = await db
    .update(invoices)
    .set({
      sdiStatus: answer.status,
      sdiId: answer.sdiId,
      sdiMessage: answer.message,
      sdiStatusAt: now,
      sdiCheckedAt: now,
    })
    .where(and(eq(invoices.id, invoice.id), from === null ? isNull(invoices.sdiStatus) : eq(invoices.sdiStatus, from)))
    .returning({ id: invoices.id });
  return written ? { invoiceId: invoice.id, from, to: answer.status, message: answer.message } : null;
}

/**
 * One run of the job for one workspace: the invoices still waiting for SDI's word, the longest
 * unasked first, at most `STATUS_PER_RUN`; and sends interrupted long enough ago to be failed.
 * Returns the changes, so the caller can tell whoever issued them.
 */
export async function pollSdiStatuses(
  db: Db,
  options: { fetch?: FetchLike; now?: Date } = {},
): Promise<{ checked: number; changes: StatusChange[]; interrupted: number }> {
  const now = options.now ?? new Date();
  const interrupted: { id: string }[] = await db
    .update(invoices)
    .set({
      sdiStatus: "send_failed",
      sdiMessage: "interrupted",
      sdiStatusAt: now,
    })
    .where(
      and(
        eq(invoices.sdiStatus, "sending"),
        lt(invoices.sdiStatusAt, new Date(now.getTime() - STALE_SENDING_MINUTES * 60_000)),
      ),
    )
    .returning({ id: invoices.id });

  const found = contextFor(db, await readSdiSettings(db), options.fetch, () => now);
  if ("reason" in found) return { checked: 0, changes: [], interrupted: interrupted.length };

  const watchFrom = new Date(now.getTime() - STATUS_WATCH_DAYS * 86_400_000);
  const open: Pick<Invoice, "id" | "sdiStatus" | "sdiChannel" | "sdiFileName" | "sdiRef" | "sdiSentAt">[] = await db
    .select({
      id: invoices.id,
      sdiStatus: invoices.sdiStatus,
      sdiChannel: invoices.sdiChannel,
      sdiFileName: invoices.sdiFileName,
      sdiRef: invoices.sdiRef,
      sdiSentAt: invoices.sdiSentAt,
    })
    .from(invoices)
    .where(
      and(
        // Waiting for SDI; or delivered to a public administration, which still has to answer
        // (a six-character recipient code, `isPublicAdministration`). ⚠️ In the query, not after
        // it: a delivered B2B invoice left among the candidates would never be asked about, keep
        // its place at the front, and crowd out the ones that are waiting.
        or(
          eq(invoices.sdiStatus, "pending"),
          and(
            eq(invoices.sdiStatus, "delivered"),
            sql`length(trim(coalesce(${invoices.customerSnapshot} ->> 'sdiCode', ''))) = 6`,
          ),
        ),
        eq(invoices.sdiChannel, found.provider.id),
        gte(invoices.sdiSentAt, watchFrom),
      ),
    )
    .orderBy(sql`${invoices.sdiCheckedAt} asc nulls first`, asc(invoices.sdiSentAt))
    .limit(STATUS_PER_RUN);

  const toAsk = open;
  const changes: StatusChange[] = [];
  for (const invoice of toAsk) {
    const change = await refreshSdiStatus(db, invoice, found, now);
    if (change) changes.push(change);
  }
  return { checked: toAsk.length, changes, interrupted: interrupted.length };
}

/** Changes somebody has to hear about: the ones that need a person. */
export function changesToTell(changes: StatusChange[]): StatusChange[] {
  return changes.filter((c) => needsAttention(c.to));
}

export { maySend };
