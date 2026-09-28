/**
 * ⚠️⚠️ A customer's statement of account (I14): documents and money in date order, the balance
 * after each, money counted once, the period opening on what was owed before it.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";
import * as schema from "@/db/schema";

import { customerStatement } from "./customer-statement";

const db = drizzle(new PGlite(), { schema });
const TZ = "Europe/Rome";

async function invoice(id: string, type: string, total: number, day: string, number: number) {
  await db.execute(sql`insert into invoice (id, status, document_type, total, issue_date, currency, company_id, number, document_number)
    values (${id}, 'issued', ${type}, ${String(total)}, ${day}, 'EUR', 'acme', ${number}, ${String(number)})`);
}

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  for (const t of ["order_payment", "receipt", "invoice", "company"]) await db.execute(sql.raw(`delete from "${t}"`));
  await db.execute(sql`insert into company (id, name) values ('acme', 'Acme'), ('other', 'Other')`);
});

describe("⚠️⚠️ a statement of account", () => {
  it("runs documents and money in date order, and counts a transfer paying two invoices once", async () => {
    await invoice("a", "TD01", 1000, "2026-08-01", 1);
    await invoice("b", "TD01", 500, "2026-08-10", 2);
    await invoice("nc", "TD04", 100, "2026-08-20", 3);
    // One transfer of 1400 allocated to both invoices: one credit line.
    await db.execute(sql`insert into receipt (id, company_id, amount, currency, received_at, reference)
      values ('r1', 'acme', '1400', 'EUR', '2026-09-01 10:00', 'CRO-1'), ('ref', 'acme', '-20', 'EUR', '2026-09-05 10:00', null)`);
    await db.execute(sql`insert into order_payment (id, receipt_id, invoice_id, amount, paid_at)
      values ('p1', 'r1', 'a', '1000', '2026-09-01 10:00'), ('p2', 'r1', 'b', '400', '2026-09-01 10:00')`);
    // Somebody else's invoice is not on it.
    await db.execute(sql`insert into invoice (id, status, document_type, total, issue_date, currency, company_id)
      values ('x', 'issued', 'TD01', '999', '2026-08-02', 'EUR', 'other')`);

    const [s] = await customerStatement(db, { companyId: "acme", timeZone: TZ });
    expect(s.rows.map((r) => [r.date, r.kind, r.debit, r.credit, r.balance])).toEqual([
      ["2026-08-01", "invoice", 1000, 0, 1000],
      ["2026-08-10", "invoice", 500, 0, 1500],
      ["2026-08-20", "credit_note", 0, 100, 1400],
      ["2026-09-01", "receipt", 0, 1400, 0],
      ["2026-09-05", "refund", 20, 0, 20],
    ]);
    expect(s.rows[3].reference).toBe("CRO-1");
    expect(s.closing).toBe(20);
  });

  it("⚠️ a period opens on what was owed before it and ignores what came after", async () => {
    await invoice("a", "TD01", 1000, "2026-07-01", 1);
    await invoice("b", "TD02", 300, "2026-08-15", 2);
    await invoice("c", "TD01", 700, "2026-10-01", 3);
    const [s] = await customerStatement(db, { companyId: "acme", timeZone: TZ, from: "2026-08-01", to: "2026-08-31" });
    expect(s.opening).toBe(1000);
    expect(s.rows.map((r) => [r.kind, r.balance])).toEqual([["deposit_invoice", 1300]]);
    expect(s.closing).toBe(1300);
  });

  it("an invoice paid the day it is issued reads as owed, then paid", async () => {
    // A number that sorts after the receipt's timestamp, so only the rule puts the invoice first.
    await invoice("a", "TD01", 100, "2026-09-10", 999999);
    await db.execute(sql`insert into receipt (id, company_id, amount, currency, received_at, created_at)
      values ('r1', 'acme', '100', 'EUR', '2026-09-10 08:00', '2026-09-09 08:00')`);
    const [s] = await customerStatement(db, { companyId: "acme", timeZone: TZ });
    expect(s.rows.map((r) => r.kind)).toEqual(["invoice", "receipt"]);
  });
});
