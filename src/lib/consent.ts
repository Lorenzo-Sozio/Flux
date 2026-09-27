/**
 * A person's marketing consent: whether, since when, and where the decision came from.
 *
 * ⚠️⚠️ It was a boolean and a date, and the date only ever moved one way. An unsubscribe
 * link or an opt-out through the API turned the boolean off and left the date of the
 * *grant* standing beside it; nothing said where a "yes" had come from — a form, an import
 * of a list bought three years ago, an integration. Asked to show when and how somebody
 * agreed, a workspace had no answer (§13.8).
 *
 * Now `consentDate` is the date of the **latest decision**, grant or withdrawal, and
 * `consentSource` says where it came from. The switch itself is in the field history
 * (`marketingConsent` is tracked), so the whole story is on the record's timeline.
 *
 * Pure: every place that writes consent asks here what to write.
 */

export const CONSENT_SOURCES = ["form", "import", "api", "unsubscribe", "conversion", "web"] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];

export interface ConsentColumns {
  marketingConsent?: boolean;
  consentDate?: Date | null;
  consentSource?: ConsentSource | null;
}

/**
 * The consent columns to write when a record is saved with `next`.
 *
 * - `next` undefined: consent was not part of the save; nothing is written.
 * - A new record: its consent as given, dated and sourced when it is a yes.
 * - Unchanged: nothing — the date and source of the decision stand. A date typed in the
 *   form for a standing yes is kept, because a form is also where a consent collected on
 *   paper is recorded late.
 * - Changed: the new value, today (or the typed date, for a yes), and this source.
 */
export function consentPatch(
  before: { marketingConsent: boolean | null; consentDate?: Date | null } | null | undefined,
  next: boolean | undefined,
  source: ConsentSource,
  now: Date = new Date(),
  typedDate?: Date | null,
): ConsentColumns {
  if (next === undefined) return {};
  if (!before) {
    return next
      ? { marketingConsent: true, consentDate: typedDate ?? now, consentSource: source }
      : { marketingConsent: false, consentDate: null, consentSource: null };
  }
  if (Boolean(before.marketingConsent) === next) {
    const typed = next && typedDate && typedDate.getTime() !== before.consentDate?.getTime();
    return typed ? { consentDate: typedDate } : {};
  }
  return {
    marketingConsent: next,
    consentDate: next ? (typedDate ?? now) : now,
    consentSource: source,
  };
}

/** A withdrawal from outside the dashboard — an unsubscribe link, the opt-out API. */
export function consentWithdrawn(source: ConsentSource, now: Date = new Date()): Required<ConsentColumns> {
  return { marketingConsent: false, consentDate: now, consentSource: source };
}
