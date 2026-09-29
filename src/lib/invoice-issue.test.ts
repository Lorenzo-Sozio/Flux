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

import { italianToday } from "./invoice-draft";
import { type IssueInput, issueInvoice } from "./invoice-issue";
import { invoiceScope } from "./invoice-rules";

const db = drizzle(new PGlite());
// The issue refuses a date that is not today in Rome: every test issues today.
const TODAY = italianToday();
const YEAR = Number(TODAY.slice(0, 4));

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  await db.execute(sql`delete from invoice`);
  await db.execute(sql`delete from "order"`);
  await db.execute(sql`delete from document_counter where scope like 'invoice:%' or scope = 'sdi-file'`);
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
  scope: invoiceScope(over.series ?? "", YEAR),
  series: "",
  fiscalYear: YEAR,
  issueDate: TODAY,
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
    expect(await counter(invoiceScope("", YEAR))).toBe(1);
    expect((await issueInvoice(db, input("b")))?.number, "a gap after the double press").toBe(2);
  });

  it("⚠️⚠️ a draft changed since it was checked is not issued, and takes no number", async () => {
    await draft("a");
    await db.execute(sql`update invoice set revision = 2 where id = 'a'`);
    expect(await issueInvoice(db, input("a", { revision: 1 }))).toBeNull();
    expect(await counter(invoiceScope("", YEAR))).toBeNull();
    expect((await issueInvoice(db, input("a", { revision: 2 })))?.number).toBe(1);
  });

  it("⚠️⚠️ an invoice that does not exist takes no number", async () => {
    expect(await issueInvoice(db, input("ghost"))).toBeNull();
    expect(await counter(invoiceScope("", YEAR))).toBeNull();
  });

  it("⚠️ keeps a separate sequence per series and per year", async () => {
    for (const id of ["a", "b", "c", "d"]) await draft(id, id === "c" ? "B" : "");
    expect((await issueInvoice(db, input("a")))?.number).toBe(1);
    expect(await issueInvoice(db, input("c", { series: "B", scope: invoiceScope("B", YEAR) }))).toEqual({
      number: 1,
      documentNumber: "1/B",
    });
    expect(
      (await issueInvoice(db, input("b", { fiscalYear: YEAR + 1, scope: invoiceScope("", YEAR + 1) })))?.number,
    ).toBe(1);
    expect((await issueInvoice(db, input("d")))?.number).toBe(2);
  });

  it("⚠️ freezes who the parties were, the date and the totals", async () => {
    await draft("a");
    await issueInvoice(db, input("a"));
    const [row] = await rows(sql`select * from invoice where id = 'a'`);
    expect(row).toMatchObject({
      status: "issued",
      fiscal_year: YEAR,
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

  it("⚠️⚠️ freezes the installments, and the last one is the due date (I12)", async () => {
    await draft("a");
    await db.execute(sql`update invoice set due_date = '2026-10-01' where id = 'a'`);
    const installments = [
      { dueDate: "2026-10-31", amount: 61 },
      { dueDate: "2026-11-30", amount: 61 },
    ];
    await issueInvoice(db, input("a", { installments }));
    const [row] = await rows(sql`select installments, due_date::text as due from invoice where id = 'a'`);
    expect(row).toEqual({ installments, due: "2026-11-30" });
    // Without installments the due date typed on the draft stands.
    await draft("b");
    await db.execute(sql`update invoice set due_date = '2026-10-01' where id = 'b'`);
    await issueInvoice(db, input("b"));
    expect((await rows(sql`select installments, due_date::text as due from invoice where id = 'b'`))[0]).toEqual({
      installments: null,
      due: "2026-10-01",
    });
  });

  it("⚠️⚠️ the database refuses two invoices with one number, whatever the code does", async () => {
    await draft("a");
    await draft("b");
    await db.execute(sql`update invoice set number = 7, fiscal_year = 2026 where id = 'a'`);
    await expect(db.execute(sql`update invoice set number = 7, fiscal_year = 2026 where id = 'b'`)).rejects.toThrow();
  });
});

describe("credit notes", () => {
  const scope = invoiceScope("", YEAR);
  const credited = async (id: string) =>
    (await rows(sql`select credited_amount from invoice where id = ${id}`))[0]?.credited_amount;
  const total = (n: number) => ({ subtotal: n, discountAmount: 0, taxableAmount: n, taxAmount: 0, total: n });

  async function issuedInvoice(id: string, amount: number) {
    await draft(id);
    await issueInvoice(db, input(id, { totals: total(amount) }));
  }
  async function creditDraft(id: string, of: string) {
    await db.execute(sql`insert into invoice (id, document_type, original_invoice_id) values (${id}, 'TD04', ${of})`);
  }
  const issueCredit = (id: string, of: string, amount: number) =>
    issueInvoice(db, input(id, { creditOf: of, totals: total(amount) }));

  it("⚠️⚠️ a credit note is numbered and takes its amount from the invoice", async () => {
    await issuedInvoice("inv", 122);
    await creditDraft("cn", "inv");
    expect((await issueCredit("cn", "inv", 122))?.number).toBe(2);
    expect(await credited("inv")).toBe("122.00");
  });

  it("⚠️⚠️ never gives back more than was invoiced, and a refused note takes no number", async () => {
    await issuedInvoice("inv", 100);
    await creditDraft("a", "inv");
    await creditDraft("b", "inv");
    expect((await issueCredit("a", "inv", 60))?.number).toBe(2);
    expect(await issueCredit("b", "inv", 50), "the second note exceeded what was left").toBeNull();
    expect(await credited("inv")).toBe("60.00");
    expect(await counter(scope), "a refused credit note consumed a number").toBe(2);
    expect((await rows(sql`select status from invoice where id = 'b'`))[0].status).toBe("draft");
    expect((await issueCredit("b", "inv", 40))?.number, "the exact remainder is refused").toBe(3);
    expect(await credited("inv")).toBe("100.00");
  });

  it("⚠️⚠️ two credit notes issued at once cannot both take the same remainder", async () => {
    await issuedInvoice("inv", 100);
    await creditDraft("a", "inv");
    await creditDraft("b", "inv");
    const results = await Promise.all([issueCredit("a", "inv", 70), issueCredit("b", "inv", 70)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await credited("inv")).toBe("70.00");
  });

  it("⚠️ does not credit a draft invoice, another credit note, or when the note itself is not a draft", async () => {
    await draft("d");
    await creditDraft("x", "d");
    expect(await issueCredit("x", "d", 10), "credited a draft").toBeNull();
    expect(await credited("d")).toBe("0.00");

    await issuedInvoice("inv", 100);
    await creditDraft("cn", "inv");
    await issueCredit("cn", "inv", 10);
    await creditDraft("cn2", "cn");
    expect(await issueCredit("cn2", "cn", 5), "credited a credit note").toBeNull();

    // The note already issued: pressing again changes nothing on the invoice.
    expect(await issueCredit("cn", "inv", 10)).toBeNull();
    expect(await credited("inv")).toBe("10.00");
  });

  it("an invoice without creditOf is issued exactly as before", async () => {
    await issuedInvoice("inv", 100);
    expect(await credited("inv")).toBe("0.00");
    expect(await counter(scope)).toBe(1);
  });
});

describe("⚠️⚠️ a balance invoice takes its deposits off in the same statement (I11)", () => {
  const scope = invoiceScope("", YEAR);
  const deducted = async (id: string) =>
    (await rows(sql`select deducted_in_invoice_id from invoice where id = ${id}`))[0]?.deducted_in_invoice_id ?? null;

  async function issuedDeposit(id: string) {
    await db.execute(sql`insert into invoice (id, document_type) values (${id}, 'TD02')`);
    await issueInvoice(db, input(id));
  }

  it("takes a deposit off once: a second balance naming it is refused and takes no number", async () => {
    await issuedDeposit("dep");
    await draft("bal1");
    await draft("bal2");
    expect((await issueInvoice(db, input("bal1", { deducts: [{ id: "dep", credited: 0 }] })))?.number).toBe(2);
    expect(await deducted("dep")).toBe("bal1");
    expect(
      await issueInvoice(db, input("bal2", { deducts: [{ id: "dep", credited: 0 }] })),
      "the deposit was taken off twice",
    ).toBeNull();
    expect(await counter(scope), "a refused balance consumed a number").toBe(2);
    expect((await rows(sql`select status from invoice where id = 'bal2'`))[0].status).toBe("draft");
  });

  it("⚠️ takes off only an issued deposit invoice, never a draft or another kind", async () => {
    await db.execute(sql`insert into invoice (id, document_type) values ('dep-draft', 'TD02')`);
    await draft("inv");
    await issueInvoice(db, input("inv"));
    await draft("bal");
    expect(await issueInvoice(db, input("bal", { deducts: [{ id: "dep-draft", credited: 0 }] }))).toBeNull();
    expect(await issueInvoice(db, input("bal", { deducts: [{ id: "inv", credited: 0 }] }))).toBeNull();
    expect(await deducted("inv")).toBeNull();
  });

  it("⚠️ a deposit taken off is not credited, and one a credit note touched is not taken off", async () => {
    await issuedDeposit("dep");
    await draft("bal");
    await issueInvoice(db, input("bal", { deducts: [{ id: "dep", credited: 0 }] }));
    await db.execute(sql`insert into invoice (id, document_type, original_invoice_id) values ('cn', 'TD04', 'dep')`);
    expect(await issueInvoice(db, input("cn", { creditOf: "dep" })), "credited after being taken off").toBeNull();

    await issuedDeposit("dep2");
    await db.execute(sql`update invoice set credited_amount = '10' where id = 'dep2'`);
    await draft("bal2");
    expect(await issueInvoice(db, input("bal2", { deducts: [{ id: "dep2", credited: 0 }] }))).toBeNull();
  });

  it("an invoice that names no deposit is issued as before", async () => {
    await draft("plain");
    expect((await issueInvoice(db, input("plain", { deducts: [] })))?.number).toBe(1);
  });
});

describe("⚠️⚠️ audit of 29 September 2026: what a refused issue must leave untouched", () => {
  const deducted = async (id: string) =>
    (await rows(sql`select deducted_in_invoice_id from invoice where id = ${id}`))[0]?.deducted_in_invoice_id ?? null;
  async function issuedDeposit(id: string, order: string | null = null, total = 122) {
    await db.execute(sql`insert into invoice (id, document_type, order_id) values (${id}, 'TD02', ${order})`);
    await issueInvoice(db, input(id, { documentType: "TD02", orderId: order, totals: { ...input(id).totals, total } }));
  }
  async function order(id: string, total: number) {
    await db.execute(
      sql`insert into "order" (id, order_number, total_amount) values (${id}, ${`ORD-${id}`}, ${String(total)})`,
    );
  }

  it("⚠️⚠️ a balance refused for one deposit marks none of the others as taken off", async () => {
    await issuedDeposit("d1");
    await issuedDeposit("d2");
    // A credit note reached d2 after the balance's deduction was computed.
    await db.execute(sql`update invoice set credited_amount = '10' where id = 'd2'`);
    await draft("bal");
    const deducts = [
      { id: "d1", credited: 0 },
      { id: "d2", credited: 0 },
    ];
    expect(await issueInvoice(db, input("bal", { deducts }))).toBeNull();
    expect(await deducted("d1"), "d1 was marked by a balance that was refused").toBeNull();
    // Computed again from what d2 has become, it goes through.
    expect(
      (
        await issueInvoice(
          db,
          input("bal", {
            deducts: [
              { id: "d1", credited: 0 },
              { id: "d2", credited: 10 },
            ],
          }),
        )
      )?.number,
    ).toBe(3);
    expect([await deducted("d1"), await deducted("d2")]).toEqual(["bal", "bal"]);
  });

  it("⚠️⚠️ an order is invoiced once: a second balance is refused while the first is not credited back", async () => {
    await order("o1", 122);
    await db.execute(sql`insert into invoice (id, order_id) values ('b1', 'o1'), ('b2', 'o1')`);
    expect(await issueInvoice(db, input("b1", { orderId: "o1" }))).not.toBeNull();
    expect(await issueInvoice(db, input("b2", { orderId: "o1" })), "the order was invoiced twice").toBeNull();
    // Credited back in full, the order may be invoiced again.
    await db.execute(sql`update invoice set credited_amount = total where id = 'b1'`);
    expect(await issueInvoice(db, input("b2", { orderId: "o1" }))).not.toBeNull();
  });

  it("⚠️⚠️ a balance that leaves out a deposit of its order is refused", async () => {
    await order("o1", 1000);
    await issuedDeposit("dep", "o1");
    await db.execute(sql`insert into invoice (id, order_id) values ('bal', 'o1')`);
    expect(await issueInvoice(db, input("bal", { orderId: "o1" })), "the deposit would be invoiced twice").toBeNull();
    expect(
      await issueInvoice(db, input("bal", { orderId: "o1", deducts: [{ id: "dep", credited: 0 }] })),
    ).not.toBeNull();
  });

  it("⚠️ deposit invoices never add up to more than the order", async () => {
    await order("o1", 200);
    await issuedDeposit("dep1", "o1", 122);
    await db.execute(sql`insert into invoice (id, document_type, order_id) values ('dep2', 'TD02', 'o1')`);
    const big = { ...input("dep2").totals, total: 100 };
    expect(await issueInvoice(db, input("dep2", { documentType: "TD02", orderId: "o1", totals: big }))).toBeNull();
    const fits = { ...input("dep2").totals, total: 78 };
    expect(await issueInvoice(db, input("dep2", { documentType: "TD02", orderId: "o1", totals: fits }))).not.toBeNull();
  });

  it("⚠️⚠️ a balance credited back in full gives its deposits back", async () => {
    await issuedDeposit("dep");
    await draft("bal");
    await issueInvoice(db, input("bal", { deducts: [{ id: "dep", credited: 0 }] }));
    await db.execute(sql`insert into invoice (id, document_type, original_invoice_id) values ('cn', 'TD04', 'bal')`);
    expect(await issueInvoice(db, input("cn", { documentType: "TD04", creditOf: "bal" }))).not.toBeNull();
    expect(await deducted("dep"), "the deposit stays taken off by a cancelled balance").toBeNull();
  });

  it("a partial credit note on a balance keeps its deposits taken off", async () => {
    await issuedDeposit("dep");
    await draft("bal");
    await issueInvoice(db, input("bal", { deducts: [{ id: "dep", credited: 0 }] }));
    await db.execute(sql`insert into invoice (id, document_type, original_invoice_id) values ('cn', 'TD04', 'bal')`);
    const part = { ...input("cn").totals, total: 10 };
    expect(await issueInvoice(db, input("cn", { documentType: "TD04", creditOf: "bal", totals: part }))).not.toBeNull();
    expect(await deducted("dep")).toBe("bal");
  });

  it("⚠️⚠️ an invoice of another series takes an SDI file progressive; the main series takes none", async () => {
    await draft("m");
    await draft("b1", "B");
    await draft("b2", "B");
    await issueInvoice(db, input("m"));
    await issueInvoice(db, input("b1", { series: "B", scope: invoiceScope("B", YEAR) }));
    await issueInvoice(db, input("b2", { series: "B", scope: invoiceScope("B", YEAR) }));
    const progressive = async (id: string) =>
      (await rows(sql`select sdi_progressive from invoice where id = ${id}`))[0]?.sdi_progressive ?? null;
    expect(await progressive("m")).toBeNull();
    const [p1, p2] = [await progressive("b1"), await progressive("b2")];
    expect(p1).not.toBeNull();
    expect(p2).not.toBe(p1);
  });

  it("⚠️ an invoice dated another day than today takes no number", async () => {
    await draft("a");
    expect(await issueInvoice(db, input("a", { issueDate: "2020-01-01" }))).toBeNull();
    expect(await counter(invoiceScope("", YEAR))).toBeNull();
  });
});
