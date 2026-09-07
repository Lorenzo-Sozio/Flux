/**
 * Turning a bulk import from one statement per row into a handful.
 *
 * ⚠️ The Neon HTTP driver holds no session, so **every statement is its own
 * request**. The import routes looked up a duplicate and then wrote, once per
 * record, sequentially: a five-hundred-record batch — the documented maximum —
 * was a thousand round trips inside one request, against a Cloudflare subrequest
 * budget of a thousand per request. The documented maximum was therefore exactly
 * the size that could not complete.
 *
 * That is not only slow. A timed-out import cannot be retried safely, because
 * contacts and leads deduplicate on email alone, email is optional for both, and
 * the activity routes deduplicate on nothing — so the caller's only recourse
 * duplicates their data. The speed is what makes the unsafe retry necessary.
 *
 * Three passes instead: validate with no database at all, look every email up in
 * one statement, then write in chunks.
 */

/** Splits a list into runs of at most `size`, preserving order. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new Error("chunk size must be at least 1");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * How many values one `IN (...)` may carry.
 *
 * Postgres accepts far more, but the whole statement travels as one HTTP body
 * and a batch is capped at 500 records anyway, so this is a ceiling that never
 * bites rather than a tuned number.
 */
export const LOOKUP_CHUNK = 500;

/**
 * How many rows one multi-row `INSERT` may carry.
 *
 * ⚠️ Smaller than the batch limit on purpose. Postgres binds one parameter per
 * column per row, against a hard ceiling of 65535 per statement; a contact has
 * more than thirty columns, so five hundred rows in one statement is within a
 * factor of four of a limit whose error message names none of this. Two hundred
 * leaves the margin, and costs two extra round trips out of the thousand saved.
 */
export const INSERT_CHUNK = 200;

/**
 * Tracks which values are already taken, counting the ones this batch is about
 * to create.
 *
 * ⚠️ This is the subtlety the one-statement-per-row version got for free. It
 * looked each email up immediately before writing, so the second record carrying
 * an email already found the first one — it was in the table by then. Looking
 * every email up once, before writing any of them, loses that: two new records
 * sharing an email would both be inserted, and `onDuplicate: "skip"` would have
 * silently stopped meaning what it says.
 *
 * So a row that is only going to exist is claimed as though it already did.
 */
export function claimTracker(existing: Iterable<readonly [string, string]>) {
  const taken = new Map<string, string>(existing);
  return {
    /** The id already holding this value, if any. */
    find(value: string | null | undefined): string | undefined {
      return value ? taken.get(value) : undefined;
    },
    /** Reserves a value for a row this batch is about to insert. */
    claim(value: string | null | undefined, id: string): void {
      if (value) taken.set(value, id);
    },
  };
}
