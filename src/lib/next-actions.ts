/**
 * next-actions.ts — what to do now, rather than what exists.
 *
 * The dashboard listed inventory: how many deals, how many tickets, the newest
 * leads. All of it true, none of it a decision (audit rilievo S-02). A person
 * opening the CRM on a Monday still had to work out for themselves which of the
 * forty open deals had gone quiet, which quote was sent and never opened, and
 * which ticket is about to miss its promise.
 *
 * Every rule below is a query over data the schema already holds. Nothing here
 * needs a new column, a background job or a model.
 *
 * This module is pure on purpose: the thresholds and the ordering are the part
 * worth reading and arguing about, and keeping them out of the queries means they
 * can be read in one place instead of inferred from six `WHERE` clauses.
 */

export type NextActionKind =
  | "sla_at_risk"
  | "sla_breached"
  | "quote_expiring"
  | "quote_unopened"
  | "deal_stalled"
  | "deal_overdue"
  | "lead_untouched"
  | "customer_quiet";

export type NextActionEntity = "ticket" | "quote" | "deal" | "lead" | "company";

export interface NextAction {
  kind: NextActionKind;
  entity: NextActionEntity;
  id: string;
  /** What the record is called, as the user knows it. */
  title: string;
  /** The one number that makes the case: days quiet, hours left. */
  detail: string;
  href: string;
  /** 0–100. Only ever used to order the list. */
  urgency: number;
}

/**
 * The thresholds, in one place.
 *
 * Chosen to be defensible rather than clever: a fortnight is when a deal has
 * stopped moving, five days is when an unopened quote has been ignored rather
 * than delayed, a quarter is when a customer relationship has lapsed. They are
 * constants here so that making them a per-workspace setting later is one change,
 * not six.
 */
export const THRESHOLDS = {
  /** An open deal nobody has touched for this long has stalled. */
  dealStalledDays: 14,
  /** A quote sent this long ago and still unopened is not merely in transit. */
  quoteUnopenedDays: 5,
  /** A quote this close to expiring needs chasing while it is still valid. */
  quoteExpiringDays: 3,
  /** A ticket with this little of its SLA window left is about to breach. */
  slaRemainingFraction: 0.2,
  /** A new lead left alone this long has gone cold. */
  leadUntouchedDays: 3,
  /** A customer with no recorded contact for this long has gone quiet. */
  customerQuietDays: 90,
} as const;

const DAY_MS = 86_400_000;

/** Whole days between two instants, never negative. */
export function daysBetween(from: Date | string | number, to: Date | number = Date.now()): number {
  const a = typeof from === "object" ? from.getTime() : new Date(from).getTime();
  const b = typeof to === "object" ? to.getTime() : to;
  return Math.max(0, Math.floor((b - a) / DAY_MS));
}

/** Hours until an instant. Negative once it has passed. */
export function hoursUntil(when: Date | string, now: number = Date.now()): number {
  const t = typeof when === "object" ? when.getTime() : new Date(when).getTime();
  return (t - now) / 3_600_000;
}

/**
 * How much of an SLA window is left, as a fraction of the whole.
 *
 * Twenty per cent of four hours and twenty per cent of two days are both "nearly
 * out of time", and a fixed number of hours would be wrong for one of them. The
 * window is the ticket's own: from when it arrived to when it was promised.
 *
 * Returns 1 when the clock has not started and 0 once it has run out.
 */
export function slaRemainingFraction(createdAt: Date, deadlineAt: Date, now: number = Date.now()): number {
  const total = deadlineAt.getTime() - createdAt.getTime();
  if (total <= 0) return 0;
  const left = deadlineAt.getTime() - now;
  return Math.min(1, Math.max(0, left / total));
}

/**
 * Where each kind sits before the specifics are weighed.
 *
 * A breached promise to a customer outranks a quiet deal however long it has been
 * quiet, so the base is what orders the list and the specifics only settle ties
 * within a kind.
 */
const BASE_URGENCY: Record<NextActionKind, number> = {
  sla_breached: 92,
  sla_at_risk: 80,
  quote_expiring: 68,
  deal_overdue: 60,
  quote_unopened: 52,
  lead_untouched: 44,
  deal_stalled: 36,
  customer_quiet: 20,
};

/**
 * Turns a base and a degree of lateness into a score in 0–100.
 *
 * `overBy` is how far past the threshold the record has gone, as a multiple of
 * the threshold itself: 0 is exactly at it, 1 is twice as late. The curve is
 * deliberately flat — twice as late is not twice as urgent, and a single very old
 * record must not push everything newer off the top of the list.
 */
export function urgencyOf(kind: NextActionKind, overBy = 0): number {
  const base = BASE_URGENCY[kind];
  const headroom = 100 - base;
  return Math.round(base + headroom * (1 - 1 / (1 + Math.max(0, overBy))));
}

/** Most urgent first; ties broken by kind so the list does not shuffle. */
export function sortActions(actions: NextAction[]): NextAction[] {
  return [...actions].sort((a, b) => b.urgency - a.urgency || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
}

/**
 * The finished list.
 *
 * Capped, because a work list nobody can finish is a wall rather than a plan. The
 * cap is applied after ordering, so what survives is what matters most.
 */
export function buildWorkList(actions: NextAction[], limit = 12): NextAction[] {
  return sortActions(actions).slice(0, limit);
}
