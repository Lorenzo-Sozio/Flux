/**
 * quote-followup.ts — the chase nobody gets round to writing.
 *
 * A quote sent and not answered needs a nudge, and the nudge is the same message
 * every time with three facts changed. So it goes unwritten, or it goes out
 * ill-judged: the audit asks for a draft that is "always proposed, always
 * editable, never sent on its own" (rilievo S-06).
 *
 * No model is needed for this one. What to say is decided entirely by where the
 * quote is — sent and unopened, opened and quiet, or about to expire — and those
 * three states want three different messages, because they are three different
 * situations:
 *
 *  • Not opened. The likeliest explanation is that the mail did not arrive, so
 *    the message asks that, rather than asking for a decision the customer has
 *    not had the chance to make.
 *  • Opened, no answer. They have read it; the useful move is to offer to talk,
 *    not to repeat what they already have.
 *  • About to expire. The deadline is the news, and it is worth stating plainly
 *    while there is still time to act on it.
 *
 * Pure, so what it says can be read and argued with in one place.
 */

export type FollowUpKind = "not-opened" | "no-answer" | "expiring" | "expired";

export interface QuoteState {
  quoteNumber: string;
  status: string;
  sentAt: Date | null;
  viewedAt: Date | null;
  expiresAt: Date | null;
}

export interface FollowUp {
  kind: FollowUpKind;
  /** Whole days of silence, or until expiry — whichever the message is about. */
  days: number;
}

const DAY_MS = 86_400_000;

/** Whole days between two instants, never negative. */
function daysBetween(from: Date, to: number): number {
  return Math.max(0, Math.floor((to - from.getTime()) / DAY_MS));
}

/** A quote younger than this has not gone quiet, it is simply recent. */
export const QUIET_AFTER_DAYS = 3;

/** Inside this many days of expiry, the deadline is the thing worth saying. */
export const EXPIRING_WITHIN_DAYS = 5;

/**
 * Whether this quote wants chasing, and about what.
 *
 * Returns nothing for a quote that has been answered, or one that is too young to
 * chase: a follow-up the day after sending reads as pressure, not as service.
 *
 * Expiry outranks silence. A quote three days from lapsing is worth a message
 * whatever else is true of it, because the deadline is the fact the customer
 * cannot see and the sender can.
 */
export function whatToChase(quote: QuoteState, now: number = Date.now()): FollowUp | null {
  // Answered, converted, or never sent: there is nothing to chase.
  if (!quote.sentAt) return null;
  if (!["sent", "viewed"].includes(quote.status)) return null;

  if (quote.expiresAt) {
    const daysLeft = Math.ceil((quote.expiresAt.getTime() - now) / DAY_MS);
    if (daysLeft <= 0) return { kind: "expired", days: Math.abs(daysLeft) };
    if (daysLeft <= EXPIRING_WITHIN_DAYS) return { kind: "expiring", days: daysLeft };
  }

  const quiet = daysBetween(quote.sentAt, now);
  if (quiet < QUIET_AFTER_DAYS) return null;

  // Sent and never opened is a different problem from sent and considered, and
  // the two want different messages.
  return { kind: quote.viewedAt ? "no-answer" : "not-opened", days: quiet };
}

/**
 * The message keys for one follow-up.
 *
 * Keys rather than sentences: this is a pure module and the words have to arrive
 * in the reader's language, which only the page knows.
 */
export function followUpKeys(followUp: FollowUp): { subject: string; body: string } {
  return { subject: `${followUp.kind}.subject`, body: `${followUp.kind}.body` };
}
