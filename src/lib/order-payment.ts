/**
 * order-payment.ts — what is still owed on an order.
 *
 * Orders carried a total and nothing about money actually arriving, so the
 * question a business asks about an order more often than any other — has this
 * been paid — was answered by somebody remembering, or by opening the bank. The
 * translation files even had the words for it, describing columns the schema had
 * never had.
 *
 * ⚠️ Payments are **rows, not a number on the order**. A single `paid_amount`
 * field survives exactly one instalment: the second one overwrites the first and
 * the history of who paid what, when, is gone. A deposit followed by a balance is
 * the ordinary case, not the exotic one.
 *
 * This module is the arithmetic alone, so it can be tested without a database and
 * cannot drift from what the screen shows: the screen calls it too.
 */

import { fromWallValue, toWallDate } from "@/lib/wall-clock";

export interface PaymentRow {
  amount: number | string | null;
}

export type PaymentState = "unpaid" | "partial" | "paid" | "overpaid";

export interface PaymentSummary {
  /** What has arrived, rounded to the cent. */
  paid: number;
  /** What is still owed. Negative when more arrived than was asked for. */
  outstanding: number;
  state: PaymentState;
}

/** Money rounded the way money is: to the cent, away from binary noise. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function toNumber(value: number | string | null | undefined): number {
  const n = typeof value === "string" ? Number.parseFloat(value) : (value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The state of one order's payments.
 *
 * `paid` and `partial` are separated because chasing a customer who has paid
 * nothing and one who has paid half are different conversations, and a single
 * boolean makes them the same one.
 *
 * A tenth of a cent is not a debt. Rounding both sides and comparing at the cent
 * stops an order that is paid to the last cent from reading as "still owing
 * 0.0000001" because of how the decimals were stored.
 */
export function paymentSummary(total: number | string | null, payments: PaymentRow[]): PaymentSummary {
  const due = round2(toNumber(total));
  const paid = round2(payments.reduce((sum, p) => sum + toNumber(p.amount), 0));
  const outstanding = round2(due - paid);

  if (paid <= 0) return { paid, outstanding, state: due <= 0 ? "paid" : "unpaid" };
  if (outstanding > 0) return { paid, outstanding, state: "partial" };
  if (outstanding < 0) return { paid, outstanding, state: "overpaid" };
  return { paid, outstanding, state: "paid" };
}

/**
 * Whether an amount can be recorded as a payment.
 *
 * Refuses zero and negative amounts — a refund is not a negative payment, it is
 * its own event and pretending otherwise makes the total meaningless — and
 * refuses anything that is not a finite number, because a NaN entering the sum
 * makes every figure on the order NaN from then on.
 *
 * It deliberately does **not** refuse an amount larger than the total. Deposits,
 * rounding and payments in the wrong currency happen, and an order that says
 * "overpaid" is more useful than a form that says no.
 */
export function isRecordablePayment(amount: unknown): boolean {
  return parsePaymentAmount(amount) !== null;
}

/**
 * The day a payment arrived, typed as YYYY-MM-DD, as an instant: midday on the workspace's
 * clock, so the day reads the same wherever it is displayed. Nothing typed means now; a day
 * that is not one means null — `new Date("garbage")` reached the database and threw there.
 */
export function paymentDay(value: string | null | undefined, zone: string, now = new Date()): Date | null {
  if (!value) return now;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = fromWallValue(`${value}T12:00`, zone);
  return d && !Number.isNaN(d.getTime()) && toWallDate(d, zone) === value ? d : null;
}

/** The largest amount a payment column holds: numeric(12, 2). */
export const MAX_PAYMENT = 9_999_999_999.99;

/**
 * An amount as it is stored: a number, or a string that is nothing but one, rounded to the
 * cent — or null.
 *
 * ⚠️⚠️ **One reading for the check and for the write.** The check used `parseFloat`, which reads
 * "12abc" as 12, while the write used `Number`, which reads it as NaN: the payment was
 * accepted and stored as NaN, and a numeric column takes NaN — every sum over it then says
 * NaN, and an invoice with NaN outstanding sits on the receivables list for ever. A value
 * that rounds to nothing ("0.004") or does not fit the column is refused as well.
 */
export function parsePaymentAmount(amount: unknown): number | null {
  let n: number;
  if (typeof amount === "number") n = amount;
  else if (typeof amount === "string" && /^\s*\d+(?:[.,]\d+)?\s*$/.test(amount))
    n = Number(amount.trim().replace(",", "."));
  else return null;
  if (!Number.isFinite(n)) return null;
  const cents = Math.round((n + Number.EPSILON) * 100) / 100;
  return cents >= 0.01 && cents <= MAX_PAYMENT ? cents : null;
}
