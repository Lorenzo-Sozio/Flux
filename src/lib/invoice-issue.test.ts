/**
 * Issuing invoices on a real Postgres.
 *
 * ⚠️⚠️ The failures these guard against are legal ones: two invoices with the same
 * number, and a gap in the sequence. Both come from the counter and the invoice
 * disagreeing, which only real SQL semantics can show — so the schema here is
 * built by the tenant migrations themselves, on PGlite.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";

import { type IssueInput, issueInvoice } from "./invoice-issue";
import { invoiceScope } from "./invoice-rules";

const db = drizzle(new PGlite());

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  await db.execute(sql`delete from invoice`);
  await db.execute(sql`delete from document_counter where scope like 'invoice:%'`);
});

async function draft(id: string, series = "") {
  await db.execute(sql`insert into invoice (id, series) values (${id}, ${series})`);
}

const rows = async (q: ReturnType<typeof sql>) => ((await db.execute(q)) as { rows: Record<string, unknown>[] }).rows;
const counter = async (scope: string) =>
  (await rows(sql`select last_value from document_counter where scope = ${scope}`))[0]?.last_value ?? null;

const input = (id: string, over: Partial<IssueInput> = {}): IssueInput => ({
  invoiceId: id,
  revision: 1,
  scope: invoiceScope(over.series ?? "", 2026),
  series: "",
  fiscalYear: 2026,
  issueDate: "2026-09-15",
  issuedBy: "u1",
  issuerSnapshot: { legalName: "Esempio S.r.l." },
  customerSnapshot: { name: "Cliente S.p.A." },
  linesSnapshot: [{ description: "Consulenza", quantity: 1, unitPrice: 100, taxPercent: 22 }],
  stampDuty: true,
  totals: { subtotal: 100, discountAmount: 0, taxableAmount: 100, taxAmount: 22, total: 122 },
  ...over,
});

describe("issuing", () => {
  it("⚠️⚠️ numbers invoices 1, 2, 3 in the order they are issued", async () => {
    for (const id of ["a", "b", "c"]) await draft(id);
    const numbers = [];
    for (const id of ["b", "a", "c"]) numbers.push((await issueInvoice(db, input(id)))?.number);
    expect(numbers).toEqual([1, 2, 3]);
  });

  it("⚠️⚠️ issuing the same draft twice uses one number, not two", async () => {
    await draft("a");
    await draft("b");
    expect(await issueInvoice(db, input("a"))).toEqual({ number: 1, documentNumber: "1" });
    expect(await issueInvoice(db, input("a")), "issued twice").toBeNull();
    expect(await counter(invoiceScope("", 2026))).toBe(1);
    expect((await issueInvoice(db, input("b")))?.number, "a gap after the double press").toBe(2);
  });

  it("⚠️⚠️ a draft changed since it was checked is not issued, and takes no number", async () => {
    await draft("a");
    await db.execute(sql`update invoice set revision = 2 where id = 'a'`);
    expect(await issueInvoice(db, input("a", { revision: 1 }))).toBeNull();
    expect(await counter(invoiceScope("", 2026))).toBeNull();
    expect((await issueInvoice(db, input("a", { revision: 2 })))?.number).toBe(1);
  });

  it("⚠️⚠️ an invoice that does not exist takes no number", async () => {
    expect(await issueInvoice(db, input("ghost"))).toBeNull();
    expect(await counter(invoiceScope("", 2026))).toBeNull();
  });

  it("⚠️ keeps a separate sequence per series and per year", async () => {
    for (const id of ["a", "b", "c", "d"]) await draft(id, id === "c" ? "B" : "");
    expect((await issueInvoice(db, input("a")))?.number).toBe(1);
    expect(await issueInvoice(db, input("c", { series: "B", scope: invoiceScope("B", 2026) }))).toEqual({
      number: 1,
      documentNumber: "1/B",
    });
    expect((await issueInvoice(db, input("b", { fiscalYear: 2027, scope: invoiceScope("", 2027) })))?.number).toBe(1);
    expect((await issueInvoice(db, input("d")))?.number).toBe(2);
  });

  it("⚠️ freezes who the parties were, the date and the totals", async () => {
    await draft("a");
    await issueInvoice(db, input("a"));
    const [row] = await rows(sql`select * from invoice where id = 'a'`);
    expect(row).toMatchObject({
      status: "issued",
      fiscal_year: 2026,
      issue_date: expect.anything(),
      issued_by: "u1",
      issuer_snapshot: { legalName: "Esempio S.r.l." },
      customer_snapshot: { name: "Cliente S.p.A." },
      lines_snapshot: [{ description: "Consulenza", quantity: 1, unitPrice: 100, taxPercent: 22 }],
      stamp_duty: true,
      total: "122.00",
      tax_amount: "22.00",
    });
  });

  it("⚠️⚠️ the database refuses two invoices with one number, whatever the code does", async () => {
    await draft("a");
    await draft("b");
    await db.execute(sql`update invoice set number = 7, fiscal_year = 2026 where id = 'a'`);
    await expect(db.execute(sql`update invoice set number = 7, fiscal_year = 2026 where id = 'b'`)).rejects.toThrow();
  });
});
