import "server-only";

import { and, eq, lt } from "drizzle-orm";

import type { createTenantDb } from "@/db";
import { apiIdempotency } from "@/db/schema";

/**
 * Making a retried request safe to send.
 *
 * ⚠️ The import routes report everything: created, updated, skipped, and the
 * field-level reason for each rejected row. All of it depends on the response
 * arriving. When it does not — a timeout, a dropped connection, a phone leaving
 * a tunnel — the caller knows nothing, and their only move is to send the batch
 * again. Contacts and leads deduplicate on email alone, email is optional for
 * both, and the activity routes deduplicate on nothing, so that second attempt
 * duplicates their data. This is what makes the retry safe.
 *
 * The stored response is the point. A repeat of a finished request gets the
 * original answer, ids and all, rather than a fresh import or a bare
 * acknowledgement.
 *
 * Opt-in: no header, no row, and the route behaves exactly as it did. A caller
 * who sends no key is in the position they were always in.
 */

type TenantDb = ReturnType<typeof createTenantDb>;

/** How long a request may be in flight before another may take its key over. */
const STALE_AFTER_MS = 15 * 60 * 1000;

/** The longest key we store. Room for a UUID and then some. */
const MAX_KEY_LENGTH = 255;

export type Claim =
  /** Nobody sent a key. Carry on exactly as before, and store nothing. */
  | { kind: "unkeyed" }
  /** This request owns the key and should do the work. */
  | { kind: "proceed"; key: string; endpoint: string }
  /** Already answered. Send this body back rather than importing anything. */
  | { kind: "replay"; body: unknown }
  /** The same key is in flight somewhere else, right now. */
  | { kind: "in-flight" }
  /** The same key, a different body. */
  | { kind: "mismatch" };

/**
 * What `decide` concluded about a row somebody else holds.
 *
 * ⚠️ Deliberately not a `Claim`. `stale` means "no living request is behind this
 * row", which is a reason to *try* to take the key, not permission to act as
 * though it were held. Returning a `Claim` here would hand the caller something
 * that looks usable and names no key, and `remember` would then write the answer
 * against an empty one.
 */
export type Verdict =
  | { kind: "replay"; body: unknown }
  | { kind: "in-flight" }
  | { kind: "mismatch" }
  | { kind: "stale" };

/** What the stored row says, as far as the decision is concerned. */
export interface StoredAttempt {
  requestHash: string;
  status: string;
  response: string | null;
  createdAt: Date;
}

/**
 * What to do about a key somebody else already holds.
 *
 * ⚠️ Pure, and separate from the statements around it, because this is the part
 * where being wrong is expensive and invisible. Answering `replay` to a request
 * that was never finished loses an import; answering `proceed` to one that is
 * still running duplicates it; answering `replay` to a *different* body reports
 * somebody else's result as this caller's own, which is worse than either
 * because it looks like it worked.
 *
 * Returns `stale` only for a row too old to belong to a living request. The
 * caller still has to win the swap before acting on it.
 */
export function decide(row: StoredAttempt, requestHash: string, now: Date): Verdict {
  if (row.requestHash !== requestHash) return { kind: "mismatch" };

  if (row.status === "done") {
    // A row marked done with nothing stored is a bug on our side, and not a
    // reason to import the batch a second time.
    return { kind: "replay", body: row.response ? safeParse(row.response) : null };
  }

  // ⚠️ Still running, as far as anything here can tell. Taking it over now would
  // run the import twice.
  if (now.getTime() - row.createdAt.getTime() < STALE_AFTER_MS) return { kind: "in-flight" };

  // Old enough that the request behind it cannot plausibly be alive: a handler
  // died, and refusing for ever would brick the key while the caller's obvious
  // next move is to retry with it.
  return { kind: "stale" };
}

/** SHA-256 of the request body, hex, so two bodies can be told apart. */
export async function hashBody(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Claims the key for this request, or reports who got there first.
 *
 * ⚠️⚠️ **The write is the mutual exclusion, and it has to be.** The Neon HTTP
 * driver holds no session, so there is no transaction and no lock to separate
 * two copies of the same request arriving together. `INSERT … ON CONFLICT DO
 * NOTHING … RETURNING` says exactly one thing that reading cannot: whether *this*
 * statement created the row. Reading first and then inserting would let both
 * copies read nothing and both import.
 *
 * The same applies to taking a stale key over, which is why that is a
 * compare-and-swap on the timestamp rather than a read followed by a write.
 */
export async function claim(
  db: TenantDb,
  endpoint: string,
  key: string | null,
  requestHash: string,
  now = new Date(),
): Promise<Claim> {
  const trimmed = key?.trim().slice(0, MAX_KEY_LENGTH);
  if (!trimmed) return { kind: "unkeyed" };

  const mine = await db
    .insert(apiIdempotency)
    .values({ key: trimmed, endpoint, requestHash, status: "in_progress", createdAt: now })
    .onConflictDoNothing()
    .returning({ key: apiIdempotency.key });

  if (mine.length > 0) return { kind: "proceed", key: trimmed, endpoint };

  // Somebody else's row. What it says decides the answer.
  const [row] = await db
    .select({
      requestHash: apiIdempotency.requestHash,
      status: apiIdempotency.status,
      response: apiIdempotency.response,
      createdAt: apiIdempotency.createdAt,
    })
    .from(apiIdempotency)
    .where(and(eq(apiIdempotency.endpoint, endpoint), eq(apiIdempotency.key, trimmed)));

  // The insert found a conflict, so the row exists; if it has gone between the
  // two statements, somebody released it. Refusing is the safe answer — the one
  // thing that must not happen is carrying on as though no key had been sent.
  if (!row) return { kind: "in-flight" };

  const verdict = decide(row, requestHash, now);
  if (verdict.kind !== "stale") return verdict;

  // ⚠️ `decide` said the row is stale, not that this request may have it. The
  // swap is conditional on the timestamp nobody else has moved, so two takeovers
  // racing produce exactly one winner — which reading and then writing could not.
  const won = await db
    .update(apiIdempotency)
    .set({ createdAt: now, requestHash })
    .where(
      and(
        eq(apiIdempotency.endpoint, endpoint),
        eq(apiIdempotency.key, trimmed),
        eq(apiIdempotency.createdAt, row.createdAt),
      ),
    )
    .returning({ key: apiIdempotency.key });

  return won.length > 0 ? { kind: "proceed", key: trimmed, endpoint } : { kind: "in-flight" };
}

/** Stores the answer, so a repeat gets this and not a second import. */
export async function remember(db: TenantDb, claimed: Claim, body: unknown, now = new Date()): Promise<void> {
  if (claimed.kind !== "proceed") return;
  await db
    .update(apiIdempotency)
    .set({ status: "done", response: JSON.stringify(body), completedAt: now })
    .where(and(eq(apiIdempotency.endpoint, claimed.endpoint), eq(apiIdempotency.key, claimed.key)));
}

/**
 * Releases a key whose request failed, so the caller may simply try again.
 *
 * ⚠️ Without this a request that throws leaves its key `in_progress` for the
 * whole stale window, and retrying with the same key — the obvious thing to do —
 * is refused for fifteen minutes. Nothing was imported, so there is nothing to
 * protect.
 */
export async function release(db: TenantDb, claimed: Claim): Promise<void> {
  if (claimed.kind !== "proceed") return;
  try {
    await db
      .delete(apiIdempotency)
      .where(
        and(
          eq(apiIdempotency.endpoint, claimed.endpoint),
          eq(apiIdempotency.key, claimed.key),
          eq(apiIdempotency.status, "in_progress"),
        ),
      );
  } catch {
    // The window expires on its own. Failing to tidy up must not replace the
    // error the caller is actually being told about.
  }
}

/**
 * How long a key is worth remembering.
 *
 * Far past any retry a client library makes on its own, and past the point where
 * somebody re-running yesterday's file would still call it the same import.
 */
export const KEY_LIFETIME_DAYS = 30;

/**
 * Forgets keys nobody is going to send again, and reports how many.
 *
 * ⚠️ Not optional housekeeping. Every keyed request stores its **whole
 * response** — that is what makes a repeat replay rather than re-import — so a
 * five-hundred-record answer is tens of kilobytes, written once a day for ever
 * by any workspace that imports daily, in a database the customer pays for.
 */
export async function sweepIdempotencyKeys(db: TenantDb, now = new Date()): Promise<number> {
  const gone = await db
    .delete(apiIdempotency)
    .where(lt(apiIdempotency.createdAt, new Date(now.getTime() - KEY_LIFETIME_DAYS * 24 * 60 * 60 * 1000)))
    .returning({ key: apiIdempotency.key });
  return gone.length;
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
