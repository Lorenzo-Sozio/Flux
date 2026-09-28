/**
 * What customers still owe (src/lib/receivables.ts), on a real Postgres: an invoice's
 * balance after its credit notes and payments, the schedule's ages, and migration 0053's
 * reading of the payments recorded before an invoice could be named.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";
import { tenantMigrations } from "@/db/migrations-tenant.generated";
import * as schema from "@/db/schema";

import { paymentDay } from "./order-payment";
import {
  agingBucket,
  balanceOf,
  invoiceBalance,
  linkOrderPayments,
  receivables,
  recordInvoicePayment,
} from "./receivables";

const db = drizzle(new PGlite(), { schema });
const TODAY = "2026-09-27";

async function invoice(
  id: string,
  over: {
    total?: number;
    credited?: number;
    due?: string | null;
    status?: string;
    type?: string;
    order?: string | null;
    currency?: string;
  } = {},
) {
  await db.execute(sql`insert into invoice (id, document_number, status, document_type, total, credited_amount, issue_date, due_date, order_id, currency, company_id, customer_snapshot)
    values (${id}, ${`FT-${id}`}, ${over.status ?? "issued"}, ${over.type ?? "TD01"}, ${String(over.total ?? 1000)}, ${String(over.credited ?? 0)},
      '2026-06-01', ${over.due === undefined ? "2026-07-01" : over.due}, ${over.order ?? null}, ${over.currency ?? "EUR"}, 'co1', '{"name":"Cliente S.p.A."}'::jsonb)`);
}
const pay = (invoiceId: string, amount: number | string) =>
  recordInvoicePayment(db, { invoiceId, amount, by: null, paidAt: new Date("2026-09-01T10:00:00Z") });
const schedule = () => receivables(db, { today: TODAY });

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  for (const t of ["order_payment", "invoice", "order", "company"]) await db.execute(sql.raw(`delete from "${t}"`));
  await db.execute(sql`insert into company (id, name) values ('co1', 'Cliente oggi')`);
});

describe("⚠️⚠️ what an invoice still owes", () => {
  it("its total, less its credit notes, less its payments — each from its own column", () => {
    expect(invoiceBalance(1000, 200, [{ amount: "300" }])).toEqual({
      due: 800,
      paid: 300,
      outstanding: 500,
      state: "partial",
    });
    expect(invoiceBalance(1000, 1000, [])).toMatchObject({ due: 0, outstanding: 0, state: "paid" });
    expect(invoiceBalance("99.99", "0", [{ amount: 100 }])).toMatchObject({ outstanding: -0.01, state: "overpaid" });
  });

  it("⚠️ days late on the calendar: a day is a day, whatever the hour", () => {
    expect(agingBucket("2026-09-27", TODAY)).toEqual({ bucket: "current", daysOverdue: 0 });
    expect(agingBucket("2026-09-26", TODAY)).toEqual({ bucket: "1-30", daysOverdue: 1 });
    expect(agingBucket("2026-08-28", TODAY)).toEqual({ bucket: "1-30", daysOverdue: 30 });
    expect(agingBucket("2026-08-27", TODAY)).toEqual({ bucket: "31-60", daysOverdue: 31 });
    expect(agingBucket("2026-06-29", TODAY)).toEqual({ bucket: "61-90", daysOverdue: 90 });
    expect(agingBucket("2026-06-28", TODAY)).toEqual({ bucket: "90+", daysOverdue: 91 });
    // Across the change of hour at the end of October, still whole days.
    expect(agingBucket("2026-10-20", "2026-11-02")).toEqual({ bucket: "1-30", daysOverdue: 13 });
  });
});

describe("⚠️⚠️ the receivables schedule", () => {
  it("issued invoices still owed something, most overdue first — never a draft, a credit note or a paid one", async () => {
    await invoice("late", { due: "2026-06-01" });
    await invoice("soon", { due: "2026-10-15" });
    await invoice("draft", { status: "draft" });
    await invoice("credit", { type: "TD04" });
    await invoice("paid");
    await pay("paid", 1000);
    const s = await schedule();
    expect(s.invoices.map((r) => [r.id, r.bucket, r.daysOverdue])).toEqual([
      ["late", "90+", 118],
      ["soon", "current", 0],
    ]);
    // The name as invoiced, not the record's name today.
    expect(s.invoices[0].customer).toBe("Cliente S.p.A.");
  });

  it("⚠️ a credit note and a payment both come off, and a fully credited invoice is owed nothing", async () => {
    await invoice("part", { credited: 200 });
    await invoice("gone", { credited: 1000 });
    await pay("part", 300);
    const s = await schedule();
    expect(s.invoices.map((r) => [r.id, r.outstanding])).toEqual([["part", 500]]);
  });

  it("⚠️ due on receipt when no due date was set", async () => {
    await invoice("noterm", { due: null });
    expect((await schedule()).invoices[0]).toMatchObject({ dueDate: "2026-06-01", bucket: "90+" });
  });

  it("⚠️ totals per currency, never added across them", async () => {
    await invoice("eur", { due: "2026-09-10" });
    await invoice("usd", { total: 500, currency: "USD", due: "2026-10-10" });
    const totals = Object.fromEntries((await schedule()).totals.map((t) => [t.currency, t]));
    expect(totals.EUR).toMatchObject({ outstanding: 1000, overdue: 1000 });
    expect(totals.EUR.buckets["1-30"]).toBe(1000);
    expect(totals.USD).toMatchObject({ outstanding: 500, overdue: 0 });
    expect(totals.USD.buckets.current).toBe(500);
  });
});

describe("⚠️⚠️ an invoice paid in installments (I12)", () => {
  it("is as late as its first installment still owed, and each installment ages on its own", async () => {
    await invoice("rate", { due: "2026-10-31" });
    await db.execute(
      sql`update invoice set installments = ${JSON.stringify([
        { dueDate: "2026-07-31", amount: 400 },
        { dueDate: "2026-08-31", amount: 300 },
        { dueDate: "2026-10-31", amount: 300 },
      ])}::jsonb where id = 'rate'`,
    );
    // 500 paid: the first installment settled, 200 left of the second.
    await pay("rate", 500);
    const s = await schedule();
    const [r] = s.invoices;
    expect([r.dueDate, r.bucket, r.daysOverdue, r.overdueAmount, r.outstanding]).toEqual([
      "2026-08-31",
      "1-30",
      27,
      200,
      500,
    ]);
    expect(r.installments?.map((i) => i.outstanding)).toEqual([0, 200, 300]);
    // 300 due next month is not late because an earlier installment is.
    expect(s.totals[0].buckets).toMatchObject({ current: 300, "1-30": 200 });
    expect(s.totals[0].overdue).toBe(200);
  });
});

describe("recording a payment on an invoice", () => {
  it("names the invoice's order too, and says which payment settled it", async () => {
    await db.execute(
      sql`insert into "order" (id, order_number, status, total_amount) values ('o1', 'ORD-1', 'confirmed', '1000')`,
    );
    await invoice("i1", { order: "o1" });
    const first = await pay("i1", 400);
    expect(first).toMatchObject({ ok: true, becamePaid: false, balance: { outstanding: 600, state: "partial" } });
    const second = await pay("i1", "600");
    expect(second).toMatchObject({ ok: true, becamePaid: true, balance: { outstanding: 0, state: "paid" } });
    // A payment on an invoice already settled did not settle it.
    expect(await pay("i1", 10)).toMatchObject({ ok: true, becamePaid: false });
    const rows = (await db.execute(sql`select order_id, invoice_id from order_payment`)).rows;
    expect(rows.every((r) => r.order_id === "o1" && r.invoice_id === "i1")).toBe(true);
  });

  it("an invoice written without an order can be paid", async () => {
    await invoice("standalone");
    expect(await pay("standalone", 1000)).toMatchObject({ ok: true, becamePaid: true });
  });

  it("⚠️ refuses a draft, a credit note, nothing, a refund and nonsense", async () => {
    await invoice("d", { status: "draft" });
    await invoice("c", { type: "TD04" });
    await invoice("ok");
    expect(await pay("d", 10)).toEqual({ ok: false, reason: "not_receivable" });
    expect(await pay("c", 10)).toEqual({ ok: false, reason: "not_receivable" });
    expect(await pay("nope", 10)).toEqual({ ok: false, reason: "not_found" });
    for (const bad of [0, -50, "abc", Number.NaN])
      expect(await pay("ok", bad)).toEqual({ ok: false, reason: "invalid_amount" });
    expect((await db.execute(sql`select count(*)::int as n from order_payment`)).rows[0]).toEqual({ n: 0 });
  });
});

describe("⚠️⚠️ migration 0053 and the payments recorded before it", () => {
  it("links them to the order's only issued invoice, and leaves them alone when there are several", async () => {
    await db.execute(sql`insert into "order" (id, order_number, status, total_amount) values
      ('one', 'ORD-1', 'confirmed', '1000'), ('two', 'ORD-2', 'confirmed', '1000')`);
    await invoice("only", { order: "one" });
    await invoice("a", { order: "two" });
    await invoice("b", { order: "two" });
    await invoice("draft-of-one", { order: "one", status: "draft" });
    await db.execute(
      sql`insert into order_payment (id, order_id, amount) values ('p1', 'one', '100'), ('p2', 'two', '100')`,
    );
    const backfill = tenantMigrations.find((m) => m.tag === "0053_what_came_in")?.sql.at(-1);
    expect(backfill?.trim()).toMatch(/^UPDATE "order_payment"/);
    await db.execute(sql.raw(backfill as string));
    // Run twice, as every tenant migration may be: the link it made stays, nothing moves.
    await db.execute(sql.raw(backfill as string));
    const rows = Object.fromEntries(
      (
        (await db.execute(sql`select id, invoice_id from order_payment`)).rows as {
          id: string;
          invoice_id: string | null;
        }[]
      ).map((r) => [r.id, r.invoice_id]),
    );
    expect(rows).toEqual({ p1: "only", p2: null });
  });
});

describe("⚠️⚠️ security review, 27 September 2026", () => {
  it("an amount is read once, strictly: '12abc' is not twelve, and never NaN in the table", async () => {
    await invoice("i1");
    for (const bad of ["12abc", "0.004", "1e15", "", "   ", "-5", "Infinity"]) {
      expect(await pay("i1", bad)).toEqual({ ok: false, reason: "invalid_amount" });
    }
    expect(await pay("i1", "12,50")).toMatchObject({ ok: true, balance: { paid: 12.5 } });
    const rows = (await db.execute(sql`select amount::text as amount from order_payment`)).rows;
    expect(rows).toEqual([{ amount: "12.50" }]);
  });

  it("the day a payment arrived is a day, at midday on the workspace's clock", () => {
    expect(paymentDay("2026-09-27", "Europe/Rome")?.toISOString()).toBe("2026-09-27T10:00:00.000Z");
    expect(paymentDay("2026-02-31", "Europe/Rome")).toBeNull();
    expect(paymentDay("garbage", "Europe/Rome")).toBeNull();
    expect(paymentDay(undefined, "Europe/Rome", new Date("2026-09-27T08:00:00Z"))?.toISOString()).toBe(
      "2026-09-27T08:00:00.000Z",
    );
  });

  it("⚠️ a deposit on the order reaches the order's only invoice when it is issued", async () => {
    await db.execute(
      sql`insert into "order" (id, order_number, status, total_amount) values ('o1', 'ORD-1', 'confirmed', '1000')`,
    );
    await db.execute(sql`insert into order_payment (id, order_id, amount) values ('dep', 'o1', '300')`);
    await invoice("only", { order: "o1" });
    expect(await linkOrderPayments(db, "o1")).toBe(1);
    expect(await balanceOf(db, "only")).toMatchObject({ paid: 300, outstanding: 700 });
    // A second invoice on the order: nobody can say which one new money pays.
    await invoice("second", { order: "o1" });
    await db.execute(sql`insert into order_payment (id, order_id, amount) values ('dep2', 'o1', '100')`);
    expect(await linkOrderPayments(db, "o1")).toBe(0);
  });
});
