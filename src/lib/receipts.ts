/**
 * Money that arrived, and where it went (I10, migration 0059).
 *
 * ⚠️⚠️ **Two facts, two tables.** A receipt (`receipt`) is what reached the account: the day,
 * the amount, the bank's reference, the customer. Its allocations (`order_payment`) say which
 * documents it paid, and how much of it each: one transfer can settle three invoices, and an
 * invoice can be settled by three transfers. What is left unallocated is the customer's
 * credit, which a later invoice can use. A negative receipt is money given back — a refund.
 *
 * - "Collected" reads receipts, by the day they arrived: cash, whatever it was allocated to.
 * - What an invoice owes reads the allocations that name it (src/lib/receivables.ts).
 * - An order's balance reads the allocations that name the order.
 *
 * ⚠️⚠️ **An allocation never exceeds its receipt.** Allocating credit to an invoice locks the
 * receipt's row, inserts, and then checks the sum inside the same transaction: two people —
 * or a person and the bank reconciliation — allocating the same credit at once are put in a
 * queue by the database, and the second one fails instead of spending the money twice. A
 * check read before the write, or a stored "allocated" figure, would each let one through.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { bankTransactions, companies, invoices, orderPayments, orders, receipts } from "@/db/schema";
import { together } from "@/lib/db-together";
import { RECEIVABLE_TYPES } from "@/lib/invoice-rules";
import { parsePaymentAmount, paymentSummary } from "@/lib/order-payment";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle's database types differ per driver
type AnyDb = any;

/** The documents money can be allocated to: an issued invoice or deposit invoice (I11). */
export { RECEIVABLE_TYPES } from "@/lib/invoice-rules";

export type ReceiptRefusal =
  | "invalid_amount"
  | "invalid_allocation"
  | "over_allocated"
  | "not_found"
  | "not_receivable"
  | "other_customer"
  | "mixed_currency"
  | "not_overpaid"
  | "no_credit"
  /** The bank line is explained already, or ignored (I13). */
  | "already_reconciled"
  /** An invoice would receive more than it owes: the rest is the customer's credit. */
  | "overpays"
  /** The receipt came from the bank statement: its amount and day are the bank's (I13). */
  | "reconciled"
  /** A refund's amount is corrected by taking it back and recording it again. */
  | "refund_fixed";

export interface AllocationInput {
  /** An issued invoice. Its order is named too, so the order's balance keeps counting it. */
  invoiceId?: string | null;
  /** An order with no invoice to pay yet: a deposit. */
  orderId?: string | null;
  amount: unknown;
}

export interface ReceiptInput {
  companyId?: string | null;
  amount: unknown;
  receivedAt: Date;
  /** Needed only when nothing is allocated; otherwise it is the documents' currency. */
  currency?: string | null;
  method?: string | null;
  reference?: string | null;
  note?: string | null;
  accountId?: string | null;
  source?: "manual" | "bank" | "card";
  bankTransactionId?: string | null;
  by: string | null;
  allocations: AllocationInput[];
}

/** An invoice this write settled: the one that brought what it owes to nothing. */
export interface Settled {
  invoiceId: string;
  paid: number;
  due: number;
}

export type ReceiptResult =
  | { ok: true; receiptId: string; allocationIds: string[]; settled: Settled[] }
  | { ok: false; reason: ReceiptRefusal };

const cents = (n: number) => Math.round(n * 100);
const clean = (s: string | null | undefined, max = 300) => s?.trim().slice(0, max) || null;

/**
 * Fails the transaction when a receipt's allocations exceed it — the check that decides, read
 * after the insert and under the receipt's row lock. A division by zero is how a plain SELECT
 * refuses: it needs no function, no trigger and no migration.
 */
function guardNotOverAllocated(h: AnyDb, receiptId: string) {
  return h
    .select({
      // The divisor depends on the row, so the division happens only when it must: a constant
      // `1 / 0` inside a CASE is folded while the query is planned and fails every time.
      ok: sql<number>`1 / (case when abs(coalesce((select sum(p.amount) from order_payment p where p.receipt_id = ${receiptId}), 0)) > abs("receipt"."amount") then 0 else 1 end)`,
    })
    .from(receipts)
    .where(eq(receipts.id, receiptId));
}

/** The bank line's row lock: two confirmations of one line are put in a queue here (I13). */
export function lockBankTransaction(h: AnyDb, transactionId: string) {
  return h
    .select({ id: bankTransactions.id })
    .from(bankTransactions)
    .where(eq(bankTransactions.id, transactionId))
    .for("update");
}

/**
 * Fails the transaction when the receipts naming a bank line would explain more than the line,
 * explain it with money going the other way, or explain a line somebody ignored — read after the
 * write, under the line's lock, like `guardNotOverAllocated`.
 */
export function guardBankTransaction(h: AnyDb, transactionId: string) {
  return h
    .select({
      ok: sql<number>`1 / (case when "bank_transaction"."ignored_at" is not null
        or abs(coalesce((select sum(r.amount) from receipt r where r.bank_transaction_id = ${transactionId}), 0)) > abs("bank_transaction"."amount")
        or exists (select 1 from receipt r where r.bank_transaction_id = ${transactionId} and sign(r.amount) <> sign("bank_transaction"."amount"))
        then 0 else 1 end)`,
    })
    .from(bankTransactions)
    .where(eq(bankTransactions.id, transactionId));
}

/** Payments to one invoice queue behind each other here. */
function lockInvoices(h: AnyDb, ids: readonly string[]) {
  return h
    .select({ id: invoices.id })
    .from(invoices)
    .where(inArray(invoices.id, [...ids]))
    .for("update");
}

/** Credit operations of one customer queue behind each other here. */
function lockCompany(h: AnyDb, companyId: string) {
  return h.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).for("update");
}

/**
 * ⚠️⚠️ Fails the transaction when an invoice would be paid more than it owes (its total less its
 * credit notes). What a customer pays beyond an invoice is their credit, never an overpaid invoice
 * that no total shows and no later invoice can use. Read after the write, under the invoices'
 * locks; a failed cast rather than a division, so the error says which rule refused.
 */
function guardInvoicesNotOverpaid(h: AnyDb, ids: readonly string[]) {
  const list = JSON.stringify([...ids]);
  return h.execute(sql`
    select (case when coalesce((select sum(p.amount) from order_payment p where p.invoice_id = i.id), 0)
                      > i.total - i.credited_amount + 0.005
                 then 'overpays:' || i.id else '1' end)::int as ok
    from invoice i where i.id in (select jsonb_array_elements_text(${list}::jsonb))`);
}

/** Fails when a refund on an invoice would give back more than was paid beyond what it owes. */
function guardInvoiceNotUnderpaid(h: AnyDb, invoiceId: string) {
  return h.execute(sql`
    select (case when coalesce((select sum(p.amount) from order_payment p where p.invoice_id = i.id), 0)
                      < i.total - i.credited_amount - 0.005
                 then 'not_overpaid:' || i.id else '1' end)::int as ok
    from invoice i where i.id = ${invoiceId}`);
}

/** Fails when a customer's credit in any currency would go below nothing. */
function guardCustomerCredit(h: AnyDb, companyId: string) {
  return h.execute(sql`
    select (case when exists (
      select 1 from receipt r
      where r.company_id = ${companyId}
      group by r.currency
      having sum(r.amount) - coalesce(sum((select sum(p.amount) from order_payment p where p.receipt_id = r.id)), 0) < -0.005
    ) then 'no_credit:' || ${companyId} else '1' end)::int as ok`);
}

function errorText(error: unknown): string {
  const e = error as { message?: string; cause?: { message?: string } };
  return `${e?.message ?? ""} ${e?.cause?.message ?? ""}`;
}

/** Which of the guards above refused, if one did. */
export function guardRefusal(error: unknown): "overpays" | "not_overpaid" | "no_credit" | null {
  const text = errorText(error);
  if (text.includes("overpays:")) return "overpays";
  if (text.includes("not_overpaid:")) return "not_overpaid";
  if (text.includes("no_credit:")) return "no_credit";
  return null;
}

export function isOverAllocation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string }; message?: string };
  return e?.code === "22012" || e?.cause?.code === "22012" || /division by zero/i.test(String(e?.message ?? ""));
}

interface InvoiceDoc {
  id: string;
  status: string;
  documentType: string;
  orderId: string | null;
  companyId: string | null;
  currency: string;
  total: string;
  credited: string;
}

async function invoiceDocs(db: AnyDb, ids: string[]): Promise<Map<string, InvoiceDoc>> {
  if (ids.length === 0) return new Map();
  const rows: InvoiceDoc[] = await db
    .select({
      id: invoices.id,
      status: invoices.status,
      documentType: invoices.documentType,
      orderId: invoices.orderId,
      companyId: invoices.companyId,
      currency: invoices.currency,
      total: invoices.total,
      credited: invoices.creditedAmount,
    })
    .from(invoices)
    .where(inArray(invoices.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

/** What these invoices owe now, and which of them this write brought to nothing. */
async function settledBy(db: AnyDb, docs: InvoiceDoc[], allocatedNow: Map<string, number>): Promise<Settled[]> {
  if (docs.length === 0) return [];
  const sums: { invoiceId: string; paid: string }[] = await db
    .select({ invoiceId: orderPayments.invoiceId, paid: sql<string>`sum(${orderPayments.amount})` })
    .from(orderPayments)
    .where(
      inArray(
        orderPayments.invoiceId,
        docs.map((d) => d.id),
      ),
    )
    .groupBy(orderPayments.invoiceId);
  const paid = new Map(sums.map((s) => [s.invoiceId, s.paid]));
  const out: Settled[] = [];
  for (const doc of docs) {
    const due = Math.round((Number(doc.total) - Number(doc.credited)) * 100) / 100;
    const s = paymentSummary(due, [{ amount: paid.get(doc.id) ?? 0 }]);
    const now = allocatedNow.get(doc.id) ?? 0;
    // Settled now, and not before this write's share arrived.
    if (s.outstanding <= 0 && s.outstanding + now > 0) out.push({ invoiceId: doc.id, paid: s.paid, due });
  }
  return out;
}

/**
 * Records money that arrived and, in the same transaction, where it went.
 *
 * Every allocation must be to an issued invoice or an order of the same customer and in the
 * same currency, and together they may not exceed the receipt; what they leave is credit.
 */
export async function recordReceipt(db: AnyDb, input: ReceiptInput): Promise<ReceiptResult> {
  const amount = parsePaymentAmount(input.amount);
  if (amount === null) return { ok: false, reason: "invalid_amount" };

  const parts: { invoiceId: string | null; orderId: string | null; amount: number }[] = [];
  for (const a of input.allocations) {
    const share = parsePaymentAmount(a.amount);
    if (share === null || (!a.invoiceId && !a.orderId)) return { ok: false, reason: "invalid_allocation" };
    parts.push({ invoiceId: a.invoiceId ?? null, orderId: a.orderId ?? null, amount: share });
  }
  if (cents(parts.reduce((s, p) => s + p.amount, 0)) > cents(amount)) return { ok: false, reason: "over_allocated" };

  const invoiceIds = [...new Set(parts.flatMap((p) => (p.invoiceId ? [p.invoiceId] : [])))];
  const orderIds = [...new Set(parts.flatMap((p) => (!p.invoiceId && p.orderId ? [p.orderId] : [])))];
  const docs = await invoiceDocs(db, invoiceIds);
  const orderRows: { id: string; companyId: string | null; currency: string }[] =
    orderIds.length > 0
      ? await db
          .select({ id: orders.id, companyId: orders.companyId, currency: orders.currency })
          .from(orders)
          .where(inArray(orders.id, orderIds))
      : [];
  const orderMap = new Map(orderRows.map((o) => [o.id, o]));

  const customerIds = new Set<string>();
  const currencies = new Set<string>();
  if (input.companyId) customerIds.add(input.companyId);
  for (const p of parts) {
    if (p.invoiceId) {
      const doc = docs.get(p.invoiceId);
      if (!doc) return { ok: false, reason: "not_found" };
      if (doc.status !== "issued" || !RECEIVABLE_TYPES.includes(doc.documentType))
        return { ok: false, reason: "not_receivable" };
      if (doc.companyId) customerIds.add(doc.companyId);
      currencies.add(doc.currency);
      p.orderId = doc.orderId;
    } else if (p.orderId) {
      const order = orderMap.get(p.orderId);
      if (!order) return { ok: false, reason: "not_found" };
      if (order.companyId) customerIds.add(order.companyId);
      currencies.add(order.currency);
    }
  }
  if (customerIds.size > 1) return { ok: false, reason: "other_customer" };
  if (currencies.size > 1 || (input.currency && currencies.size === 1 && !currencies.has(input.currency)))
    return { ok: false, reason: "mixed_currency" };

  const receiptId = crypto.randomUUID();
  const allocationIds = parts.map(() => crypto.randomUUID());
  const method = clean(input.method, 100);
  const line = input.bankTransactionId ?? null;
  try {
    await together(db, (h) => [
      ...(line ? [lockBankTransaction(h, line)] : []),
      ...(invoiceIds.length > 0 ? [lockInvoices(h, invoiceIds)] : []),
      h.insert(receipts).values({
        id: receiptId,
        companyId: [...customerIds][0] ?? null,
        amount: String(amount),
        currency: [...currencies][0] ?? input.currency ?? "EUR",
        receivedAt: input.receivedAt,
        method,
        reference: clean(input.reference),
        note: clean(input.note, 1000),
        accountId: input.accountId ?? null,
        source: input.source ?? "manual",
        bankTransactionId: input.bankTransactionId ?? null,
        recordedById: input.by,
        updatedById: input.by,
      }),
      ...(parts.length > 0
        ? [
            h.insert(orderPayments).values(
              parts.map((p, i) => ({
                id: allocationIds[i],
                receiptId,
                orderId: p.orderId,
                invoiceId: p.invoiceId,
                amount: String(p.amount),
                paidAt: input.receivedAt,
                method,
                note: clean(input.note, 1000),
                recordedById: input.by,
              })),
            ),
          ]
        : []),
      ...(line ? [guardBankTransaction(h, line)] : []),
      ...(invoiceIds.length > 0 ? [guardInvoicesNotOverpaid(h, invoiceIds)] : []),
    ]);
  } catch (error) {
    if (guardRefusal(error) === "overpays") return { ok: false, reason: "overpays" };
    if (line && isOverAllocation(error)) return { ok: false, reason: "already_reconciled" };
    throw error;
  }

  const allocatedNow = new Map<string, number>();
  for (const p of parts)
    if (p.invoiceId) allocatedNow.set(p.invoiceId, (allocatedNow.get(p.invoiceId) ?? 0) + p.amount);
  const settled = await settledBy(db, [...docs.values()], allocatedNow);
  return { ok: true, receiptId, allocationIds, settled };
}

// ⚠️ Correlated subqueries name their outer column in full ("receipt"."id"): inside a select
// list Drizzle writes a column without its table, and `p.receipt_id = "id"` then compares the
// allocation with its own id — every sum came back zero.

/** What is left of a receipt once its allocations are taken off. */
export async function unallocatedOf(db: AnyDb, receiptId: string): Promise<number | null> {
  const [row] = await db
    .select({
      amount: receipts.amount,
      allocated: sql<string>`coalesce((select sum(p.amount) from order_payment p where p.receipt_id = "receipt"."id"), 0)`,
    })
    .from(receipts)
    .where(eq(receipts.id, receiptId));
  if (!row) return null;
  return Math.round((Number(row.amount) - Number(row.allocated)) * 100) / 100;
}

/**
 * Part of a receipt's credit, allocated to an invoice of the same customer and currency.
 * Under the receipt's row lock, and refused by the database when the credit is not there.
 */
export async function allocateCredit(
  db: AnyDb,
  input: { receiptId: string; invoiceId: string; amount: unknown; by: string | null },
): Promise<{ ok: true; allocationId: string; settled: Settled[] } | { ok: false; reason: ReceiptRefusal }> {
  const amount = parsePaymentAmount(input.amount);
  if (amount === null) return { ok: false, reason: "invalid_amount" };
  const [receipt] = await db
    .select({
      id: receipts.id,
      amount: receipts.amount,
      companyId: receipts.companyId,
      currency: receipts.currency,
      receivedAt: receipts.receivedAt,
      method: receipts.method,
    })
    .from(receipts)
    .where(eq(receipts.id, input.receiptId));
  if (!receipt || Number(receipt.amount) <= 0) return { ok: false, reason: "not_found" };
  const doc = (await invoiceDocs(db, [input.invoiceId])).get(input.invoiceId);
  if (!doc) return { ok: false, reason: "not_found" };
  if (doc.status !== "issued" || !RECEIVABLE_TYPES.includes(doc.documentType))
    return { ok: false, reason: "not_receivable" };
  if (receipt.companyId && doc.companyId && receipt.companyId !== doc.companyId)
    return { ok: false, reason: "other_customer" };
  if (receipt.currency !== doc.currency) return { ok: false, reason: "mixed_currency" };

  const allocationId = crypto.randomUUID();
  const credit = receipt.companyId ?? doc.companyId;
  try {
    await together(db, (h) => [
      // The row locks: a second allocation of the same credit — or a refund of it, or a second
      // payment of the same invoice — waits here for the first.
      ...(credit ? [lockCompany(h, credit)] : []),
      h.select({ id: receipts.id }).from(receipts).where(eq(receipts.id, receipt.id)).for("update"),
      lockInvoices(h, [doc.id]),
      h.insert(orderPayments).values({
        id: allocationId,
        receiptId: receipt.id,
        orderId: doc.orderId,
        invoiceId: doc.id,
        amount: String(amount),
        paidAt: receipt.receivedAt,
        method: receipt.method,
        recordedById: input.by,
      }),
      guardNotOverAllocated(h, receipt.id),
      guardInvoicesNotOverpaid(h, [doc.id]),
      // ⚠️⚠️ A refund out of credit is a negative receipt of its own: this receipt still has room
      // for it, and only the customer's whole credit says the money is gone.
      ...(credit ? [guardCustomerCredit(h, credit)] : []),
    ]);
  } catch (error) {
    const refused = guardRefusal(error);
    if (refused === "overpays") return { ok: false, reason: "overpays" };
    if (refused === "no_credit") return { ok: false, reason: "no_credit" };
    if (isOverAllocation(error)) return { ok: false, reason: "over_allocated" };
    throw error;
  }
  if (receipt.companyId === null && doc.companyId) {
    await db.update(receipts).set({ companyId: doc.companyId }).where(eq(receipts.id, receipt.id));
  }
  const settled = await settledBy(db, [doc], new Map([[doc.id, amount]]));
  return { ok: true, allocationId, settled };
}

/**
 * Gives a deposit recorded on an order to one of the order's issued invoices — the payments
 * that stayed on an order with several invoices, which nothing could link before I10.
 *
 * ⚠️⚠️ Never beyond what the invoice owes: a deposit larger than that is split, the invoice's
 * share linked and the rest left on the order as a deposit. Linking it whole overpaid the
 * invoice, and the next invoice of the order read unpaid.
 */
export async function linkAllocation(
  db: AnyDb,
  input: { allocationId: string; invoiceId: string },
): Promise<{ ok: true; settled: Settled[] } | { ok: false; reason: ReceiptRefusal }> {
  const [allocation] = await db
    .select({
      id: orderPayments.id,
      receiptId: orderPayments.receiptId,
      orderId: orderPayments.orderId,
      invoiceId: orderPayments.invoiceId,
      amount: orderPayments.amount,
      paidAt: orderPayments.paidAt,
      method: orderPayments.method,
      note: orderPayments.note,
      recordedById: orderPayments.recordedById,
    })
    .from(orderPayments)
    .where(eq(orderPayments.id, input.allocationId));
  if (!allocation || allocation.invoiceId) return { ok: false, reason: "not_found" };
  const doc = (await invoiceDocs(db, [input.invoiceId])).get(input.invoiceId);
  if (!doc) return { ok: false, reason: "not_found" };
  if (doc.status !== "issued" || !RECEIVABLE_TYPES.includes(doc.documentType))
    return { ok: false, reason: "not_receivable" };
  if (!allocation.orderId || doc.orderId !== allocation.orderId) return { ok: false, reason: "other_customer" };

  const owed = await outstandingOf(db, doc.id);
  const share = Math.min(cents(Number(allocation.amount)), cents(owed));
  if (share <= 0) return { ok: false, reason: "overpays" };
  const rest = cents(Number(allocation.amount)) - share;
  try {
    const [, linked] = (await together(db, (h) => [
      lockInvoices(h, [doc.id]),
      // Conditional: two people linking the same deposit to two invoices link it once.
      h
        .update(orderPayments)
        .set({ invoiceId: doc.id, amount: String(share / 100) })
        .where(and(eq(orderPayments.id, allocation.id), sql`${orderPayments.invoiceId} is null`))
        .returning({ id: orderPayments.id }),
      ...(rest > 0
        ? [
            h.insert(orderPayments).values({
              receiptId: allocation.receiptId,
              orderId: allocation.orderId,
              invoiceId: null,
              amount: String(rest / 100),
              paidAt: allocation.paidAt,
              method: allocation.method,
              note: allocation.note,
              recordedById: allocation.recordedById,
            }),
          ]
        : []),
      guardInvoicesNotOverpaid(h, [doc.id]),
    ])) as [unknown, { id: string }[]];
    if (linked.length === 0) return { ok: false, reason: "not_found" };
  } catch (error) {
    if (guardRefusal(error) === "overpays") return { ok: false, reason: "overpays" };
    throw error;
  }
  const settled = await settledBy(db, [doc], new Map([[doc.id, share / 100]]));
  return { ok: true, settled };
}

/**
 * Gives the deposits left on an order to one of its invoices, just issued: oldest first, never
 * beyond what the invoice owes — the last one split, its rest left on the order for the next
 * invoice. Returns how many were linked, whole or in part.
 *
 * ⚠️⚠️ It used to link every deposit whole, and only when the order had one invoice: a deposit
 * of 10,000 paid on the order went entirely to a deposit invoice of 3,000, and the balance of
 * 7,000 read unpaid and overdue while the customer had paid it.
 */
export async function linkOrderDeposits(db: AnyDb, orderId: string, invoiceId: string): Promise<number> {
  const doc = (await invoiceDocs(db, [invoiceId])).get(invoiceId);
  if (!doc || doc.orderId !== orderId || doc.status !== "issued" || !RECEIVABLE_TYPES.includes(doc.documentType))
    return 0;
  const deposits: {
    id: string;
    receiptId: string | null;
    amount: string;
    paidAt: Date;
    method: string | null;
    note: string | null;
    recordedById: string | null;
  }[] = await db
    .select({
      id: orderPayments.id,
      receiptId: orderPayments.receiptId,
      amount: orderPayments.amount,
      paidAt: orderPayments.paidAt,
      method: orderPayments.method,
      note: orderPayments.note,
      recordedById: orderPayments.recordedById,
    })
    .from(orderPayments)
    .where(and(eq(orderPayments.orderId, orderId), isNull(orderPayments.invoiceId), sql`${orderPayments.amount} > 0`))
    .orderBy(orderPayments.paidAt, orderPayments.createdAt);
  let room = cents(await outstandingOf(db, invoiceId));
  const plan: { deposit: (typeof deposits)[number]; share: number; rest: number }[] = [];
  for (const d of deposits) {
    if (room <= 0) break;
    const share = Math.min(room, cents(Number(d.amount)));
    plan.push({ deposit: d, share, rest: cents(Number(d.amount)) - share });
    room -= share;
  }
  if (plan.length === 0) return 0;
  try {
    await together(db, (h) => [
      lockInvoices(h, [invoiceId]),
      ...plan.flatMap(({ deposit, share, rest }) => [
        h
          .update(orderPayments)
          .set({ invoiceId, amount: String(share / 100) })
          .where(and(eq(orderPayments.id, deposit.id), isNull(orderPayments.invoiceId))),
        ...(rest > 0
          ? [
              h.insert(orderPayments).values({
                receiptId: deposit.receiptId,
                orderId,
                invoiceId: null,
                amount: String(rest / 100),
                paidAt: deposit.paidAt,
                method: deposit.method,
                note: deposit.note,
                recordedById: deposit.recordedById,
              }),
            ]
          : []),
      ]),
      guardInvoicesNotOverpaid(h, [invoiceId]),
    ]);
  } catch (error) {
    // Something paid the invoice meanwhile: the deposits stay on the order, nothing is lost.
    if (guardRefusal(error) === "overpays") return 0;
    throw error;
  }
  return plan.length;
}

/** What an invoice still owes: its total, less credit notes, less what names it. */
async function outstandingOf(db: AnyDb, invoiceId: string): Promise<number> {
  const [row] = await db
    .select({
      owed: sql<string>`"invoice"."total" - "invoice"."credited_amount" - coalesce((select sum(p.amount) from order_payment p where p.invoice_id = "invoice"."id"), 0)`,
    })
    .from(invoices)
    .where(eq(invoices.id, invoiceId));
  return row ? Math.max(0, Math.round(Number(row.owed) * 100) / 100) : 0;
}

/**
 * Takes a payment back. The receipt goes with it only when this allocation was all of it and it
 * did not come from the bank — money recorded by mistake; otherwise only this share goes, and
 * the money returns to the customer's credit.
 *
 * ⚠️⚠️ The first version deleted the receipt whenever this was its only allocation, whatever the
 * receipt held: a transfer of 1,000 with 600 on an invoice and 400 left as credit lost all 1,000
 * — from "collected", from the credit, and from its bank line, which quietly reopened.
 */
export async function removeAllocation(
  db: AnyDb,
  allocationId: string,
): Promise<{
  removed: "receipt" | "allocation" | null;
  invoiceId: string | null;
  orderId: string | null;
  companyId: string | null;
}> {
  const [row] = await db
    .select({
      receiptId: orderPayments.receiptId,
      invoiceId: orderPayments.invoiceId,
      orderId: orderPayments.orderId,
      amount: orderPayments.amount,
      companyId: receipts.companyId,
    })
    .from(orderPayments)
    .leftJoin(receipts, eq(receipts.id, orderPayments.receiptId))
    .where(eq(orderPayments.id, allocationId));
  if (!row) return { removed: null, invoiceId: null, orderId: null, companyId: null };
  const receiptId = row.receiptId;
  await together(db, (h) => [
    ...(receiptId
      ? [h.select({ id: receipts.id }).from(receipts).where(eq(receipts.id, receiptId)).for("update")]
      : []),
    h.delete(orderPayments).where(eq(orderPayments.id, allocationId)),
    // Read after the allocation went, under the receipt's lock: the receipt goes only when nothing
    // else names it, it was exactly this allocation, and no bank line explains it.
    ...(receiptId
      ? [
          h.execute(sql`
            delete from receipt r
            where r.id = ${receiptId}
              and r.bank_transaction_id is null
              and r.amount = ${row.amount}::numeric
              and not exists (select 1 from order_payment p where p.receipt_id = r.id)`),
        ]
      : []),
  ]);
  const [still] = receiptId
    ? await db.select({ id: receipts.id }).from(receipts).where(eq(receipts.id, receiptId))
    : [undefined];
  return {
    removed: receiptId && !still ? "receipt" : "allocation",
    invoiceId: row.invoiceId,
    orderId: row.orderId,
    companyId: row.companyId,
  };
}

/**
 * Corrects a receipt: its day, amount, method, reference or note. A receipt with one
 * allocation of all of it — a payment typed on an invoice or an order — moves that allocation
 * with it; any other may not shrink below what it has already paid.
 *
 * ⚠️⚠️ Under the receipt's and its invoices' locks, and checked by the database after the write:
 * the "not below what it paid" read before it let a credit allocation land in between.
 * ⚠️ A receipt from the bank statement keeps the bank's amount and day — the reconciliation page
 * undoes it; a refund's amount is corrected by taking it back and recording it again.
 */
export async function updateReceipt(
  db: AnyDb,
  input: {
    receiptId: string;
    amount?: unknown;
    receivedAt?: Date;
    method?: string | null;
    reference?: string | null;
    note?: string | null;
    by: string | null;
  },
): Promise<
  { ok: true; invoiceIds: string[]; orderIds: string[]; settled: Settled[] } | { ok: false; reason: ReceiptRefusal }
> {
  const [receipt] = await db.select().from(receipts).where(eq(receipts.id, input.receiptId));
  if (!receipt) return { ok: false, reason: "not_found" };
  const allocations: { id: string; amount: string; invoiceId: string | null; orderId: string | null }[] = await db
    .select({
      id: orderPayments.id,
      amount: orderPayments.amount,
      invoiceId: orderPayments.invoiceId,
      orderId: orderPayments.orderId,
    })
    .from(orderPayments)
    .where(eq(orderPayments.receiptId, receipt.id));

  const stored = Number(receipt.amount);
  let amount = stored;
  if (input.amount !== undefined) {
    const parsed = parsePaymentAmount(input.amount);
    if (parsed === null) return { ok: false, reason: "invalid_amount" };
    if (stored < 0) {
      // A refund: the amount shown is its size, and it does not change here.
      if (cents(parsed) !== cents(-stored)) return { ok: false, reason: "refund_fixed" };
    } else amount = parsed;
  }
  const receivedAt = input.receivedAt ?? receipt.receivedAt;
  if (
    receipt.bankTransactionId &&
    (cents(amount) !== cents(stored) || receivedAt.getTime() !== receipt.receivedAt.getTime())
  )
    return { ok: false, reason: "reconciled" };
  const whole = stored > 0 && allocations.length === 1 && cents(Number(allocations[0].amount)) === cents(stored);
  const invoiceIds = [...new Set(allocations.flatMap((a) => (a.invoiceId ? [a.invoiceId] : [])))];

  const method = input.method !== undefined ? clean(input.method, 100) : receipt.method;
  const note = input.note !== undefined ? clean(input.note, 1000) : receipt.note;
  try {
    await together(db, (h) => [
      h.select({ id: receipts.id }).from(receipts).where(eq(receipts.id, receipt.id)).for("update"),
      ...(invoiceIds.length > 0 ? [lockInvoices(h, invoiceIds)] : []),
      h
        .update(receipts)
        .set({
          amount: String(amount),
          receivedAt,
          method,
          reference: input.reference !== undefined ? clean(input.reference) : receipt.reference,
          note,
          updatedAt: new Date(),
          updatedById: input.by,
        })
        .where(eq(receipts.id, receipt.id)),
      // The allocations show the day and the method of their receipt.
      h
        .update(orderPayments)
        .set({ paidAt: receivedAt, method, note })
        .where(eq(orderPayments.receiptId, receipt.id)),
      ...(whole
        ? [
            h
              .update(orderPayments)
              .set({ amount: String(amount) })
              .where(eq(orderPayments.id, allocations[0].id)),
          ]
        : []),
      guardNotOverAllocated(h, receipt.id),
      ...(invoiceIds.length > 0 ? [guardInvoicesNotOverpaid(h, invoiceIds)] : []),
    ]);
  } catch (error) {
    if (guardRefusal(error) === "overpays") return { ok: false, reason: "overpays" };
    if (isOverAllocation(error)) return { ok: false, reason: "over_allocated" };
    throw error;
  }
  // A correction can settle an invoice as surely as a payment can: the integration is told.
  const docs = [...(await invoiceDocs(db, invoiceIds)).values()];
  const moved = whole && allocations[0].invoiceId ? amount - Number(allocations[0].amount) : 0;
  const settled = moved > 0 ? await settledBy(db, docs, new Map([[allocations[0].invoiceId as string, moved]])) : [];
  return {
    ok: true,
    invoiceIds,
    orderIds: allocations.flatMap((a) => (a.orderId ? [a.orderId] : [])),
    settled,
  };
}

/**
 * Money given back to a customer: on an invoice they paid beyond what it owes (a credit note
 * after the payment, or a payment twice), or out of their credit. A negative receipt, with a
 * negative allocation on the invoice when there is one — so the invoice reads settled and the
 * month's cash reads what really stayed.
 *
 * ⚠️⚠️ Each under a lock and checked by the database after the write: on the invoice, never more
 * than it was overpaid; out of credit, never more than the customer's credit. Checked in a read
 * before the write, a double click refunded twice.
 */
export async function recordRefund(
  db: AnyDb,
  input: {
    invoiceId?: string | null;
    companyId?: string | null;
    currency?: string | null;
    amount: unknown;
    receivedAt: Date;
    method?: string | null;
    reference?: string | null;
    note?: string | null;
    by: string | null;
  },
): Promise<{ ok: true; receiptId: string } | { ok: false; reason: ReceiptRefusal }> {
  const amount = parsePaymentAmount(input.amount);
  if (amount === null) return { ok: false, reason: "invalid_amount" };
  const receiptId = crypto.randomUUID();
  const base = {
    id: receiptId,
    amount: String(-amount),
    receivedAt: input.receivedAt,
    method: clean(input.method, 100),
    reference: clean(input.reference),
    note: clean(input.note, 1000),
    recordedById: input.by,
    updatedById: input.by,
  };

  try {
    if (input.invoiceId) {
      const doc = (await invoiceDocs(db, [input.invoiceId])).get(input.invoiceId);
      if (!doc) return { ok: false, reason: "not_found" };
      if (doc.status !== "issued" || !RECEIVABLE_TYPES.includes(doc.documentType))
        return { ok: false, reason: "not_receivable" };
      await together(db, (h) => [
        lockInvoices(h, [doc.id]),
        h.insert(receipts).values({ ...base, companyId: doc.companyId, currency: doc.currency }),
        h.insert(orderPayments).values({
          receiptId,
          orderId: doc.orderId,
          invoiceId: doc.id,
          amount: String(-amount),
          paidAt: input.receivedAt,
          method: base.method,
          note: base.note,
          recordedById: input.by,
        }),
        guardInvoiceNotUnderpaid(h, doc.id),
      ]);
      return { ok: true, receiptId };
    }

    const companyId = input.companyId;
    if (!companyId) return { ok: false, reason: "not_found" };
    const currency = (input.currency ?? "EUR").toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, reason: "mixed_currency" };
    await together(db, (h) => [
      lockCompany(h, companyId),
      h.insert(receipts).values({ ...base, companyId, currency }),
      guardCustomerCredit(h, companyId),
    ]);
    return { ok: true, receiptId };
  } catch (error) {
    const refused = guardRefusal(error);
    if (refused === "not_overpaid" || refused === "no_credit") return { ok: false, reason: refused };
    throw error;
  }
}

/**
 * Moves what an invoice was paid beyond what it owes back to the customer's credit: its most
 * recent allocations are reduced, newest first, and their receipts keep the money. For an invoice
 * a credit note brought below what was already paid, and for payments recorded twice.
 * Returns what was moved.
 */
export async function releaseOverpayment(db: AnyDb, invoiceId: string): Promise<number> {
  const [invoice] = await db
    .select({ total: invoices.total, credited: invoices.creditedAmount })
    .from(invoices)
    .where(eq(invoices.id, invoiceId));
  if (!invoice) return 0;
  const shares: { id: string; amount: string }[] = await db
    .select({ id: orderPayments.id, amount: orderPayments.amount })
    .from(orderPayments)
    .where(and(eq(orderPayments.invoiceId, invoiceId), sql`${orderPayments.amount} > 0`))
    .orderBy(sql`${orderPayments.paidAt} desc`, sql`${orderPayments.createdAt} desc`);
  const [paidRow] = await db
    .select({ paid: sql<string>`coalesce(sum(${orderPayments.amount}), 0)` })
    .from(orderPayments)
    .where(eq(orderPayments.invoiceId, invoiceId));
  let over = cents(Number(paidRow?.paid ?? 0)) - cents(Number(invoice.total) - Number(invoice.credited));
  if (over <= 0) return 0;
  const moved = over;
  const writes: { id: string; keep: number }[] = [];
  for (const s of shares) {
    if (over <= 0) break;
    const take = Math.min(over, cents(Number(s.amount)));
    writes.push({ id: s.id, keep: cents(Number(s.amount)) - take });
    over -= take;
  }
  await together(db, (h) => [
    lockInvoices(h, [invoiceId]),
    ...writes.map((w) =>
      w.keep > 0
        ? h
            .update(orderPayments)
            .set({ amount: String(w.keep / 100) })
            .where(eq(orderPayments.id, w.id))
        : h.delete(orderPayments).where(eq(orderPayments.id, w.id)),
    ),
  ]);
  return (moved - over) / 100;
}

/** A customer's credit per currency: what they paid that no document has used yet. */
export async function customerCredit(db: AnyDb, companyId: string): Promise<{ currency: string; credit: number }[]> {
  const rows: { currency: string; credit: string }[] = await db
    .select({
      currency: receipts.currency,
      credit: sql<string>`sum(${receipts.amount}) - coalesce(sum((select sum(p.amount) from order_payment p where p.receipt_id = "receipt"."id")), 0)`,
    })
    .from(receipts)
    .where(eq(receipts.companyId, companyId))
    .groupBy(receipts.currency);
  return rows
    .map((r) => ({ currency: r.currency, credit: Math.round(Number(r.credit) * 100) / 100 }))
    .filter((r) => r.credit >= 0.01);
}

/** The receipts of a customer with something left to allocate, oldest first. */
export async function openCredits(
  db: AnyDb,
  companyId: string,
): Promise<{ id: string; receivedAt: Date; currency: string; left: number; reference: string | null }[]> {
  const rows: {
    id: string;
    receivedAt: Date;
    currency: string;
    amount: string;
    allocated: string;
    reference: string | null;
  }[] = await db
    .select({
      id: receipts.id,
      receivedAt: receipts.receivedAt,
      currency: receipts.currency,
      amount: receipts.amount,
      reference: receipts.reference,
      allocated: sql<string>`coalesce((select sum(p.amount) from order_payment p where p.receipt_id = "receipt"."id"), 0)`,
    })
    .from(receipts)
    .where(and(eq(receipts.companyId, companyId), sql`${receipts.amount} > 0`))
    .orderBy(receipts.receivedAt);
  // ⚠️⚠️ Credit refunded to the customer is a negative receipt of its own, with no allocation:
  // it is taken off the oldest credits here, or the screen offered to spend money already given
  // back (the database refuses it anyway: guardCustomerCredit).
  const refunded: { currency: string; amount: string }[] = await db
    .select({ currency: receipts.currency, amount: sql<string>`sum(${receipts.amount})` })
    .from(receipts)
    .where(
      and(
        eq(receipts.companyId, companyId),
        sql`${receipts.amount} < 0`,
        sql`not exists (select 1 from order_payment p where p.receipt_id = "receipt"."id")`,
      ),
    )
    .groupBy(receipts.currency);
  const toTake = new Map(refunded.map((r) => [r.currency, -cents(Number(r.amount))]));
  return rows
    .map((r) => {
      let left = cents(Number(r.amount) - Number(r.allocated));
      const take = Math.min(left, toTake.get(r.currency) ?? 0);
      if (take > 0) {
        left -= take;
        toTake.set(r.currency, (toTake.get(r.currency) ?? 0) - take);
      }
      return { id: r.id, receivedAt: r.receivedAt, currency: r.currency, reference: r.reference, left: left / 100 };
    })
    .filter((r) => r.left >= 0.01);
}

/** The name on a receipt's customer, for lists that show whose money it was. */
export async function companyNameOf(db: AnyDb, companyId: string | null): Promise<string | null> {
  if (!companyId) return null;
  const [row] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, companyId));
  return row?.name ?? null;
}

/** The migration that made receipts (0059): the repair below applies from it on. */
export const RECEIPTS_SINCE = 1793059200000;

/**
 * Gives every payment still without a receipt one of its own — the copy migration 0059 made,
 * made again. Idempotent, one statement, nothing done when nothing needs it.
 *
 * ⚠️⚠️ Why it runs again: the migration can reach a database before the code that writes
 * receipts does — a workspace migrated from a machine running newer code, while production
 * still runs the old one. Every payment the old code records meanwhile has no receipt, and
 * "collected" and the customer's credit, which read receipts, would miss it for good. It runs
 * with the auto-migration (src/db/auto-migrate.ts), once per process and workspace.
 */
export async function healPaymentsWithoutReceipt(db: AnyDb): Promise<number> {
  const result = await db.execute(sql`
    with orphans as (
      select p.id, coalesce(i.company_id, o.company_id) as company_id, p.amount,
             coalesce(i.currency, o.currency, 'EUR') as currency, p.paid_at, p.method, p.note,
             p.recorded_by_id, p.created_at
      from order_payment p
      left join invoice i on i.id = p.invoice_id
      left join "order" o on o.id = p.order_id
      where p.receipt_id is null
    ), made as (
      insert into receipt (id, company_id, amount, currency, received_at, method, note, recorded_by_id, created_at, updated_at)
      select id, company_id, amount, currency, paid_at, method, note, recorded_by_id, created_at, created_at from orphans
      on conflict (id) do nothing
      returning id
    )
    update order_payment set receipt_id = order_payment.id
    where order_payment.receipt_id is null and order_payment.id in (select id from orphans)
    returning order_payment.id`);
  return (result.rows ?? result).length;
}
