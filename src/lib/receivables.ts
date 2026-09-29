/**
 * What customers still owe, invoice by invoice (I9): the receivables schedule on Finance,
 * and the balance on an invoice's own page.
 *
 * ⚠️⚠️ **An invoice owes its total, less what its credit notes gave back, less the payments
 * that name it.** A credit note is not a payment and a payment is not a credit note: one
 * changes what was due, the other what arrived. Both come off, each from its own column,
 * and the arithmetic is `paymentSummary` — the same one an order's page uses.
 *
 * ⚠️ **Only an issued invoice or deposit invoice (TD01, TD02) is a receivable.** A draft is not
 * a debt yet, and a credit note is money going the other way.
 *
 * ⚠️ **Due is the due date, or the issue date when none was set**: an invoice that names no
 * term is due on receipt, and one that could never be overdue would never be chased.
 * Days are counted on the workspace's clock — "overdue since yesterday" must not depend on
 * the server's time zone.
 *
 * ⚠️ **Amounts are per currency.** An invoice in dollars and one in euros are not added up;
 * the schedule's totals are grouped by currency, like every total across documents.
 */
import { and, eq, inArray, sql } from "drizzle-orm";

import { companies, invoices, orderPayments, receipts } from "@/db/schema";
import { RECEIVABLE_TYPES } from "@/lib/invoice-rules";
import { type PaymentState, parsePaymentAmount, paymentSummary } from "@/lib/order-payment";
import { type Installment, type InstallmentState, installmentStates } from "@/lib/payment-terms";
import { linkOrderDeposits, recordReceipt } from "@/lib/receipts";

import { AGING_BUCKETS, type AgingBucket, agingBucket } from "./receivables-aging";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle's database types differ per driver
type AnyDb = any;

export { AGING_BUCKETS, type AgingBucket, agingBucket, daysBetween } from "./receivables-aging";

/** An invoice's balance: what is still owed after its credit notes and its payments. */
export function invoiceBalance(
  total: number | string,
  credited: number | string,
  payments: { amount: number | string | null }[],
): { due: number; paid: number; outstanding: number; state: PaymentState } {
  const due = Math.round((Number(total) - Number(credited)) * 100) / 100;
  const s = paymentSummary(due, payments);
  return { due, ...s };
}

export interface Receivable {
  id: string;
  documentNumber: string | null;
  companyId: string | null;
  customer: string | null;
  issueDate: string | null;
  dueDate: string;
  currency: string;
  total: number;
  credited: number;
  paid: number;
  outstanding: number;
  daysOverdue: number;
  bucket: AgingBucket;
  /** Paid in parts (I12): each installment with what it still owes, the earliest paid first. */
  installments: InstallmentState[] | null;
  /** What is past due now: the whole outstanding, or only the installments whose day has come. */
  overdueAmount: number;
}

export interface ReceivablesSchedule {
  today: string;
  invoices: Receivable[];
  /** Per currency: what is owed in each bucket, and in all. */
  totals: { currency: string; buckets: Record<AgingBucket, number>; outstanding: number; overdue: number }[];
}

/**
 * Every issued invoice still owed something, the most overdue first. One statement, with
 * the payments summed per invoice inside it.
 */
export async function receivables(
  db: AnyDb,
  input: { today: string /** One customer's only: what a receipt from them can pay. */; companyId?: string },
): Promise<ReceivablesSchedule> {
  const paidPerInvoice = db
    .select({
      invoiceId: orderPayments.invoiceId,
      paid: sql<string>`sum(${orderPayments.amount})`.as("paid"),
    })
    .from(orderPayments)
    .where(sql`${orderPayments.invoiceId} is not null`)
    .groupBy(orderPayments.invoiceId)
    .as("paid_per_invoice");

  const rows: {
    id: string;
    documentNumber: string | null;
    companyId: string | null;
    snapshotName: string | null;
    companyName: string | null;
    issueDate: string | null;
    dueDate: string | null;
    currency: string;
    total: string;
    credited: string;
    paid: string | null;
    installments: Installment[] | null;
  }[] = await db
    .select({
      id: invoices.id,
      documentNumber: invoices.documentNumber,
      companyId: invoices.companyId,
      snapshotName: sql<string | null>`${invoices.customerSnapshot} ->> 'name'`,
      companyName: companies.name,
      issueDate: invoices.issueDate,
      dueDate: invoices.dueDate,
      currency: invoices.currency,
      total: invoices.total,
      credited: invoices.creditedAmount,
      paid: paidPerInvoice.paid,
      installments: invoices.installments,
    })
    .from(invoices)
    .leftJoin(paidPerInvoice, eq(paidPerInvoice.invoiceId, invoices.id))
    .leftJoin(companies, eq(companies.id, invoices.companyId))
    .where(
      and(
        eq(invoices.status, "issued"),
        inArray(invoices.documentType, [...RECEIVABLE_TYPES]),
        input.companyId ? eq(invoices.companyId, input.companyId) : undefined,
        // A tenth of a cent is not a debt: the same threshold paymentSummary uses.
        sql`round(${invoices.total} - ${invoices.creditedAmount} - coalesce(${paidPerInvoice.paid}, 0), 2) > 0`,
      ),
    );

  const list: Receivable[] = rows
    .map((r) => {
      const balance = invoiceBalance(r.total, r.credited, [{ amount: r.paid }]);
      const plan =
        r.installments && r.installments.length > 1
          ? installmentStates(r.installments, balance.due, balance.paid)
          : null;
      // Paid in parts, the invoice is as late as its first installment still owed.
      const next = plan?.find((i) => i.outstanding > 0);
      const due = next?.dueDate ?? r.dueDate ?? r.issueDate ?? input.today;
      const aging = agingBucket(due, input.today);
      const overdueAmount = plan
        ? Math.round(
            plan
              .filter((i) => agingBucket(i.dueDate, input.today).bucket !== "current")
              .reduce((s, i) => s + i.outstanding, 0) * 100,
          ) / 100
        : aging.bucket === "current"
          ? 0
          : balance.outstanding;
      return {
        id: r.id,
        documentNumber: r.documentNumber,
        companyId: r.companyId,
        // The name as invoiced; the record's today only when the snapshot has none.
        customer: r.snapshotName ?? r.companyName,
        issueDate: r.issueDate,
        dueDate: due,
        currency: r.currency,
        total: Number(r.total),
        credited: Number(r.credited),
        paid: balance.paid,
        outstanding: balance.outstanding,
        ...aging,
        installments: plan,
        overdueAmount,
      };
    })
    .sort((a, b) => b.daysOverdue - a.daysOverdue || a.dueDate.localeCompare(b.dueDate));

  const byCurrency = new Map<string, ReceivablesSchedule["totals"][number]>();
  for (const r of list) {
    const t = byCurrency.get(r.currency) ?? {
      currency: r.currency,
      buckets: Object.fromEntries(AGING_BUCKETS.map((b) => [b, 0])) as Record<AgingBucket, number>,
      outstanding: 0,
      overdue: 0,
    };
    // Each installment in its own bucket: 300 due next month is not 90 days late because the
    // first 300 was.
    const parts = r.installments
      ? r.installments.filter((i) => i.outstanding > 0).map((i) => ({ amount: i.outstanding, dueDate: i.dueDate }))
      : [{ amount: r.outstanding, dueDate: r.dueDate }];
    for (const part of parts) {
      const { bucket } = agingBucket(part.dueDate, input.today);
      t.buckets[bucket] = Math.round((t.buckets[bucket] + part.amount) * 100) / 100;
      if (bucket !== "current") t.overdue = Math.round((t.overdue + part.amount) * 100) / 100;
    }
    t.outstanding = Math.round((t.outstanding + r.outstanding) * 100) / 100;
    byCurrency.set(r.currency, t);
  }
  return { today: input.today, invoices: list, totals: [...byCurrency.values()] };
}

export type RecordPaymentResult =
  | {
      ok: true;
      paymentId: string | null;
      balance: ReturnType<typeof invoiceBalance>;
      becamePaid: boolean;
      /** What went to the customer's credit: paid beyond what the invoice owed. */
      toCredit: number;
    }
  | { ok: false; reason: "invalid_amount" | "not_found" | "not_receivable" };

/**
 * Money arrived against an issued invoice. It names the invoice's order too, so the order's
 * own balance keeps counting it.
 *
 * `becamePaid` says whether this payment is the one that settled it — read after the write,
 * from the rows, so two payments landing together can both see "settled" (the event it
 * drives is at-least-once, like every webhook) but never neither.
 */
export async function recordInvoicePayment(
  db: AnyDb,
  input: {
    invoiceId: string;
    amount: unknown;
    paidAt?: Date;
    method?: string | null;
    reference?: string | null;
    note?: string | null;
    by: string | null;
  },
): Promise<RecordPaymentResult> {
  // A receipt with one allocation to this invoice, never beyond what it owes (src/lib/receipts.ts):
  // what the customer paid on top is their credit, which the next invoice can use.
  const amount = parsePaymentAmount(input.amount);
  if (amount === null) return { ok: false, reason: "invalid_amount" };
  const [invoice] = await db
    .select({ companyId: invoices.companyId, currency: invoices.currency })
    .from(invoices)
    .where(eq(invoices.id, input.invoiceId));
  if (!invoice) return { ok: false, reason: "not_found" };
  // ⚠️⚠️ Two payments crossing on one invoice both read what it owes before either lands; the
  // database lets the first take it and refuses the second (`overpays`). The money still
  // arrived: read what is owed again and record it, the rest as credit. Refusing it lost a
  // transfer that had reached the bank (29 September 2026, src/lib/money-on-postgres.test.ts).
  let share = 0;
  let result: Awaited<ReturnType<typeof recordReceipt>> | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await balanceOf(db, input.invoiceId);
    share = Math.max(0, Math.min(amount, before?.outstanding ?? 0));
    result = await recordReceipt(db, {
      companyId: invoice.companyId,
      currency: invoice.currency,
      amount,
      receivedAt: input.paidAt ?? new Date(),
      method: input.method,
      reference: input.reference,
      note: input.note,
      by: input.by,
      allocations: share > 0 ? [{ invoiceId: input.invoiceId, amount: share }] : [],
    });
    if (result.ok || result.reason !== "overpays") break;
  }
  if (!result) return { ok: false, reason: "not_found" };
  if (!result.ok) {
    const reason = result.reason === "invalid_allocation" ? "invalid_amount" : result.reason;
    return { ok: false, reason: reason === "not_found" || reason === "invalid_amount" ? reason : "not_receivable" };
  }
  const balance = await balanceOf(db, input.invoiceId);
  if (!balance) return { ok: false, reason: "not_found" };
  return {
    ok: true,
    paymentId: result.allocationIds[0] ?? null,
    balance,
    becamePaid: result.settled.some((x) => x.invoiceId === input.invoiceId),
    toCredit: Math.round((amount - share) * 100) / 100,
  };
}

/** The payments that name an invoice, newest first. */
export interface InvoicePayment {
  id: string;
  amount: string;
  paidAt: Date;
  method: string | null;
  note: string | null;
  recordedById: string | null;
  /** The money this is a share of (I10): its reference, and whether it paid other documents too. */
  receiptId: string | null;
  reference: string | null;
  receiptAmount: string | null;
  /** The money came from a bank line: taking the payment back leaves it as credit, never deletes it. */
  bankLinked: boolean;
}

export async function invoicePayments(db: AnyDb, invoiceId: string): Promise<InvoicePayment[]> {
  return db
    .select({
      id: orderPayments.id,
      amount: orderPayments.amount,
      paidAt: orderPayments.paidAt,
      method: orderPayments.method,
      note: orderPayments.note,
      recordedById: orderPayments.recordedById,
      receiptId: orderPayments.receiptId,
      reference: receipts.reference,
      receiptAmount: receipts.amount,
      bankLinked: sql<boolean>`${receipts.bankTransactionId} is not null`,
    })
    .from(orderPayments)
    .leftJoin(receipts, eq(receipts.id, orderPayments.receiptId))
    .where(eq(orderPayments.invoiceId, invoiceId))
    .orderBy(sql`${orderPayments.paidAt} desc`);
}

/**
 * The deposits left on an order, given to the invoice of it just issued, never beyond what it
 * owes (src/lib/receipts.ts, `linkOrderDeposits`).
 */
export async function linkOrderPayments(db: AnyDb, orderId: string, invoiceId: string): Promise<number> {
  return linkOrderDeposits(db, orderId, invoiceId);
}

/** An invoice's balance now, read from its rows. */
export async function balanceOf(db: AnyDb, invoiceId: string) {
  const [invoice] = await db
    .select({ total: invoices.total, credited: invoices.creditedAmount })
    .from(invoices)
    .where(eq(invoices.id, invoiceId));
  if (!invoice) return null;
  const rows = await db
    .select({ amount: orderPayments.amount })
    .from(orderPayments)
    .where(eq(orderPayments.invoiceId, invoiceId));
  return invoiceBalance(invoice.total, invoice.credited, rows);
}
