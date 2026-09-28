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
import { and, eq, inArray, sql } from "drizzle-orm";

import { bankTransactions, companies, invoices, orderPayments, orders, receipts } from "@/db/schema";
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
  | "already_reconciled";

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

/** Statements that must land together: a batch on the HTTP driver, a transaction elsewhere. */
async function together(db: AnyDb, statements: (h: AnyDb) => unknown[]): Promise<unknown[]> {
  if (typeof db.batch === "function") return db.batch(statements(db));
  return db.transaction(async (tx: AnyDb) => {
    const out: unknown[] = [];
    for (const statement of statements(tx)) out.push(await statement);
    return out;
  });
}

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
    ]);
  } catch (error) {
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
  try {
    await together(db, (h) => [
      // The row lock: a second allocation of the same credit waits here for the first.
      h
        .select({ id: receipts.id })
        .from(receipts)
        .where(eq(receipts.id, receipt.id))
        .for("update"),
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
    ]);
  } catch (error) {
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
 */
export async function linkAllocation(
  db: AnyDb,
  input: { allocationId: string; invoiceId: string },
): Promise<{ ok: true; settled: Settled[] } | { ok: false; reason: ReceiptRefusal }> {
  const [allocation] = await db
    .select({
      id: orderPayments.id,
      orderId: orderPayments.orderId,
      invoiceId: orderPayments.invoiceId,
      amount: orderPayments.amount,
    })
    .from(orderPayments)
    .where(eq(orderPayments.id, input.allocationId));
  if (!allocation || allocation.invoiceId) return { ok: false, reason: "not_found" };
  const doc = (await invoiceDocs(db, [input.invoiceId])).get(input.invoiceId);
  if (!doc) return { ok: false, reason: "not_found" };
  if (doc.status !== "issued" || !RECEIVABLE_TYPES.includes(doc.documentType))
    return { ok: false, reason: "not_receivable" };
  if (!allocation.orderId || doc.orderId !== allocation.orderId) return { ok: false, reason: "other_customer" };

  // Conditional: two people linking the same deposit to two invoices link it once.
  const updated = await db
    .update(orderPayments)
    .set({ invoiceId: doc.id })
    .where(and(eq(orderPayments.id, allocation.id), sql`${orderPayments.invoiceId} is null`))
    .returning({ id: orderPayments.id });
  if (updated.length === 0) return { ok: false, reason: "not_found" };
  const settled = await settledBy(db, [doc], new Map([[doc.id, Number(allocation.amount)]]));
  return { ok: true, settled };
}

/**
 * Takes a payment back. The receipt goes with it when this was its only allocation — money
 * recorded by mistake; otherwise only this share goes, and returns to the customer's credit.
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
      companyId: receipts.companyId,
      siblings: sql<number>`(select count(*)::int from order_payment s where s.receipt_id = "order_payment"."receipt_id")`,
    })
    .from(orderPayments)
    .leftJoin(receipts, eq(receipts.id, orderPayments.receiptId))
    .where(eq(orderPayments.id, allocationId));
  if (!row) return { removed: null, invoiceId: null, orderId: null, companyId: null };
  if (row.receiptId && Number(row.siblings) <= 1) {
    await db.delete(receipts).where(eq(receipts.id, row.receiptId));
    return { removed: "receipt", invoiceId: row.invoiceId, orderId: row.orderId, companyId: row.companyId };
  }
  await db.delete(orderPayments).where(eq(orderPayments.id, allocationId));
  return { removed: "allocation", invoiceId: row.invoiceId, orderId: row.orderId, companyId: row.companyId };
}

/**
 * Corrects a receipt: its day, amount, method, reference or note. A receipt with one
 * allocation of all of it — a payment typed on an invoice or an order — moves that allocation
 * with it; any other may not shrink below what it has already paid.
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
): Promise<{ ok: true; invoiceIds: string[]; orderIds: string[] } | { ok: false; reason: ReceiptRefusal }> {
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

  let amount = Number(receipt.amount);
  if (input.amount !== undefined) {
    const parsed = parsePaymentAmount(input.amount);
    if (parsed === null || amount < 0) return { ok: false, reason: "invalid_amount" };
    amount = parsed;
  }
  const whole = allocations.length === 1 && cents(Number(allocations[0].amount)) === cents(Number(receipt.amount));
  const allocated = allocations.reduce((s, a) => s + Number(a.amount), 0);
  if (!whole && cents(amount) < cents(allocated)) return { ok: false, reason: "over_allocated" };

  const receivedAt = input.receivedAt ?? receipt.receivedAt;
  const method = input.method !== undefined ? clean(input.method, 100) : receipt.method;
  const note = input.note !== undefined ? clean(input.note, 1000) : receipt.note;
  await together(db, (h) => [
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
  ]);
  return {
    ok: true,
    invoiceIds: allocations.flatMap((a) => (a.invoiceId ? [a.invoiceId] : [])),
    orderIds: allocations.flatMap((a) => (a.orderId ? [a.orderId] : [])),
  };
}

/**
 * Money given back to a customer: on an invoice they paid beyond what it owes (a credit note
 * after the payment, or a payment twice), or out of their credit. A negative receipt, with a
 * negative allocation on the invoice when there is one — so the invoice reads settled and the
 * month's cash reads what really stayed.
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

  if (input.invoiceId) {
    const doc = (await invoiceDocs(db, [input.invoiceId])).get(input.invoiceId);
    if (!doc) return { ok: false, reason: "not_found" };
    const [sum] = await db
      .select({ paid: sql<string>`coalesce(sum(${orderPayments.amount}), 0)` })
      .from(orderPayments)
      .where(eq(orderPayments.invoiceId, doc.id));
    const due = Number(doc.total) - Number(doc.credited);
    const over = Number(sum.paid) - due;
    if (cents(over) < cents(amount)) return { ok: false, reason: "not_overpaid" };
    await together(db, (h) => [
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
    ]);
    return { ok: true, receiptId };
  }

  if (!input.companyId) return { ok: false, reason: "not_found" };
  const currency = input.currency ?? "EUR";
  const credit = (await customerCredit(db, input.companyId)).find((c) => c.currency === currency)?.credit ?? 0;
  if (cents(credit) < cents(amount)) return { ok: false, reason: "no_credit" };
  await db.insert(receipts).values({ ...base, companyId: input.companyId, currency });
  return { ok: true, receiptId };
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
  return rows
    .map((r) => ({
      id: r.id,
      receivedAt: r.receivedAt,
      currency: r.currency,
      reference: r.reference,
      left: Math.round((Number(r.amount) - Number(r.allocated)) * 100) / 100,
    }))
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
