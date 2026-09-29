"use server";

import { revalidatePath } from "next/cache";

import { and, eq, inArray, isNull, or } from "drizzle-orm";

import { invoices, sdiSettings } from "@/db/schema";
import { requireCapability, requirePlanModule } from "@/lib/auth-guard";
import { serverT } from "@/lib/i18n-server";
import { tolerateUnmigrated } from "@/lib/schema-ready";
import { sdiChannels, sdiProvider } from "@/lib/sdi/registry";
import { contextFor, readSdiSettings, refreshSdiStatus, type SendResult, sendToSdi } from "@/lib/sdi/transmit";
import type { SdiChannel, SdiEnvironment } from "@/lib/sdi/types";
import { getDb } from "@/lib/tenant-context";
import { encryptSecret } from "@/lib/tenant-db";

/**
 * Sending issued invoices to SDI through the workspace's intermediary (src/lib/sdi/): the
 * settings, the check of the credentials, the send, and asking for the status now.
 *
 * ⚠️ Handing a file to the tax authority is issuing's permission (`invoice:issue`), not the
 * editor's: an invoice that reached SDI cannot be taken back.
 */

type Outcome = { ok: true } | { ok: false; error: string };

async function say(key: string, values?: Record<string, string>): Promise<string> {
  return (await serverT("serverErrors.sdi"))(key, values);
}

/** The settings as the screen shows them: never the password, only whether there is one. */
export async function getSdiSettings() {
  await requireCapability("invoicing:manage");
  const db = await getDb();
  const row = await tolerateUnmigrated("sdi settings", () => readSdiSettings(db), null);
  return {
    channel: (row?.channel ?? "manual") as SdiChannel,
    environment: (row?.environment === "production" ? "production" : "demo") as SdiEnvironment,
    username: row?.username ?? "",
    accountId: row?.accountId ?? "",
    hasPassword: Boolean(row?.password),
    autoSend: row?.autoSend ?? false,
    channels: sdiChannels(),
  };
}

export async function saveSdiSettings(input: {
  channel: string;
  environment: string;
  username?: string;
  /** The password or the access token. Empty keeps the one held. */
  password?: string;
  /** The account inside the intermediary (Fatture in Cloud's company id). */
  accountId?: string;
  autoSend?: boolean;
}): Promise<Outcome> {
  const actor = await requireCapability("invoicing:manage");
  const db = await getDb();
  const channel = input.channel === "manual" || sdiProvider(input.channel) ? input.channel : null;
  if (!channel) return { ok: false, error: await say("channelInvalid") };
  const environment = input.environment === "production" ? "production" : "demo";
  const needs = sdiProvider(channel)?.credentials ?? [];
  const username = needs.includes("username") ? (input.username ?? "").trim().slice(0, 200) || null : null;
  const accountId = needs.includes("accountId") ? (input.accountId ?? "").trim().slice(0, 50) || null : null;
  const password = (input.password ?? "").trim();
  const before = await readSdiSettings(db);
  if (needs.includes("username") && !username) return { ok: false, error: await say("usernameRequired") };
  if (channel !== "manual" && !password && !before?.password)
    return { ok: false, error: await say("passwordRequired") };

  // Another account, system or intermediary: the token held belongs to the old one.
  const sameAccount =
    before?.channel === channel && before?.environment === environment && before?.username === username && !password;
  // Another intermediary: the password or token held is the old one's, and never another's.
  if (before?.password && before.channel !== channel && !password && channel !== "manual")
    return { ok: false, error: await say("passwordRequired") };
  const values = {
    channel,
    environment,
    username,
    accountId,
    ...(password ? { password: encryptSecret(password) } : {}),
    ...(sameAccount ? {} : { accessToken: null, accessExpiresAt: null, refreshToken: null, refreshExpiresAt: null }),
    // Sending by itself only through an intermediary.
    autoSend: channel !== "manual" && Boolean(input.autoSend),
    updatedBy: actor.userId,
    updatedAt: new Date(),
  };
  await db
    .insert(sdiSettings)
    .values({ id: "workspace", ...values })
    .onConflictDoUpdate({ target: sdiSettings.id, set: values });
  revalidatePath("/dashboard/settings/invoicing");
  return { ok: true };
}

/**
 * Signs in with the saved credentials, sending nothing. Where the token reaches accounts and none
 * is chosen (Fatture in Cloud's companies), the only one is taken; several are listed to choose.
 */
export async function testSdiConnection(): Promise<Outcome> {
  await requireCapability("invoicing:manage");
  const db = await getDb();
  const found = contextFor(db, await readSdiSettings(db), fetch, undefined, { accountOptional: true });
  if ("reason" in found) return { ok: false, error: await say(found.reason) };
  const checked = await found.provider.check(found.ctx);
  if (!checked.ok) return { ok: false, error: await say(checked.reason, { detail: checked.message }) };
  if (found.provider.credentials.includes("accountId") && !found.ctx.accountId) {
    const accounts = checked.accounts ?? [];
    if (accounts.length !== 1)
      return {
        ok: false,
        error: await say("account", { detail: accounts.map((a) => `${a.id} (${a.name})`).join(", ") }),
      };
    await db.update(sdiSettings).set({ accountId: accounts[0].id }).where(eq(sdiSettings.id, "workspace"));
    revalidatePath("/dashboard/settings/invoicing");
  }
  return { ok: true };
}

function refresh(invoiceId: string) {
  revalidatePath(`/dashboard/sales/invoices/${invoiceId}`);
  revalidatePath("/dashboard/sales/invoices");
}

async function sendError(result: Extract<SendResult, { ok: false }>): Promise<string> {
  return say(result.reason, { detail: result.message ?? "" });
}

/** Hands an issued invoice to the intermediary. */
export async function sendInvoiceToSdi(invoiceId: string): Promise<Outcome> {
  await requireCapability("invoice:issue");
  await requirePlanModule("sales");
  const db = await getDb();
  const result = await sendToSdi(db, invoiceId);
  refresh(invoiceId);
  return result.ok ? { ok: true } : { ok: false, error: await sendError(result) };
}

/** Asks the intermediary now, instead of waiting for the job. */
export async function refreshInvoiceSdiStatus(invoiceId: string): Promise<Outcome> {
  await requireCapability("invoice:write");
  await requirePlanModule("sales");
  const db = await getDb();
  const [invoice] = await db
    .select({
      id: invoices.id,
      sdiStatus: invoices.sdiStatus,
      sdiChannel: invoices.sdiChannel,
      sdiFileName: invoices.sdiFileName,
      sdiRef: invoices.sdiRef,
      sdiSentAt: invoices.sdiSentAt,
    })
    .from(invoices)
    .where(eq(invoices.id, invoiceId));
  if (!invoice) return { ok: false, error: await say("not_sendable") };
  const found = contextFor(db, await readSdiSettings(db));
  if ("reason" in found) return { ok: false, error: await say(found.reason) };
  await refreshSdiStatus(db, invoice, found);
  refresh(invoiceId);
  return { ok: true };
}

/**
 * The workspace sent the file itself (the Agenzia's portal, another intermediary): recorded so
 * the page stops asking for it. Only while nothing was handed over from here.
 */
export async function markSentManually(invoiceId: string): Promise<Outcome> {
  await requireCapability("invoice:issue");
  await requirePlanModule("sales");
  const db = await getDb();
  const [done] = await db
    .update(invoices)
    .set({ sdiStatus: "sent_manually", sdiChannel: "manual", sdiStatusAt: new Date(), sdiMessage: null })
    .where(
      and(
        eq(invoices.id, invoiceId),
        eq(invoices.status, "issued"),
        or(isNull(invoices.sdiStatus), inArray(invoices.sdiStatus, ["send_failed", "error"])),
      ),
    )
    .returning({ id: invoices.id });
  refresh(invoiceId);
  return done ? { ok: true } : { ok: false, error: await say("not_sendable") };
}
