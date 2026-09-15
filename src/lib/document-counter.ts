import { type SQL, sql } from "drizzle-orm";

import { documentCounters } from "@/db/schema";

/**
 * Numbering that cannot hand the same number to two documents.
 *
 * ⚠️⚠️ The old way was `max(number) + 1`, read and then written in two separate
 * steps, and it had two defects that needed no bad luck:
 *
 *   * **A race.** Two documents created together read the same maximum and
 *     computed the same next number, and the unique constraint refused the
 *     second. Somebody saw a save fail.
 *   * **Text compared as text.** `max()` on a string compares character by
 *     character, so `ORD-2026-10000` sorts *below* `ORD-2026-9999`. After the
 *     9,999th order of a year the maximum stopped moving, and every order after
 *     the first one past it failed until January.
 *
 * `nextInSequence` is one statement:
 *
 *     INSERT … VALUES (scope, <seed>)
 *     ON CONFLICT (scope) DO UPDATE SET last_value = last_value + 1
 *     RETURNING last_value
 *
 * One statement is atomic in Postgres with or without a transaction, and the row
 * lock on the conflicting row puts concurrent callers in a queue. The Neon HTTP
 * driver holds no session, so a single statement is the only atomicity on offer.
 *
 * ⚠️ **The seed runs only when a scope is first used**, and it counts the numbers
 * already issued, *numerically*. A workspace that has used `max()` for months
 * carries on from its real highest number rather than starting again at 1 and
 * colliding with its own history.
 *
 * ⚠️ **A number can be skipped.** If the document insert that follows fails, the
 * counter has already moved. That is acceptable for orders. It is **not** for
 * invoices, which must be consecutive without gaps: the invoice register assigns
 * its number when a draft is issued, in the same statement that issues it, and
 * does not use this function on its own.
 */

// biome-ignore lint/suspicious/noExplicitAny: the tenant db handle is built per request
type AnyDb = any;

/**
 * The one statement that advances a sequence, built but not run.
 *
 * Separate from `nextInSequence` so a test can read the SQL drizzle actually
 * generates with `.toSQL()`. Everything this module promises lives in that SQL:
 * the conflict target, the `+ 1`, and the `RETURNING`. A test of a fake that
 * merely records method calls would pass just as happily if any of them changed.
 */
export function advanceStatement(db: AnyDb, scope: string, seed: SQL) {
  return db
    .insert(documentCounters)
    .values({ scope, lastValue: seed })
    .onConflictDoUpdate({
      target: documentCounters.scope,
      set: { lastValue: sql`${documentCounters.lastValue} + 1`, updatedAt: new Date() },
    })
    .returning({ value: documentCounters.lastValue });
}

/**
 * Advances a sequence and returns the value it now holds.
 *
 * `seed` is the SQL for "what the first value should be" and is evaluated only
 * when the scope has no row yet.
 */
export async function nextInSequence(db: AnyDb, scope: string, seed: SQL): Promise<number> {
  const [row] = await advanceStatement(db, scope, seed);

  const value = Number(row?.value);
  if (!Number.isInteger(value) || value < 1) {
    // Refusing is better than issuing `ORD-2026-NaN` onto a legal document.
    throw new Error(`Numbering sequence "${scope}" returned ${String(row?.value)}`);
  }
  return value;
}

// ── Orders ────────────────────────────────────────────────────────────────────

export const ORDER_PREFIX = "ORD";

/** One sequence per calendar year. */
export function orderScope(year: number): string {
  return `order:${year}`;
}

/** `ORD-2026-0007`. Four digits minimum, and more when the year needs them. */
export function formatOrderNumber(year: number, value: number): string {
  return `${ORDER_PREFIX}-${year}-${String(value).padStart(4, "0")}`;
}

/**
 * The first value for a year's order sequence: one past the highest order number
 * already issued that year, compared as a **number**.
 *
 * The regular expression keeps a hand-edited or legacy value like `ORD-2026-X1`
 * from making the cast throw and blocking every new order.
 */
export function orderSeed(year: number): SQL {
  const prefix = `${ORDER_PREFIX}-${year}-`;
  const pattern = `^${ORDER_PREFIX}-${year}-[0-9]+$`;
  // The offset is inlined rather than bound: it is computed here from a constant,
  // and a bound parameter in `substring(… from $1)` has no type Postgres can infer.
  const from = sql.raw(String(prefix.length + 1));
  return sql`(
    select coalesce(max(cast(substring("order_number" from ${from}) as integer)), 0) + 1
    from "order"
    where "order_number" ~ ${pattern}
  )`;
}
