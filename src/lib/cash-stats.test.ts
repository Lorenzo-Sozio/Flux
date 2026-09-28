/**
 * ⚠️⚠️ Cash figures that can be checked (I14), each against its written definition, on a real
 * Postgres: receipts by the month they arrived, invoices net of credit notes, DSO over what is
 * owed now, the collection rate gross on gross, deposits no invoice carries, unallocated credit.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";
import * as schema from "@/db/schema";

import { cashStats, collectionRate, daysSalesOutstanding, monthKey } from "./cash-stats";

const db = drizzle(new PGlite(), { schema });
const TODAY = "2026-09-29";
const TZ = "Europe/Rome";

async function invoice(
  id: string,
  over: { type?: string; total?: number; credited?: number; issue?: string; due?: string } = {},
) {
  await db.execute(sql`insert into invoice (id, status, document_type, total, credited_amount, issue_date, due_date, currency, company_id)
    values (${id}, 'issued', ${over.type ?? "TD01"}, ${String(over.total ?? 1000)}, ${String(over.credited ?? 0)},
            ${over.issue ?? "2026-09-10"}, ${over.due ?? null}, 'EUR', 'acme')`);
}

async function receipt(
  id: string,
  amount: number,
  at: string,
  alloc?: { invoice?: string; order?: string; amount: number },
) {
  await db.execute(
    sql`insert into receipt (id, company_id, amount, currency, received_at) values (${id}, 'acme', ${String(amount)}, 'EUR', ${at}::timestamp)`,
  );
  if (alloc)
    await db.execute(sql`insert into order_payment (id, receipt_id, invoice_id, order_id, amount, paid_at)
      values (${`${id}-a`}, ${id}, ${alloc.invoice ?? null}, ${alloc.order ?? null}, ${String(alloc.amount)}, ${at}::timestamp)`);
}

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  for (const t of ["order_payment", "receipt", "invoice", "order", "company"])
    await db.execute(sql.raw(`delete from "${t}"`));
  await db.execute(sql`insert into company (id, name) values ('acme', 'Acme')`);
});

describe("the arithmetic", () => {
  it("DSO and the collection rate say nothing rather than zero when there is nothing to measure", () => {
    expect(daysSalesOutstanding(500, 1500)).toBe(30);
    expect(daysSalesOutstanding(500, 0)).toBeNull();
    expect(collectionRate(900, 1000)).toBe(0.9);
    expect(collectionRate(0, 0)).toBeNull();
    expect(collectionRate(1200, 1000)).toBe(1);
    expect(monthKey("2026-01-15", -1)).toBe("2025-12");
  });
});

describe("⚠️⚠️ the figures, against the database", () => {
  it("collected is receipts by the day they arrived — on the workspace's clock, refunds included", async () => {
    await invoice("i1");
    await receipt("r1", 600, "2026-09-05 10:00", { invoice: "i1", amount: 600 });
    // 23:30 UTC on 31 August is 1 September in Rome.
    await receipt("r2", 100, "2026-08-31 23:30");
    await receipt("r3", -50, "2026-09-20 10:00");
    const s = await cashStats(db, { today: TODAY, timeZone: TZ });
    expect(s.months.at(-1)).toBe("2026-09");
    expect(s.collectedThisMonth).toEqual([{ currency: "EUR", amount: 650 }]);
    expect(s.collected[0].values.at(-2)).toBe(0);
  });

  it("invoiced is net of the credit notes issued that month", async () => {
    await invoice("i1", { total: 1000 });
    await invoice("i2", { type: "TD02", total: 300 });
    await invoice("nc", { type: "TD04", total: 200 });
    const s = await cashStats(db, { today: TODAY, timeZone: TZ });
    expect(s.invoiced).toEqual([{ currency: "EUR", values: [...Array(11).fill(0), 1100] }]);
  });

  it("⚠️ DSO is what is owed now over what was invoiced in ninety days, times ninety", async () => {
    await invoice("i1", { total: 1000, issue: "2026-09-01" });
    await invoice("i2", { total: 500, issue: "2026-08-01" });
    await receipt("r1", 1000, "2026-09-10 10:00", { invoice: "i1", amount: 1000 });
    const s = await cashStats(db, { today: TODAY, timeZone: TZ });
    // Owed 500 of 1500 invoiced in the window: 30 days.
    expect(s.dso).toEqual([{ currency: "EUR", owed: 500, invoiced90: 1500, days: 30 }]);
  });

  it("⚠️⚠️ the collection rate counts only invoices already due, net of credit notes, paid capped at what they ask", async () => {
    await invoice("due", { total: 1000, credited: 200, due: "2026-09-01" });
    await invoice("notyet", { total: 5000, due: "2026-12-31" });
    await receipt("r1", 900, "2026-09-10 10:00", { invoice: "due", amount: 900 });
    const s = await cashStats(db, { today: TODAY, timeZone: TZ });
    // Asked 800 after the credit note, paid 900 — capped at 800: fully collected.
    expect(s.collectionRate).toEqual([{ currency: "EUR", asked: 800, paid: 800, rate: 1 }]);
  });

  it("deposits to invoice are money on orders no invoice carries; credit is money allocated to nothing", async () => {
    await db.execute(sql`insert into "order" (id, order_number, company_id, total_amount, status, currency)
      values ('o1', 'ORD-1', 'acme', '2000', 'processing', 'EUR')`);
    await receipt("dep", 500, "2026-09-12 10:00", { order: "o1", amount: 500 });
    await receipt("loose", 120, "2026-09-13 10:00");
    const s = await cashStats(db, { today: TODAY, timeZone: TZ });
    expect(s.depositsToInvoice.total).toEqual([{ currency: "EUR", amount: 500 }]);
    expect(s.depositsToInvoice.orders[0]).toMatchObject({ orderNumber: "ORD-1", companyName: "Acme", amount: 500 });
    expect(s.customersCredit).toEqual([{ currency: "EUR", amount: 120 }]);
  });
});
