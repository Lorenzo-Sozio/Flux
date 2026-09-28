import { shareOut } from "@/lib/fatturapa/totals";

/**
 * Payment terms and installments (I12, decision R6: "mode A", one invoice paid in parts).
 *
 * A customer has default terms (`company.payment_terms`, a preset); an invoice carries its own
 * (`invoice.payment_terms`: a preset, or installments typed by hand). Issuing turns them into
 * dated amounts from the issue date and the total, and freezes them (`invoice.installments`):
 * the XML carries one DettaglioPagamento per installment under TP01, and what is owed is read
 * installment by installment, payments going to the earliest first.
 *
 * ⚠️⚠️ **"gg d.f.f.m." counts months, not days.** "30 gg data fattura fine mese" is the end of the
 * month after the invoice's month, as Italian accounting software reads it: an invoice of 31
 * January is due on 28 February. Adding thirty days and going to the month's end would say 31
 * March, and the customer would be told a different date than their own ledger shows.
 *
 * ⚠️ The shares add up to the total to the cent (`shareOut`, largest remainder): SDI checks that
 * the ImportoPagamento of the installments do not exceed the document.
 */

export interface Installment {
  dueDate: string;
  amount: number;
}

interface Step {
  /** Calendar days from the issue date (without end of month). */
  days?: number;
  /** Months after the invoice's month, landing on that month's last day (with end of month). */
  months?: number;
  weight: number;
}

export const TERM_PRESETS = {
  immediate: { steps: [{ days: 0, weight: 1 }] },
  d30: { steps: [{ days: 30, weight: 1 }] },
  d60: { steps: [{ days: 60, weight: 1 }] },
  d30eom: { steps: [{ months: 1, weight: 1 }] },
  d60eom: { steps: [{ months: 2, weight: 1 }] },
  d90eom: { steps: [{ months: 3, weight: 1 }] },
  d30_60eom: {
    steps: [
      { months: 1, weight: 1 },
      { months: 2, weight: 1 },
    ],
  },
  d30_60_90eom: {
    steps: [
      { months: 1, weight: 1 },
      { months: 2, weight: 1 },
      { months: 3, weight: 1 },
    ],
  },
  p30_70: {
    steps: [
      { days: 0, weight: 30 },
      { days: 30, weight: 70 },
    ],
  },
  p50_50: {
    steps: [
      { days: 0, weight: 50 },
      { days: 30, weight: 50 },
    ],
  },
} satisfies Record<string, { steps: Step[] }>;

export type TermPreset = keyof typeof TERM_PRESETS;
export const TERM_PRESET_KEYS = Object.keys(TERM_PRESETS) as TermPreset[];

/** An invoice's terms: a preset, worked out at issue, or installments written by hand. */
export type PaymentTerms = { preset: TermPreset } | { custom: Installment[] };

export const MAX_INSTALLMENTS = 12;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function parts(day: string): [number, number, number] | null {
  const m = DAY.exec(day);
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? [y, mo, d] : null;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(day: string, days: number): string {
  const p = parts(day);
  if (!p) throw new Error(`not a day: ${day}`);
  return iso(new Date(Date.UTC(p[0], p[1] - 1, p[2] + days)));
}

/** The last day of the month `months` after the month of `day`. */
export function endOfMonthAfter(day: string, months: number): string {
  const p = parts(day);
  if (!p) throw new Error(`not a day: ${day}`);
  // Day 0 of the month after is the last day of the month wanted.
  return iso(new Date(Date.UTC(p[0], p[1] - 1 + months + 1, 0)));
}

export function isPreset(v: unknown): v is TermPreset {
  return typeof v === "string" && Object.hasOwn(TERM_PRESETS, v);
}

/** The installments of these terms for an invoice of `total` issued on `issueDate`. */
export function installmentsFor(terms: PaymentTerms, issueDate: string, total: number): Installment[] {
  if ("custom" in terms) return [...terms.custom].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const { steps } = TERM_PRESETS[terms.preset] as { steps: Step[] };
  const amounts = shareOut(
    total,
    steps.map((s) => s.weight),
  );
  return steps.map((s, i) => ({
    dueDate: s.months !== undefined ? endOfMonthAfter(issueDate, s.months) : addDays(issueDate, s.days ?? 0),
    amount: amounts[i],
  }));
}

/** Terms as they are stored, or null when they are not terms. Custom amounts to the cent. */
export function cleanTerms(input: unknown): PaymentTerms | null {
  if (!input || typeof input !== "object") return null;
  const v = input as Record<string, unknown>;
  if (isPreset(v.preset)) return { preset: v.preset };
  if (!Array.isArray(v.custom) || v.custom.length === 0 || v.custom.length > MAX_INSTALLMENTS) return null;
  const custom: Installment[] = [];
  for (const raw of v.custom) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const amount = typeof r.amount === "number" ? r.amount : Number(String(r.amount ?? "").replace(",", "."));
    if (typeof r.dueDate !== "string" || !parts(r.dueDate)) return null;
    if (!Number.isFinite(amount) || Math.round(amount * 100) <= 0) return null;
    custom.push({ dueDate: r.dueDate, amount: Math.round(amount * 100) / 100 });
  }
  return { custom: custom.sort((a, b) => a.dueDate.localeCompare(b.dueDate)) };
}

/** Whether installments add up to the total, to the cent. */
export function installmentsMatch(installments: readonly Installment[], total: number): boolean {
  return installments.reduce((s, i) => s + Math.round(i.amount * 100), 0) === Math.round(total * 100);
}

export interface InstallmentState extends Installment {
  paid: number;
  outstanding: number;
}

/**
 * What each installment still owes once `paid` is taken off, the earliest first — the order a
 * customer's payments settle them in. `due` is what the invoice owes in all (its total less
 * credit notes): a credit note reduces the last installments, not the first.
 */
export function installmentStates(installments: readonly Installment[], due: number, paid: number): InstallmentState[] {
  const sorted = [...installments].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  // A credit note takes from the end.
  let cut = Math.max(0, Math.round((sorted.reduce((s, i) => s + i.amount, 0) - due) * 100));
  const owed = sorted.map((i) => Math.round(i.amount * 100));
  for (let k = owed.length - 1; k >= 0 && cut > 0; k--) {
    const take = Math.min(cut, owed[k]);
    owed[k] -= take;
    cut -= take;
  }
  let left = Math.max(0, Math.round(paid * 100));
  return sorted.map((i, k) => {
    const share = Math.min(left, owed[k]);
    left -= share;
    return { dueDate: i.dueDate, amount: owed[k] / 100, paid: share / 100, outstanding: (owed[k] - share) / 100 };
  });
}
