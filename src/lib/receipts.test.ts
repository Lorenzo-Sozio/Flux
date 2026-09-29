/**
 * ⚠️⚠️ Money that arrived, and where it went (I10).
 *
 * A receipt is what reached the account; its allocations say which documents it paid; what is
 * left is the customer's credit. Before this a transfer paying two invoices could not be written
 * down, money beyond an invoice had nowhere to be, a payment on an order with two invoices paid
 * neither, and deleting a cancelled order deleted what the customer had paid on it.
 */
import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";
import { tenantMigrations } from "@/db/migrations-tenant.generated";
import * as schema from "@/db/schema";

import { paymentDay } from "./order-payment";
import {
  allocateCredit,
  customerCredit,
  healPaymentsWithoutReceipt,
  linkAllocation,
  openCredits,
  recordReceipt,
  recordRefund,
  releaseOverpayment,
  removeAllocation,
  unallocatedOf,
  updateReceipt,
} from "./receipts";
import { balanceOf, linkOrderPayments, receivables } from "./receivables";

const db = drizzle(new PGlite(), { schema });
const DAY = new Date("2026-09-20T10:00:00Z");

async function invoice(
  id: string,
  over: { status?: string; type?: string; company?: string; currency?: string; total?: string; order?: string } = {},
) {
  await db.execute(sql`insert into invoice (id, status, document_type, total, company_id, currency, order_id)
    values (${id}, ${over.status ?? "issued"}, ${over.type ?? "TD01"}, ${over.total ?? "1000"}, ${over.company ?? "acme"},
            ${over.currency ?? "EUR"}, ${over.order ?? null})`);
}

const owes = async (id: string) => (await balanceOf(db, id))?.outstanding;
const collected = async () =>
  Number(((await db.execute(sql`select coalesce(sum(amount), 0)::text as s from receipt`)).rows[0] as { s: string }).s);

beforeAll(async () => {
  await applyTenantMigrations(db as never);
  await db.execute(sql`insert into "user" (id, name, email) values ('u1', 'Anna', 'a@x.it')`);
}, 120_000);

beforeEach(async () => {
  for (const t of ["order_payment", "receipt", "invoice", "order", "company"])
    await db.execute(sql.raw(`delete from "${t}"`));
  await db.execute(sql`insert into company (id, name) values ('acme', 'Acme'), ('other', 'Other')`);
});

describe("⚠️⚠️ one transfer, several invoices, the rest as credit", () => {
  it("pays each invoice its share, keeps the rest as the customer's credit, and is collected once", async () => {
    await invoice("a", { total: "300" });
    await invoice("b", { total: "500" });
    const r = await recordReceipt(db, {
      amount: 1000,
      receivedAt: DAY,
      reference: "CRO 123",
      by: "u1",
      allocations: [
        { invoiceId: "a", amount: 300 },
        { invoiceId: "b", amount: 500 },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await owes("a")).toBe(0);
    expect(await owes("b")).toBe(0);
    expect(r.settled.map((s) => s.invoiceId).sort()).toEqual(["a", "b"]);
    expect(await collected()).toBe(1000);
    expect(await customerCredit(db, "acme")).toEqual([{ currency: "EUR", credit: 200 }]);
    expect(await unallocatedOf(db, r.receiptId)).toBe(200);
    expect((await openCredits(db, "acme")).map((c) => c.left)).toEqual([200]);
  });

  it("refuses what it cannot be: more than arrived, another customer's invoice, two currencies, a draft", async () => {
    await invoice("a", { total: "300" });
    await invoice("theirs", { company: "other" });
    await invoice("usd", { currency: "USD" });
    await invoice("draft", { status: "draft" });
    const one = (allocations: { invoiceId: string; amount: number }[], amount = 500) =>
      recordReceipt(db, { amount, receivedAt: DAY, by: "u1", allocations });
    expect(await one([{ invoiceId: "a", amount: 600 }])).toEqual({ ok: false, reason: "over_allocated" });
    expect(
      await one([
        { invoiceId: "a", amount: 100 },
        { invoiceId: "theirs", amount: 100 },
      ]),
    ).toEqual({ ok: false, reason: "other_customer" });
    expect(
      await one([
        { invoiceId: "a", amount: 100 },
        { invoiceId: "usd", amount: 100 },
      ]),
    ).toEqual({ ok: false, reason: "mixed_currency" });
    expect(await one([{ invoiceId: "draft", amount: 100 }])).toEqual({ ok: false, reason: "not_receivable" });
    expect(await collected()).toBe(0);
  });
});

describe("⚠️⚠️ credit is spent once", () => {
  it("allocates credit to a later invoice, and refuses to spend more than is left", async () => {
    const r = await recordReceipt(db, { companyId: "acme", amount: 100, receivedAt: DAY, by: "u1", allocations: [] });
    if (!r.ok) throw new Error("receipt");
    await invoice("later", { total: "250" });
    expect((await allocateCredit(db, { receiptId: r.receiptId, invoiceId: "later", amount: 60, by: "u1" })).ok).toBe(
      true,
    );
    // Only 40 left: the database refuses the second, inside the transaction.
    expect(await allocateCredit(db, { receiptId: r.receiptId, invoiceId: "later", amount: 50, by: "u1" })).toEqual({
      ok: false,
      reason: "over_allocated",
    });
    expect(await owes("later")).toBe(190);
    expect(await customerCredit(db, "acme")).toEqual([{ currency: "EUR", credit: 40 }]);
  });

  it("never to another customer's invoice, nor in another currency", async () => {
    const r = await recordReceipt(db, { companyId: "acme", amount: 100, receivedAt: DAY, by: "u1", allocations: [] });
    if (!r.ok) throw new Error("receipt");
    await invoice("theirs", { company: "other" });
    await invoice("usd", { currency: "USD" });
    expect((await allocateCredit(db, { receiptId: r.receiptId, invoiceId: "theirs", amount: 10, by: "u1" })).ok).toBe(
      false,
    );
    expect((await allocateCredit(db, { receiptId: r.receiptId, invoiceId: "usd", amount: 10, by: "u1" })).ok).toBe(
      false,
    );
  });
});

describe("⚠️⚠️ a deposit on an order reaches the invoice that was meant", () => {
  it("links a deposit of the order to one of its invoices, and to no other order's", async () => {
    await db.execute(
      sql`insert into "order" (id, order_number, status, total_amount, company_id) values ('o1', 'ORD-1', 'confirmed', '1000', 'acme'), ('o2', 'ORD-2', 'confirmed', '10', 'acme')`,
    );
    const r = await recordReceipt(db, {
      amount: 300,
      receivedAt: DAY,
      by: "u1",
      allocations: [{ orderId: "o1", amount: 300 }],
    });
    if (!r.ok) throw new Error("receipt");
    await invoice("i1", { order: "o1" });
    await invoice("i2", { order: "o1" });
    await invoice("elsewhere", { order: "o2" });
    const [allocation] = r.allocationIds;
    expect((await linkAllocation(db, { allocationId: allocation, invoiceId: "elsewhere" })).ok).toBe(false);
    expect((await linkAllocation(db, { allocationId: allocation, invoiceId: "i2" })).ok).toBe(true);
    expect(await owes("i2")).toBe(700);
    expect(await owes("i1")).toBe(1000);
    // Linked once: it is not a deposit any more.
    expect((await linkAllocation(db, { allocationId: allocation, invoiceId: "i1" })).ok).toBe(false);
  });

  it("⚠️ deleting the order does not delete the money: it becomes the customer's credit", async () => {
    await db.execute(
      sql`insert into "order" (id, order_number, status, total_amount, company_id) values ('o1', 'ORD-1', 'cancelled', '1000', 'acme')`,
    );
    await recordReceipt(db, { amount: 300, receivedAt: DAY, by: "u1", allocations: [{ orderId: "o1", amount: 300 }] });
    await db.delete(schema.orders).where(eq(schema.orders.id, "o1"));
    expect(await collected()).toBe(300);
    expect(await customerCredit(db, "acme")).toEqual([{ currency: "EUR", credit: 300 }]);
  });
});

describe("taking a payment back, and correcting one", () => {
  it("a payment that was all of its receipt takes the receipt with it; a share returns to credit", async () => {
    await invoice("a", { total: "300" });
    await invoice("b", { total: "500" });
    const single = await recordReceipt(db, {
      amount: 300,
      receivedAt: DAY,
      by: "u1",
      allocations: [{ invoiceId: "a", amount: 300 }],
    });
    const shared = await recordReceipt(db, {
      amount: 500,
      receivedAt: DAY,
      by: "u1",
      allocations: [
        { invoiceId: "b", amount: 200 },
        { invoiceId: "b", amount: 300 },
      ],
    });
    if (!single.ok || !shared.ok) throw new Error("receipts");
    expect((await removeAllocation(db, single.allocationIds[0])).removed).toBe("receipt");
    expect(await collected()).toBe(500);
    expect((await removeAllocation(db, shared.allocationIds[0])).removed).toBe("allocation");
    expect(await collected()).toBe(500);
    expect(await owes("b")).toBe(200);
    expect(await customerCredit(db, "acme")).toEqual([{ currency: "EUR", credit: 200 }]);
  });

  it("a correction moves a whole payment with it, and never shrinks a receipt below what it paid", async () => {
    await invoice("a", { total: "300" });
    await invoice("b", { total: "500" });
    const whole = await recordReceipt(db, {
      amount: 300,
      receivedAt: DAY,
      by: "u1",
      allocations: [{ invoiceId: "a", amount: 300 }],
    });
    const split = await recordReceipt(db, {
      amount: 500,
      receivedAt: DAY,
      by: "u1",
      allocations: [{ invoiceId: "b", amount: 400 }],
    });
    if (!whole.ok || !split.ok) throw new Error("receipts");
    expect(
      (await updateReceipt(db, { receiptId: whole.receiptId, amount: 250, reference: "TRN 9", by: "u1" })).ok,
    ).toBe(true);
    expect(await owes("a")).toBe(50);
    expect(await updateReceipt(db, { receiptId: split.receiptId, amount: 300, by: "u1" })).toEqual({
      ok: false,
      reason: "over_allocated",
    });
    const [row] = await db.select().from(schema.receipts).where(eq(schema.receipts.id, whole.receiptId));
    expect(row.reference).toBe("TRN 9");
    expect(row.updatedById).toBe("u1");
  });
});

describe("⚠️⚠️ money given back", () => {
  it("refunds what an invoice was paid beyond what it owes, and nothing more", async () => {
    await invoice("a", { total: "300" });
    await recordReceipt(db, { amount: 300, receivedAt: DAY, by: "u1", allocations: [{ invoiceId: "a", amount: 300 }] });
    // A credit note for 100 after the payment.
    await db.execute(sql`update invoice set credited_amount = '100' where id = 'a'`);
    expect(await owes("a")).toBe(-100);
    expect(await recordRefund(db, { invoiceId: "a", amount: 150, receivedAt: DAY, by: "u1" })).toEqual({
      ok: false,
      reason: "not_overpaid",
    });
    expect((await recordRefund(db, { invoiceId: "a", amount: 100, receivedAt: DAY, by: "u1" })).ok).toBe(true);
    expect(await owes("a")).toBe(0);
    expect(await collected()).toBe(200);
  });

  it("refunds a customer's credit, and nothing beyond it", async () => {
    await recordReceipt(db, { companyId: "acme", amount: 80, receivedAt: DAY, by: "u1", allocations: [] });
    expect(await recordRefund(db, { companyId: "acme", amount: 100, receivedAt: DAY, by: "u1" })).toEqual({
      ok: false,
      reason: "no_credit",
    });
    expect((await recordRefund(db, { companyId: "acme", amount: 80, receivedAt: DAY, by: "u1" })).ok).toBe(true);
    expect(await customerCredit(db, "acme")).toEqual([]);
    expect(await collected()).toBe(0);
  });
});

describe("⚠️⚠️ migration 0059 and the payments recorded before it", () => {
  it("gives every old payment a receipt of its own, in the currency and for the customer of what it paid", async () => {
    const fresh = drizzle(new PGlite(), { schema });
    const self = tenantMigrations.find((m) => m.tag === "0059_what_arrived_and_where_it_went");
    if (!self) throw new Error("0059 is not embedded");
    await applyTenantMigrations(
      fresh as never,
      tenantMigrations.filter((m) => m.folderMillis < self.folderMillis),
    );
    await fresh.execute(sql`insert into company (id, name) values ('acme', 'Acme')`);
    await fresh.execute(
      sql`insert into "order" (id, order_number, status, total_amount, company_id, currency) values ('o1', 'ORD-1', 'confirmed', '10', 'acme', 'USD')`,
    );
    await fresh.execute(
      sql`insert into invoice (id, status, document_type, total, company_id, currency) values ('i1', 'issued', 'TD01', '100', 'acme', 'EUR')`,
    );
    await fresh.execute(
      sql`insert into order_payment (id, invoice_id, amount, paid_at) values ('p1', 'i1', '60', now())`,
    );
    await fresh.execute(sql`insert into order_payment (id, order_id, amount, paid_at) values ('p2', 'o1', '5', now())`);
    await applyTenantMigrations(fresh as never);
    // Twice, as every tenant migration must survive.
    await applyTenantMigrations(fresh as never);
    const rows = (
      await fresh.execute(
        sql`select p.id, p.receipt_id, r.amount::text as amount, r.currency, r.company_id from order_payment p join receipt r on r.id = p.receipt_id order by p.id`,
      )
    ).rows;
    expect(rows).toEqual([
      { id: "p1", receipt_id: "p1", amount: "60.00", currency: "EUR", company_id: "acme" },
      { id: "p2", receipt_id: "p2", amount: "5.00", currency: "USD", company_id: "acme" },
    ]);
  });
});

describe("⚠️⚠️ payments recorded by code that knew no receipts", () => {
  it("get the receipt they lack, once — and a second run finds nothing to do", async () => {
    await invoice("a", { total: "300" });
    // As the code before I10 wrote them, after migration 0059 reached the database.
    await db.execute(
      sql`insert into order_payment (id, invoice_id, amount, paid_at) values ('old', 'a', '120', now())`,
    );
    expect(await collected()).toBe(0);
    expect(await healPaymentsWithoutReceipt(db)).toBe(1);
    expect(await collected()).toBe(120);
    expect(await owes("a")).toBe(180);
    expect(await healPaymentsWithoutReceipt(db)).toBe(0);
  });
});

describe("the day money arrived", () => {
  it("⚠️ is today or before: a day ahead is a promise, not a receipt", () => {
    const now = new Date("2026-09-28T10:00:00Z");
    expect(paymentDay("2026-09-28", "Europe/Rome", now)).not.toBeNull();
    expect(paymentDay("2026-09-29", "Europe/Rome", now)).toBeNull();
  });
});

describe("⚠️⚠️ a deposit paid on the order, with deposit and balance invoices (I11)", () => {
  it("reaches the deposit invoice when it is issued — never the balance, which is already net of it", async () => {
    await db.execute(
      sql`insert into "order" (id, order_number, status, total_amount, company_id) values ('o1', 'ORD-1', 'confirmed', '1220', 'acme')`,
    );
    await recordReceipt(db, { amount: 244, receivedAt: DAY, by: "u1", allocations: [{ orderId: "o1", amount: 244 }] });
    await invoice("dep", { type: "TD02", total: "244", order: "o1" });
    expect(await linkOrderPayments(db, "o1", "dep")).toBe(1);
    expect(await owes("dep")).toBe(0);
    // The balance, issued after: nothing is left on the order, so nothing reaches it.
    await invoice("bal", { total: "976", order: "o1" });
    expect(await linkOrderPayments(db, "o1", "bal")).toBe(0);
    expect(await owes("bal")).toBe(976);
  });

  it("⚠️ an order's deposits never reach another order's invoice", async () => {
    await db.execute(
      sql`insert into "order" (id, order_number, status, total_amount, company_id) values ('o1', 'ORD-1', 'confirmed', '500', 'acme'), ('o2', 'ORD-2', 'confirmed', '500', 'acme')`,
    );
    await recordReceipt(db, { amount: 200, receivedAt: DAY, by: "u1", allocations: [{ orderId: "o1", amount: 200 }] });
    await invoice("other", { total: "500", order: "o2" });
    expect(await linkOrderPayments(db, "o1", "other")).toBe(0);
    expect(await owes("other")).toBe(500);
  });

  it("⚠️⚠️ a deposit larger than the deposit invoice is split: the rest waits on the order for the balance", async () => {
    await db.execute(
      sql`insert into "order" (id, order_number, status, total_amount, company_id) values ('o1', 'ORD-1', 'confirmed', '1000', 'acme')`,
    );
    await recordReceipt(db, {
      amount: 1000,
      receivedAt: DAY,
      by: "u1",
      allocations: [{ orderId: "o1", amount: 1000 }],
    });
    await invoice("dep", { type: "TD02", total: "300", order: "o1" });
    expect(await linkOrderPayments(db, "o1", "dep")).toBe(1);
    expect(await owes("dep")).toBe(0);
    await invoice("bal", { total: "700", order: "o1" });
    expect(await linkOrderPayments(db, "o1", "bal")).toBe(1);
    expect(await owes("bal")).toBe(0);
    expect(await collected()).toBe(1000);
  });

  it("⚠️ a deposit invoice is owed like any invoice: it is on the receivables schedule", async () => {
    await invoice("dep", { type: "TD02", total: "244" });
    const schedule = await receivables(db, { today: "2026-09-28" });
    expect(schedule.invoices.map((i) => i.id)).toEqual(["dep"]);
  });
});

describe("⚠️⚠️ audit of 29 September 2026: money is never lost, counted twice, or given to an invoice beyond what it owes", () => {
  const credit = async () => (await customerCredit(db, "acme")).find((c) => c.currency === "EUR")?.credit ?? 0;

  it("⚠️⚠️ taking back a part of a transfer leaves the rest as credit, never deletes the transfer", async () => {
    await invoice("a", { total: "600" });
    const r = await recordReceipt(db, {
      companyId: "acme",
      amount: 1000,
      receivedAt: DAY,
      by: "u1",
      allocations: [{ invoiceId: "a", amount: 600 }],
    });
    if (!r.ok) throw new Error(r.reason);
    expect(await removeAllocation(db, r.allocationIds[0])).toMatchObject({ removed: "allocation" });
    expect(await collected()).toBe(1000);
    expect(await credit()).toBe(1000);
  });

  it("⚠️⚠️ taking back a payment from the bank keeps the receipt: the bank line stays explained", async () => {
    await invoice("a", { total: "500" });
    await db.execute(sql`insert into bank_account (id, name) values ('acc', 'Conto') on conflict do nothing`);
    await db.execute(sql`insert into bank_transaction (id, account_id, booked_on, amount, fingerprint)
      values ('line', 'acc', '2026-09-20', '500', 'fp-line') on conflict do nothing`);
    const r = await recordReceipt(db, {
      amount: 500,
      receivedAt: DAY,
      by: "u1",
      source: "bank",
      bankTransactionId: "line",
      allocations: [{ invoiceId: "a", amount: 500 }],
    });
    if (!r.ok) throw new Error(r.reason);
    expect(await removeAllocation(db, r.allocationIds[0])).toMatchObject({ removed: "allocation" });
    expect(await collected()).toBe(500);
    await db.execute(sql`delete from receipt`);
    await db.execute(sql`delete from bank_transaction`);
  });

  it("⚠️⚠️ an invoice never receives more than it owes: the rest is refused, or the caller sends it to credit", async () => {
    await invoice("a", { total: "100" });
    expect(
      await recordReceipt(db, {
        amount: 150,
        receivedAt: DAY,
        by: "u1",
        allocations: [{ invoiceId: "a", amount: 150 }],
      }),
    ).toEqual({ ok: false, reason: "overpays" });
    expect(await collected()).toBe(0);
  });

  it("⚠️⚠️ credit refunded to the customer cannot be spent again", async () => {
    await invoice("b", { total: "400" });
    const r = await recordReceipt(db, { companyId: "acme", amount: 400, receivedAt: DAY, by: "u1", allocations: [] });
    if (!r.ok) throw new Error(r.reason);
    expect(await recordRefund(db, { companyId: "acme", amount: 400, receivedAt: DAY, by: "u1" })).toMatchObject({
      ok: true,
    });
    expect(await credit()).toBe(0);
    expect(await openCredits(db, "acme")).toEqual([]);
    expect(await allocateCredit(db, { receiptId: r.receiptId, invoiceId: "b", amount: 400, by: "u1" })).toEqual({
      ok: false,
      reason: "no_credit",
    });
    // And a second refund of the same credit is refused by the database, not by a read.
    expect(await recordRefund(db, { companyId: "acme", amount: 1, receivedAt: DAY, by: "u1" })).toEqual({
      ok: false,
      reason: "no_credit",
    });
  });

  it("⚠️⚠️ two refunds of one overpayment: the second is refused", async () => {
    await invoice("a", { total: "100" });
    await db.execute(
      sql`insert into receipt (id, company_id, amount, currency, received_at) values ('r', 'acme', '150', 'EUR', now())`,
    );
    await db.execute(
      sql`insert into order_payment (id, receipt_id, invoice_id, amount, paid_at) values ('p', 'r', 'a', '150', now())`,
    );
    const refund = () => recordRefund(db, { invoiceId: "a", amount: 50, receivedAt: DAY, by: "u1" });
    expect(await refund()).toMatchObject({ ok: true });
    expect(await refund()).toEqual({ ok: false, reason: "not_overpaid" });
    expect(await owes("a")).toBe(0);
  });

  it("⚠️⚠️ what a credit note leaves paid beyond the invoice moves to the customer's credit", async () => {
    await invoice("a", { total: "1000" });
    await recordReceipt(db, {
      amount: 1000,
      receivedAt: DAY,
      by: "u1",
      allocations: [{ invoiceId: "a", amount: 1000 }],
    });
    await db.execute(sql`update invoice set credited_amount = '1000' where id = 'a'`);
    expect(await releaseOverpayment(db, "a")).toBe(1000);
    expect(await credit()).toBe(1000);
    expect(await collected()).toBe(1000);
    expect(await releaseOverpayment(db, "a")).toBe(0);
  });

  it("⚠️ a receipt from the bank keeps the bank's amount; a refund's amount is not edited, its note is", async () => {
    await db.execute(sql`insert into receipt (id, company_id, amount, currency, received_at, bank_transaction_id, source)
      values ('bank', 'acme', '100', 'EUR', ${DAY}, 'some-line', 'bank')`);
    expect(await updateReceipt(db, { receiptId: "bank", amount: 120, by: "u1" })).toEqual({
      ok: false,
      reason: "reconciled",
    });
    expect(await updateReceipt(db, { receiptId: "bank", note: "ok", by: "u1" })).toMatchObject({ ok: true });
    await db.execute(
      sql`insert into receipt (id, company_id, amount, currency, received_at) values ('ref', 'acme', '-30', 'EUR', ${DAY})`,
    );
    expect(await updateReceipt(db, { receiptId: "ref", amount: 40, by: "u1" })).toEqual({
      ok: false,
      reason: "refund_fixed",
    });
    expect(await updateReceipt(db, { receiptId: "ref", amount: 30, reference: "CRO-9", by: "u1" })).toMatchObject({
      ok: true,
    });
  });

  it("⚠️ a receipt is not shrunk below what it already paid", async () => {
    await invoice("a", { total: "400" });
    await invoice("b", { total: "300" });
    const r = await recordReceipt(db, {
      amount: 1000,
      receivedAt: DAY,
      by: "u1",
      allocations: [{ invoiceId: "a", amount: 400 }],
    });
    if (!r.ok) throw new Error(r.reason);
    await allocateCredit(db, { receiptId: r.receiptId, invoiceId: "b", amount: 300, by: "u1" });
    expect(await updateReceipt(db, { receiptId: r.receiptId, amount: 500, by: "u1" })).toEqual({
      ok: false,
      reason: "over_allocated",
    });
  });
});
