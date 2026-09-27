/**
 * What customers still owe, invoice by invoice (I9): the receivables schedule on Finance,
 * and the balance on an invoice's own page.
 *
 * ⚠️⚠️ **An invoice owes its total, less what its credit notes gave back, less the payments
 * that name it.** A credit note is not a payment and a payment is not a credit note: one
 * changes what was due, the other what arrived. Both come off, each from its own column,
 * and the arithmetic is `paymentSummary` — the same one an order's page uses.
 *
 * ⚠️ **Only an issued invoice (TD01) is a receivable.** A draft is not a debt yet, and a
 * credit note is money going the other way.
 *
 * ⚠️ **Due is the due date, or the issue date when none was set**: an invoice that names no
 * term is due on receipt, and one that could never be overdue would never be chased.
 * Days are counted on the workspace's clock — "overdue since yesterday" must not depend on
 * the server's time zone.
 *
 * ⚠️ **Amounts are per currency.** An invoice in dollars and one in euros are not added up;
 * the schedule's totals are grouped by currency, like every total across documents.
 */
import { and, eq, sql } from "drizzle-orm";

import { companies, invoices, orderPayments } from "@/db/schema";
import { type PaymentState, parsePaymentAmount, paymentSummary } from "@/lib/order-payment";

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
export async function receivables(db: AnyDb, input: { today: string }): Promise<ReceivablesSchedule> {
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
    })
    .from(invoices)
    .leftJoin(paidPerInvoice, eq(paidPerInvoice.invoiceId, invoices.id))
    .leftJoin(companies, eq(companies.id, invoices.companyId))
    .where(
      and(
        eq(invoices.status, "issued"),
        eq(invoices.documentType, "TD01"),
        // A tenth of a cent is not a debt: the same threshold paymentSummary uses.
        sql`round(${invoices.total} - ${invoices.creditedAmount} - coalesce(${paidPerInvoice.paid}, 0), 2) > 0`,
      ),
    );

  const list: Receivable[] = rows
    .map((r) => {
      const balance = invoiceBalance(r.total, r.credited, [{ amount: r.paid }]);
      const due = r.dueDate ?? r.issueDate ?? input.today;
      const aging = agingBucket(due, input.today);
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
    t.buckets[r.bucket] = Math.round((t.buckets[r.bucket] + r.outstanding) * 100) / 100;
    t.outstanding = Math.round((t.outstanding + r.outstanding) * 100) / 100;
    if (r.bucket !== "current") t.overdue = Math.round((t.overdue + r.outstanding) * 100) / 100;
    byCurrency.set(r.currency, t);
  }
  return { today: input.today, invoices: list, totals: [...byCurrency.values()] };
}

export type RecordPaymentResult =
  | { ok: true; paymentId: string; balance: ReturnType<typeof invoiceBalance>; becamePaid: boolean }
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
    note?: string | null;
    by: string | null;
  },
): Promise<RecordPaymentResult> {
  // One reading of the amount, for the check and for the write (src/lib/order-payment.ts).
  const amount = parsePaymentAmount(input.amount);
  if (amount === null) return { ok: false, reason: "invalid_amount" };
  const [invoice] = await db
    .select({
      id: invoices.id,
      status: invoices.status,
      documentType: invoices.documentType,
      orderId: invoices.orderId,
      total: invoices.total,
      credited: invoices.creditedAmount,
    })
    .from(invoices)
    .where(eq(invoices.id, input.invoiceId));
  if (!invoice) return { ok: false, reason: "not_found" };
  if (invoice.status !== "issued" || invoice.documentType !== "TD01") return { ok: false, reason: "not_receivable" };

  const paymentId = crypto.randomUUID();
  await db.insert(orderPayments).values({
    id: paymentId,
    orderId: invoice.orderId,
    invoiceId: invoice.id,
    amount: String(amount),
    paidAt: input.paidAt ?? new Date(),
    method: input.method?.trim() || null,
    note: input.note?.trim() || null,
    recordedById: input.by,
  });
  const rows = await db
    .select({ amount: orderPayments.amount })
    .from(orderPayments)
    .where(eq(orderPayments.invoiceId, invoice.id));
  const balance = invoiceBalance(invoice.total, invoice.credited, rows);
  const settled = balance.outstanding <= 0;
  // Settled now, and not before this payment's amount arrived.
  const becamePaid = settled && balance.outstanding + amount > 0;
  return { ok: true, paymentId, balance, becamePaid };
}

/** The payments that name an invoice, newest first. */
export interface InvoicePayment {
  id: string;
  amount: string;
  paidAt: Date;
  method: string | null;
  note: string | null;
  recordedById: string | null;
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
    })
    .from(orderPayments)
    .where(eq(orderPayments.invoiceId, invoiceId))
    .orderBy(sql`${orderPayments.paidAt} desc`);
}

/**
 * When an order's invoice is issued, the money already recorded on the order (a deposit)
 * reaches it — by the rule migration 0053 applied to the past: only while the order has
 * exactly one issued invoice, since with two nobody can say which one it paid. One
 * statement, so an invoice issued beside it cannot slip between the count and the link.
 */
export async function linkOrderPayments(db: AnyDb, orderId: string): Promise<number> {
  const result = await db.execute(sql`
    update order_payment p set invoice_id = only_one.id
    from (
      select i.order_id, min(i.id) as id
      from invoice i
      where i.status = 'issued' and i.document_type = 'TD01' and i.order_id = ${orderId}
      group by i.order_id
      having count(*) = 1
    ) only_one
    where p.invoice_id is null and p.order_id = only_one.order_id
    returning p.id`);
  return (result.rows ?? result).length;
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
