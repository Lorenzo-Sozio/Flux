/**
 * What a connected mailbox brings into the CRM, every ten minutes inside `email-worker`
 * (V3.2): the mail exchanged with contacts and open leads, filed on their timelines, and
 * the person's busy time, so the booking page and the colleague picker stop offering a
 * slot that is taken at Google or Microsoft.
 *
 * ⚠️⚠️ **Only what matches is kept.** A message is filed through the same function as the
 * Bcc archive (src/lib/mail-archive.ts): on the contacts and open leads among its sender,
 * To and Cc, and nowhere else. A message that matches nobody is read and forgotten — no row,
 * no stub contact, no copy of somebody's private mail in a customer database.
 *
 * ⚠️⚠️ **One budget for the whole run.** The job opens every workspace in one request, and on
 * Workers a request has a thousand subrequests. Each provider call and each database
 * statement is charged against `budget`; the connections read longest ago go first, so a
 * mailbox skipped this run is first in the next one. The charge is an estimate — erring high.
 *
 * ⚠️ A reply that arrives in the person's own mailbox stops their sequences, as one to the
 * workspace's inbound address does: with a connected mailbox, that is where replies land.
 * It opens no task — the person already has it in front of them.
 */
import { asc, eq, sql } from "drizzle-orm";

import { mailBusy, mailConnections } from "@/db/schema";
import { archiveDomain, fileArchivedEmail } from "@/lib/mail-archive";
import {
  accessTokenFor,
  disconnectMailbox,
  type MailConnectionRow,
  recordConnectionError,
} from "@/lib/mail-connection";
import { providerFor } from "@/lib/mail-providers/registry";
import { type FetchLike, type MailProvider, ProviderError } from "@/lib/mail-providers/types";
import { tolerateUnmigrated } from "@/lib/schema-ready";
import { stopOnReply } from "@/lib/sequence-runner";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle's database types differ per driver
type AnyDb = any;

/** Messages read per mailbox per run: ten minutes of anybody's mail, and then some. */
export const MAIL_SYNC_PER_CONNECTION = 20;
/** Subrequests the whole run may spend on mailboxes, across every workspace. */
export const MAIL_SYNC_BUDGET = 400;
/**
 * And one workspace at most this much of it: workspaces are opened oldest first, and with
 * no cap the busiest early ones spent it all, every run — the rest were never read, until
 * Gmail forgot their cursor and that mail was skipped for good.
 */
export const MAIL_SYNC_PER_WORKSPACE = 120;
/** Busy time is read again after this long, for this many days ahead. */
export const BUSY_REFRESH_MINUTES = 30;
export const BUSY_DAYS_AHEAD = 45;

/** What a filed message costs: two lookups and one insert. */
const PER_MESSAGE = 3;

export interface SyncBudget {
  readonly left: number;
  take(n: number): boolean;
  /** Hands back what was reserved and not spent. */
  give(n: number): void;
}

export function syncBudget(total = MAIL_SYNC_BUDGET): SyncBudget {
  let left = total;
  return {
    get left() {
      return left;
    },
    take(n) {
      if (n > left) return false;
      left -= n;
      return true;
    },
    give(n) {
      left += Math.max(0, n);
    },
  };
}

/** A share of `parent` no larger than `cap`: what it takes, the parent loses too. */
export function cappedBudget(parent: SyncBudget, cap: number): SyncBudget {
  let spent = 0;
  return {
    get left() {
      return Math.max(0, Math.min(parent.left, cap - spent));
    },
    take(n) {
      if (n > this.left || !parent.take(n)) return false;
      spent += n;
      return true;
    },
    give(n) {
      const back = Math.max(0, Math.min(n, spent));
      spent -= back;
      parent.give(back);
    },
  };
}

export interface MailSyncResult {
  connections: number;
  filed: number;
  busyBlocks: number;
  skipped: number;
  /** Connections of people who may no longer write here, disconnected. */
  removed: number;
}

export async function syncMailboxes(
  db: AnyDb,
  input: {
    budget: SyncBudget;
    /**
     * ⚠️⚠️ Who may still write in this workspace, asked only when there is a mailbox to read.
     * A connection outlives a membership: without this, a departed colleague's own mailbox
     * went on being read into the old workspace every ten minutes, and they could no longer
     * reach the button that stops it.
     */
    writers: () => Promise<readonly string[]>;
    now?: Date;
    env?: Record<string, string | undefined>;
    fetchImpl?: FetchLike;
  },
): Promise<MailSyncResult> {
  const now = input.now ?? new Date();
  const result: MailSyncResult = { connections: 0, filed: 0, busyBlocks: 0, skipped: 0, removed: 0 };
  const rows: MailConnectionRow[] = await db
    .select()
    .from(mailConnections)
    .where(eq(mailConnections.status, "active"))
    .orderBy(asc(sql`coalesce(${mailConnections.mailSyncedAt}, 'epoch'::timestamp)`));
  if (rows.length === 0) return result;
  const writers = new Set(await input.writers());
  const budget = cappedBudget(input.budget, MAIL_SYNC_PER_WORKSPACE);
  // The address the archive answers on is never a participant worth filing under.
  const domain = archiveDomain() ?? "archive.invalid";

  for (const conn of rows) {
    const provider = providerFor(conn.provider as MailProvider["id"], input.env, input.fetchImpl);
    if (!writers.has(conn.userId)) {
      // Gone from the workspace, or read-only now: the grant is withdrawn and the row forgotten.
      await disconnectMailbox(db, conn.userId, provider).catch((err) =>
        console.error("[mail-sync] could not remove a former member's mailbox:", err),
      );
      result.removed++;
      continue;
    }
    // A token refresh, a read and a cursor write — and room for one message, or the turn
    // would be spent on reading nothing and the mailbox would lose its place in line.
    if (budget.left < 3 + PER_MESSAGE + 1 || !budget.take(3)) {
      result.skipped++;
      continue;
    }
    // Credentials removed since it was connected: dormant, not broken.
    if (!provider) continue;
    try {
      // Inside the try: a token that will not decrypt is this mailbox's problem, not the
      // workspace's — outside it, one row stopped every other mailbox behind it, every run.
      const token = await accessTokenFor(db, conn, provider, now);
      if (!token) continue;
      result.connections++;
      result.filed += await readMail(db, conn, provider, token, domain, budget, now);
      result.busyBlocks += await readBusy(db, conn, provider, token, budget, now);
    } catch (err) {
      console.error(
        `[mail-sync] ${conn.provider} mailbox of ${conn.userId}:`,
        err instanceof Error ? err.message : err,
      );
      await recordConnectionError(db, conn.id, err, now);
    }
  }
  return result;
}

async function readMail(
  db: AnyDb,
  conn: MailConnectionRow,
  provider: MailProvider,
  token: string,
  domain: string,
  budget: SyncBudget,
  now: Date,
): Promise<number> {
  let cursor = conn.mailCursor;
  if (!cursor) cursor = await provider.startCursor(token, now);
  const affordable = Math.min(MAIL_SYNC_PER_CONNECTION, Math.floor(budget.left / (PER_MESSAGE + 1)));
  if (affordable < 1) return 0;
  // ⚠️ Reserved before the read, not charged after it: workspaces run side by side, and each
  // used to plan against the same "left" and spend it several times over.
  const reserved = affordable * (PER_MESSAGE + 1);
  budget.take(reserved);

  let page: Awaited<ReturnType<MailProvider["messagesSince"]>>;
  try {
    page = await provider.messagesSince(token, cursor, affordable);
  } catch (err) {
    budget.give(reserved);
    if (err instanceof ProviderError && err.cursorExpired) {
      // Too far behind for the provider to say what changed: carry on from now.
      await db
        .update(mailConnections)
        .set({ mailCursor: await provider.startCursor(token, now), mailSyncedAt: now })
        .where(eq(mailConnections.id, conn.id));
      return 0;
    }
    throw err;
  }

  let filed = 0;
  let spent = page.calls ?? page.messages.length;
  const own = conn.email.toLowerCase();
  for (const m of page.messages) {
    // One message that cannot be filed is logged and passed: stopping on it would stop the
    // cursor on it, and the mailbox would never be read again.
    try {
      spent += PER_MESSAGE;
      const done = await fileArchivedEmail(
        db,
        conn.userId,
        {
          from: m.from,
          to: m.to.join(", "),
          cc: m.cc.join(", "),
          subject: m.subject,
          text: m.text,
          messageId: m.messageId,
        },
        domain,
        m.date,
      );
      filed += done.filed;
      if (m.from !== own && done.matched > 0) {
        spent += 1;
        // Only sequences that were writing to them when they wrote: a message read again, or
        // read late, is not a reply to an enrollment made after it.
        await tolerateUnmigrated("sequences", () => stopOnReply(db, m.from, now, m.date), 0);
      }
    } catch (err) {
      console.error(`[mail-sync] message ${m.messageId} not filed:`, err instanceof Error ? err.message : err);
    }
  }
  if (spent < reserved) budget.give(reserved - spent);
  else budget.take(Math.min(spent - reserved, budget.left));

  await db
    .update(mailConnections)
    .set({ mailCursor: page.cursor, mailSyncedAt: now, lastError: null, lastErrorAt: null })
    .where(eq(mailConnections.id, conn.id));
  return filed;
}

async function readBusy(
  db: AnyDb,
  conn: MailConnectionRow,
  provider: MailProvider,
  token: string,
  budget: SyncBudget,
  now: Date,
): Promise<number> {
  if (conn.busySyncedAt && now.getTime() - conn.busySyncedAt.getTime() < BUSY_REFRESH_MINUTES * 60_000) return 0;
  // Calendar access unticked at the consent screen: nothing to read, and no error to repeat.
  if (conn.scopes && !/calendar/i.test(conn.scopes)) return 0;
  // Up to three pages at Microsoft, then a delete, an insert and a stamp.
  if (!budget.take(6)) return 0;
  const to = new Date(now.getTime() + BUSY_DAYS_AHEAD * 86_400_000);
  const blocks = (await provider.busy(token, now, to)).filter((b) => b.end.getTime() > b.start.getTime());
  await replaceBusy(db, conn, blocks, now);
  return blocks.length;
}

/** The connection's busy time, replaced whole: what the provider says now is all there is. */
export async function replaceBusy(
  db: AnyDb,
  conn: Pick<MailConnectionRow, "id" | "userId">,
  blocks: { start: Date; end: Date }[],
  now: Date,
): Promise<void> {
  const statements = [
    db.delete(mailBusy).where(eq(mailBusy.connectionId, conn.id)),
    ...(blocks.length
      ? [
          db
            .insert(mailBusy)
            .values(
              blocks.map((b) => ({ connectionId: conn.id, userId: conn.userId, startAt: b.start, endAt: b.end })),
            ),
        ]
      : []),
    db.update(mailConnections).set({ busySyncedAt: now }).where(eq(mailConnections.id, conn.id)),
  ];
  // Atomic where the driver can batch: a reader never sees the time half replaced.
  if (typeof db.batch === "function") await db.batch(statements);
  else
    await db.transaction(async (tx: AnyDb) => {
      await tx.delete(mailBusy).where(eq(mailBusy.connectionId, conn.id));
      if (blocks.length) {
        await tx
          .insert(mailBusy)
          .values(blocks.map((b) => ({ connectionId: conn.id, userId: conn.userId, startAt: b.start, endAt: b.end })));
      }
      await tx.update(mailConnections).set({ busySyncedAt: now }).where(eq(mailConnections.id, conn.id));
    });
}
