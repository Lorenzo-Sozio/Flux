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
  const n = typeof amount === "string" ? Number.parseFloat(amount) : Number(amount);
  return Number.isFinite(n) && n > 0;
}
