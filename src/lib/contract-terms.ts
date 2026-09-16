/**
 * A contract's term, renewal and recurring value, computed from its dates.
 *
 * ⚠️⚠️ **Where a contract stands is computed, never stored.** "Active", "renewal
 * due" and "expired" change with the calendar, not with anybody saving the record,
 * so a stored status is wrong the first morning nobody touches it — and a list of
 * renewals built on it misses exactly the contracts nobody is looking after. Only
 * the two decisions a person makes are stored: that it is still a draft, and that
 * it was cancelled.
 *
 * ⚠️ Dates are calendar days, `YYYY-MM-DD`, with no time and no time zone. A term
 * that ends on 31 March ends on 31 March wherever the server runs; a `Date` would
 * make it 30 March for half the world.
 */

import { type Refusal, refuse } from "@/lib/i18n-message";

export const BILLING_PERIODS = ["monthly", "quarterly", "semiannual", "annual"] as const;
export type BillingPeriod = (typeof BILLING_PERIODS)[number];

export const MONTHS_IN: Record<BillingPeriod, number> = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };

export type ContractPhase = "draft" | "cancelled" | "upcoming" | "active" | "renewal_due" | "expired";

export interface ContractTerms {
  status: "draft" | "active" | "cancelled";
  amount: number | string;
  billingPeriod: BillingPeriod;
  startDate: string;
  /** Null for a contract with no end. */
  endDate: string | null;
  autoRenew: boolean;
  /** Length of each renewal, in months. */
  renewalTermMonths: number | null;
  /** How many days before the term ends the decision has to be made. */
  noticeDays: number;
}

/** A stored contract row, as the database returns it. */
export interface StoredContract {
  status: string;
  amount: string | number;
  billingPeriod: string;
  startDate: string;
  endDate: string | null;
  autoRenew: boolean;
  renewalTermMonths: number | null;
  noticeDays: number;
}

/**
 * The terms of a stored row.
 *
 * Rows are written only through `cleanContract`, so the text columns hold known
 * values; this narrows their types rather than trusting a cast. An unknown status
 * reads as the one that asks for attention, never as cancelled.
 */
export function termsOf(row: StoredContract): ContractTerms {
  return {
    ...row,
    status: row.status === "draft" || row.status === "cancelled" ? row.status : "active",
    billingPeriod: (BILLING_PERIODS as readonly string[]).includes(row.billingPeriod)
      ? (row.billingPeriod as BillingPeriod)
      : "monthly",
  };
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDay(value: string): boolean {
  const m = DAY.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

function parts(day: string): [number, number, number] {
  const m = DAY.exec(day);
  if (!m) throw new Error(`Not a calendar day: ${day}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function format(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Today as a calendar day, in UTC. */
export function today(now = new Date()): string {
  return format(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate());
}

export function addDays(day: string, days: number): string {
  const [y, m, d] = parts(day);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return format(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/**
 * The same day `months` later, or the last day of that month when it is shorter.
 *
 * ⚠️ Not `setMonth`: 31 January plus one month is 3 March there, which would move
 * every renewal of a contract signed at the end of a month a few days later each
 * time round.
 */
export function addMonths(day: string, months: number): string {
  const [y, m, d] = parts(day);
  const index = y * 12 + (m - 1) + months;
  const ty = Math.floor(index / 12);
  const tm = (index % 12) + 1;
  const last = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  return format(ty, tm, Math.min(d, last));
}

/**
 * The end of the term running on `on`.
 *
 * A contract that renews itself keeps rolling its end forward by one renewal until
 * the end is on or after `on`, so it never reads as expired. The roll counts from
 * the original end every time, so a 31st stays the 31st in the months that have one.
 */
export function currentTermEnd(c: ContractTerms, on: string): string | null {
  if (!c.endDate) return null;
  const renewal = c.renewalTermMonths ?? 0;
  if (!c.autoRenew || renewal < 1 || c.endDate >= on) return c.endDate;
  let rounds = 1;
  let end = addMonths(c.endDate, renewal);
  while (end < on) {
    rounds++;
    end = addMonths(c.endDate, renewal * rounds);
  }
  return end;
}

/** The last day notice can still be given: the term end minus the notice period. */
export function noticeDeadline(termEnd: string, noticeDays: number): string {
  return addDays(termEnd, -noticeDays);
}

/**
 * How long before the notice deadline a contract starts asking for a decision.
 *
 * ⚠️ Not zero. Flagging a contract on its deadline is flagging it on the last day
 * anything can be done: a self-renewing contract has already renewed by the time
 * anybody reads the notification.
 */
export const REMINDER_LEAD_DAYS = 30;

export function contractPhase(c: ContractTerms, on: string): ContractPhase {
  if (c.status === "cancelled") return "cancelled";
  if (c.status === "draft") return "draft";
  if (on < c.startDate) return "upcoming";
  const end = currentTermEnd(c, on);
  if (end === null) return "active";
  if (on > end) return "expired";
  // Opens a month before the notice deadline, so there is still time to act on it.
  if (on >= addDays(noticeDeadline(end, c.noticeDays), -REMINDER_LEAD_DAYS)) return "renewal_due";
  return "active";
}

/** The recurring value per month, whatever the billing period. */
export function monthlyValue(c: Pick<ContractTerms, "amount" | "billingPeriod">): number {
  return Number(c.amount) / MONTHS_IN[c.billingPeriod];
}

/** Whether a contract is earning on `on`: started, not ended, not cancelled or a draft. */
export function isEarning(c: ContractTerms, on: string): boolean {
  const phase = contractPhase(c, on);
  return phase === "active" || phase === "renewal_due";
}

/**
 * Monthly recurring revenue on `on`, rounded to the cent.
 *
 * ⚠️ Only contracts earning that day. A signed contract that starts next month is
 * not revenue yet, and an expired one is not revenue any more; counting either
 * makes the figure a forecast that calls itself a fact.
 */
export function monthlyRecurringRevenue(contracts: readonly ContractTerms[], on: string): number {
  const total = contracts.reduce((sum, c) => sum + (isEarning(c, on) ? monthlyValue(c) : 0), 0);
  return Math.round(total * 100) / 100;
}

// ─── Input ────────────────────────────────────────────────────────────────────

export interface ContractInput {
  title: string;
  companyId: string;
  contactId?: string | null;
  dealId?: string | null;
  ownerId?: string | null;
  status: "draft" | "active" | "cancelled";
  amount: number;
  currency: string;
  billingPeriod: string;
  startDate: string;
  endDate?: string | null;
  autoRenew: boolean;
  renewalTermMonths?: number | null;
  noticeDays: number;
  notes?: string | null;
}

export type CleanContract = Omit<ContractInput, "billingPeriod"> & { billingPeriod: BillingPeriod };

/** A contract as it will be stored, or the reason it cannot be. */
export function cleanContract(input: ContractInput): { ok: true; value: CleanContract } | Refusal {
  const title = input.title.trim().slice(0, 200);
  if (!title) return refuse("validation.contracts.titleRequired");
  if (!input.companyId) return refuse("validation.contracts.companyRequired");
  if (!["draft", "active", "cancelled"].includes(input.status)) return refuse("validation.contracts.statusUnknown");
  if (!(BILLING_PERIODS as readonly string[]).includes(input.billingPeriod)) {
    return refuse("validation.contracts.billingPeriodUnknown");
  }
  if (!Number.isFinite(input.amount) || input.amount < 0) {
    return refuse("validation.contracts.amountNegative");
  }
  if (!isDay(input.startDate)) return refuse("validation.contracts.startDateInvalid");

  const endDate = input.endDate || null;
  if (endDate !== null) {
    if (!isDay(endDate)) return refuse("validation.contracts.endDateInvalid");
    if (endDate < input.startDate) return refuse("validation.contracts.endBeforeStart");
  }

  const noticeDays = Math.trunc(input.noticeDays);
  if (!(noticeDays >= 0 && noticeDays <= 365)) return refuse("validation.contracts.noticeRange");

  let renewalTermMonths: number | null = null;
  if (input.autoRenew) {
    // Renewing needs something to renew from and a length to renew by; without
    // either the contract would read as renewing while in fact simply expiring.
    if (endDate === null) return refuse("validation.contracts.autoRenewNeedsEnd");
    renewalTermMonths = Math.trunc(Number(input.renewalTermMonths));
    if (!(renewalTermMonths >= 1 && renewalTermMonths <= 120)) {
      return refuse("validation.contracts.renewalTermRange");
    }
  }

  const currency = (input.currency || "EUR").trim().toUpperCase().slice(0, 3);
  return {
    ok: true,
    value: {
      ...input,
      title,
      billingPeriod: input.billingPeriod as BillingPeriod,
      amount: Math.round(input.amount * 100) / 100,
      currency,
      endDate,
      noticeDays,
      autoRenew: input.autoRenew,
      renewalTermMonths,
      contactId: input.contactId || null,
      dealId: input.dealId || null,
      ownerId: input.ownerId || null,
      notes: input.notes?.trim().slice(0, 5000) || null,
    },
  };
}
