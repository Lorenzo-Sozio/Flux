/**
 * How much of a ticket's thread the detail screen loads, and how pages of it
 * fit together.
 *
 * ⚠️ The screen used to load every message and every audit entry a ticket had
 * ever collected, each with its author, in one go. A ticket that has been open
 * for a year of back-and-forth is hundreds of messages, and the page drew
 * nothing until all of them had arrived in the browser.
 *
 * It loads the most recent page now, and older pages on request. Two consumers
 * needed the *whole* thread rather than a page, and both are handled on the
 * server so neither silently reads a truncated one:
 *
 *   * the handover summary — "what the customer first asked", how many replies,
 *     whether anyone ever answered — is computed over every message before the
 *     page is cut;
 *   * the counts that decide whether there is anything older to load come from
 *     a `count()`, not from the length of what arrived.
 *
 * Lives in `lib` because `src/actions/support.ts` is a `"use server"` module,
 * which may export nothing but async functions.
 */

/** Messages, and separately audit entries, in one page of the thread. */
export const TICKET_THREAD_PAGE = 100;

/**
 * How much of each message the handover summary reads.
 *
 * The summary shows an excerpt of 160 characters, so a thousand is invisible to
 * anybody looking at it — and keeps a thread of long pasted emails from making
 * the one query that reads everything heavier than the page it serves.
 */
export const HANDOVER_CONTENT_CAP = 1000;

interface Dated {
  id: string;
  createdAt: Date | string;
}

/**
 * Joins a freshly loaded page with what the screen already holds, oldest first.
 *
 * ⚠️ After somebody replies, the screen reloads the latest page. Replacing the
 * thread with it would throw away every older page they had opened, and the
 * conversation they were reading would vanish from above the reply they just
 * sent. So the fresh page wins for anything it contains — a message edited or
 * re-rendered by the server — and everything older survives.
 */
export function mergeThread<T extends Dated>(fresh: readonly T[], held: readonly T[]): T[] {
  const byId = new Map<string, T>();
  for (const item of held) byId.set(item.id, item);
  for (const item of fresh) byId.set(item.id, item);
  return [...byId.values()].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

/** The timestamp of the oldest item held, which is where the next older page ends. */
export function oldestOf(...lists: readonly (readonly Dated[])[]): Date | null {
  let oldest: number | null = null;
  for (const list of lists) {
    for (const item of list) {
      const t = new Date(item.createdAt).getTime();
      if (oldest === null || t < oldest) oldest = t;
    }
  }
  return oldest === null ? null : new Date(oldest);
}
