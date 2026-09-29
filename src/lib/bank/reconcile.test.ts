/**
 * ⚠️⚠️ Bank reconciliation against a real Postgres (I13).
 *
 * The same statement imported twice adds nothing; a line is explained once however many people
 * confirm it at once; money typed by hand before the statement came is linked, never received a
 * second time; an undo gives back exactly what the confirmation took.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";
import * as schema from "@/db/schema";
import { customerCredit, recordReceipt } from "@/lib/receipts";
import { balanceOf } from "@/lib/receivables";

import { numberRepeats } from "./movement";
import {
  bankQueue,
  confirmLine,
  confirmSure,
  createAccount,
  doneLines,
  ignoreLines,
  importMovements,
  restoreLine,
  undoLine,
} from "./reconcile";

const db = drizzle(new PGlite(), { schema });
const TZ = "Europe/Rome";
const TODAY = "2026-09-28";
const IBAN = "IT02L1234512345123456789012";
let account = "";

const one = async <T>(q: ReturnType<typeof sql>) => (await db.execute(q)).rows[0] as T;
const collected = async () =>
  Number((await one<{ s: string }>(sql`select coalesce(sum(amount), 0)::text as s from receipt`)).s);
const owes = async (id: string) => (await balanceOf(db, id))?.outstanding;

async function invoice(id: string, number: string, total = "1220", company = "glicine") {
  await db.execute(sql`insert into invoice (id, status, document_type, total, company_id, currency, document_number, issue_date, due_date)
    values (${id}, 'issued', 'TD01', ${total}, ${company}, 'EUR', ${number}, '2026-09-01', '2026-09-30')`);
}

const line = (over: Record<string, unknown> = {}) => ({
  bookedOn: "2026-09-15",
  amount: 1220,
  currency: "EUR",
  counterpartyName: "Ristorante Il Glicine Srl",
  counterpartyIban: IBAN,
  remittance: "Saldo FT 12/2026",
  bankReference: "CRO-1",
  ...over,
});

async function importOne(over: Record<string, unknown> = {}) {
  const r = await importMovements(db, { accountId: account, movements: [line(over)], format: "camt", by: "u1" });
  if (!r.ok) throw new Error(r.reason);
  const q = await bankQueue(db, { accountId: account, today: TODAY, timeZone: TZ });
  return q.open.find((l) => l.bankReference === (over.bankReference ?? "CRO-1")) ?? q.outgoing[0];
}

beforeAll(async () => {
  await applyTenantMigrations(db as never);
  await db.execute(sql`insert into "user" (id, name, email) values ('u1', 'Anna', 'a@x.it')`);
}, 120_000);

beforeEach(async () => {
  for (const t of [
    "order_payment",
    "receipt",
    "bank_transaction",
    "bank_import",
    "bank_account",
    "company_iban",
    "invoice",
    "company",
  ])
    await db.execute(sql.raw(`delete from "${t}"`));
  await db.execute(
    sql`insert into company (id, name) values ('glicine', 'Ristorante Il Glicine'), ('rossi', 'Mario Rossi')`,
  );
  const a = await createAccount(db, { name: "Conto principale", iban: "IT60 X054 2811 1010 0000 0123 456", by: "u1" });
  if (!a.ok) throw new Error(a.reason);
  account = a.id;
});

describe("⚠️⚠️ importing a statement", () => {
  it("adds each line once, however many times the file comes, and keeps two identical payments as two", async () => {
    const file = numberRepeats([
      line(),
      line({ bankReference: null, remittance: "Quota", amount: 50 }),
      line({ bankReference: null, remittance: "Quota", amount: 50 }),
    ]);
    const first = await importMovements(db, { accountId: account, movements: file, format: "csv", by: "u1" });
    expect(first).toMatchObject({ ok: true, created: 3, skipped: 0, rejected: [] });
    const again = await importMovements(db, { accountId: account, movements: file, format: "csv", by: "u1" });
    expect(again).toMatchObject({ ok: true, created: 0, skipped: 3 });
  });

  it("⚠️ refuses what the server cannot read, and another currency than the account's", async () => {
    const r = await importMovements(db, {
      accountId: account,
      movements: [line({ bookedOn: "15/09/2026" }), line({ currency: "USD" }), line()],
      format: "camt",
      by: "u1",
    });
    expect(r).toMatchObject({
      created: 1,
      rejected: [
        { index: 0, problem: "date" },
        { index: 1, problem: "other_currency" },
      ],
    });
  });
});

describe("⚠️⚠️ confirming", () => {
  it("writes one receipt from the bank, pays the invoice, and learns the payer's IBAN", async () => {
    await invoice("inv12", "12");
    const l = await importOne();
    const best = l.proposals[0];
    expect(best.confidence).toBe("sure");
    const r = await confirmLine(db, { transactionId: l.id, ...best, timeZone: TZ, by: "u1" });
    expect(r.ok).toBe(true);
    expect(await owes("inv12")).toBe(0);
    expect(await collected()).toBe(1220);
    const receipt = await one<{ source: string; bank_transaction_id: string; account_id: string }>(
      sql`select source, bank_transaction_id, account_id from receipt`,
    );
    expect(receipt).toEqual({ source: "bank", bank_transaction_id: l.id, account_id: account });
    const q = await bankQueue(db, { accountId: account, today: TODAY, timeZone: TZ });
    expect(q.counts).toMatchObject({ open: 0, reconciled: 1 });
    // A reconciled line is not ignored behind the receipt's back.
    expect(await ignoreLines(db, { accountId: account, ids: [l.id], by: "u1" })).toBe(0);
    expect((await one<{ n: number }>(sql`select count(*)::int as n from company_iban where iban = ${IBAN}`)).n).toBe(1);

    // Next month the same payer, no invoice number: the IBAN is enough to be sure.
    await invoice("inv20", "20");
    const next = await importOne({ bankReference: "CRO-2", remittance: "bonifico", bookedOn: "2026-09-20" });
    expect(next.proposals[0]).toMatchObject({
      confidence: "sure",
      allocations: [{ invoiceId: "inv20", amount: 1220 }],
    });
  });

  it("⚠️⚠️ two confirmations of the same line at once write one receipt", async () => {
    await invoice("inv12", "12");
    const l = await importOne();
    const results = await Promise.all(
      [0, 1].map(() =>
        confirmLine(db, { transactionId: l.id, companyId: "glicine", allocations: [], timeZone: TZ, by: "u1" }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ reason: "already_reconciled" });
    expect(await collected()).toBe(1220);
  });

  it("⚠️⚠️ a receipt that names an ignored line is refused by the database, not by a read", async () => {
    const l = await importOne();
    await ignoreLines(db, { accountId: account, ids: [l.id], by: "u1" });
    const r = await recordReceipt(db, {
      companyId: "glicine",
      amount: 1220,
      receivedAt: new Date("2026-09-15T10:00:00Z"),
      bankTransactionId: l.id,
      source: "bank",
      by: "u1",
      allocations: [],
    });
    expect(r).toEqual({ ok: false, reason: "already_reconciled" });
    expect(await collected()).toBe(0);
  });

  it("⚠️⚠️ money typed by hand is linked: collected once, and an undo leaves the hand-typed record", async () => {
    await invoice("inv12", "12");
    await recordReceipt(db, {
      amount: 1220,
      receivedAt: new Date("2026-09-14T10:00:00Z"),
      by: "u1",
      allocations: [{ invoiceId: "inv12", amount: 1220 }],
    });
    const l = await importOne();
    const best = l.proposals[0];
    expect(best.receiptIds).toHaveLength(1);
    expect(best.allocations).toEqual([]);
    expect((await confirmLine(db, { transactionId: l.id, ...best, timeZone: TZ, by: "u1" })).ok).toBe(true);
    expect(await collected()).toBe(1220);

    expect((await undoLine(db, l.id)).ok).toBe(true);
    expect(await collected()).toBe(1220);
    expect(await owes("inv12")).toBe(0);
    const q = await bankQueue(db, { accountId: account, today: TODAY, timeZone: TZ });
    expect(q.counts.open).toBe(1);
  });

  it("⚠️ undoing a bank receipt takes it back whole: the invoice owes again, the IBAN is unlearned", async () => {
    await invoice("inv12", "12");
    const l = await importOne();
    await confirmLine(db, { transactionId: l.id, ...l.proposals[0], timeZone: TZ, by: "u1" });
    const undone = await undoLine(db, l.id);
    expect(undone).toMatchObject({ ok: true, invoiceIds: ["inv12"], companyIds: ["glicine"] });
    expect(await collected()).toBe(0);
    expect(await owes("inv12")).toBe(1220);
    expect((await one<{ n: number }>(sql`select count(*)::int as n from company_iban`)).n).toBe(0);
  });

  it("⚠️ never pays an invoice beyond what it owes, and never leaves credit with nobody", async () => {
    await invoice("inv12", "12", "1000");
    const l = await importOne();
    expect(
      await confirmLine(db, {
        transactionId: l.id,
        companyId: "glicine",
        allocations: [{ invoiceId: "inv12", amount: 1220 }],
        timeZone: TZ,
        by: "u1",
      }),
    ).toEqual({ ok: false, reason: "overpays" });
    expect(await confirmLine(db, { transactionId: l.id, allocations: [], timeZone: TZ, by: "u1" })).toEqual({
      ok: false,
      reason: "no_customer",
    });
    // What the invoice does not take is the customer's credit.
    const ok = await confirmLine(db, {
      transactionId: l.id,
      companyId: "glicine",
      allocations: [{ invoiceId: "inv12", amount: 1000 }],
      timeZone: TZ,
      by: "u1",
    });
    expect(ok.ok).toBe(true);
    expect(await customerCredit(db, "glicine")).toEqual([{ currency: "EUR", credit: 220 }]);
  });

  it("money out cannot become a receipt: it is ignored, or a refund written elsewhere", async () => {
    const l = await importOne({ amount: -35.5, remittance: "Commissioni" });
    expect(
      await confirmLine(db, { transactionId: l.id, companyId: "glicine", allocations: [], timeZone: TZ, by: "u1" }),
    ).toEqual({
      ok: false,
      reason: "outgoing",
    });
  });
});

describe("ignoring, and bulk confirmation", () => {
  it("an ignored line leaves the queue, cannot be confirmed, and comes back when restored", async () => {
    const l = await importOne({ amount: -35.5, remittance: "Commissioni" });
    expect(await ignoreLines(db, { accountId: account, ids: [l.id], by: "u1" })).toBe(1);
    expect((await bankQueue(db, { accountId: account, today: TODAY, timeZone: TZ })).counts).toMatchObject({
      outgoing: 0,
      ignored: 1,
    });
    expect((await doneLines(db, { accountId: account, state: "ignored" }))[0].id).toBe(l.id);
    expect(await restoreLine(db, l.id)).toBe(true);
    expect((await bankQueue(db, { accountId: account, today: TODAY, timeZone: TZ })).counts.outgoing).toBe(1);
  });

  it("⚠️⚠️ confirms only what is still sure and still what the person saw", async () => {
    await invoice("inv12", "12");
    await invoice("inv13", "13", "300", "rossi");
    await importMovements(db, {
      accountId: account,
      movements: [
        line(),
        line({ bankReference: "CRO-3", amount: 300, remittance: "fattura 13", counterpartyIban: null }),
        // Only the payer's name and the amount: likely, and a bulk confirmation leaves it alone.
        line({
          bankReference: "CRO-4",
          amount: 300,
          remittance: null,
          counterpartyName: "Mario Rossi",
          counterpartyIban: null,
        }),
      ],
      format: "camt",
      by: "u1",
    });
    const q = await bankQueue(db, { accountId: account, today: TODAY, timeZone: TZ });
    const likely = q.open.find((l) => l.bankReference === "CRO-4");
    expect(likely?.proposals[0].confidence).toBe("likely");
    // The one for "fattura 13" changed before the confirmation: its key no longer matches.
    const picks = q.open.map((l) => ({
      transactionId: l.id,
      key: l.bankReference === "CRO-3" ? "stale" : l.proposals[0].key,
    }));
    const r = await confirmSure(db, { accountId: account, picks, today: TODAY, timeZone: TZ, by: "u1" });
    expect(r).toMatchObject({ confirmed: 1, changed: 2, failed: 0 });
    expect(await owes("inv12")).toBe(0);
    expect(await owes("inv13")).toBe(300);
  });
});

describe("⚠️⚠️ audit of 29 September 2026", () => {
  it("⚠️⚠️ a statement imported months later still finds the receipt typed by hand in its own month", async () => {
    await invoice("inv12", "12");
    await recordReceipt(db, {
      companyId: "glicine",
      amount: 1220,
      receivedAt: new Date("2026-06-10T10:00:00Z"),
      by: "u1",
      allocations: [],
    });
    const l = await importOne({ bookedOn: "2026-06-11" });
    expect(l.proposals[0].receiptIds).toHaveLength(1);
    expect(l.proposals.find((p) => p.receiptIds.length === 0)?.confidence).not.toBe("sure");
  });

  it("⚠️⚠️ the server refuses to receive again money already typed by hand, whatever the screen sent", async () => {
    await invoice("inv12", "12");
    await recordReceipt(db, {
      companyId: "glicine",
      amount: 1220,
      receivedAt: new Date("2026-09-14T10:00:00Z"),
      by: "u1",
      allocations: [],
    });
    const l = await importOne();
    expect(
      await confirmLine(db, {
        transactionId: l.id,
        companyId: "glicine",
        allocations: [{ invoiceId: "inv12", amount: 1220 }],
        timeZone: TZ,
        by: "u1",
      }),
    ).toEqual({ ok: false, reason: "recorded_already" });
  });

  it("⚠️⚠️ a line of another account is refused; an account with no IBAN takes the statement's", async () => {
    const other = await createAccount(db, { name: "Senza IBAN", by: "u1" });
    if (!other.ok) throw new Error(other.reason);
    const r = await importMovements(db, {
      accountId: other.id,
      movements: [line({ accountIban: "IT11A0306909606100000012345" })],
      format: "camt",
      by: "u1",
    });
    expect(r).toMatchObject({ created: 1 });
    const again = await importMovements(db, {
      accountId: other.id,
      movements: [line({ bankReference: "X-2", accountIban: "IT60X0542811101000000123456" })],
      format: "camt",
      by: "u1",
    });
    expect(again).toMatchObject({ created: 0, rejected: [{ index: 0, problem: "other_account" }] });
  });

  it("⚠️ amounts typed the Italian way are read, and one invoice named twice is added up before the check", async () => {
    await invoice("inv12", "12", "100");
    const l = await importOne({ amount: 250 });
    expect(
      await confirmLine(db, {
        transactionId: l.id,
        companyId: "glicine",
        allocations: [
          { invoiceId: "inv12", amount: "60,00" },
          { invoiceId: "inv12", amount: "60,00" },
        ],
        timeZone: TZ,
        by: "u1",
      }),
    ).toEqual({ ok: false, reason: "overpays" });
    expect(
      await confirmLine(db, {
        transactionId: l.id,
        companyId: "glicine",
        allocations: [{ invoiceId: "inv12", amount: "1.00,0" }],
        timeZone: TZ,
        by: "u1",
      }),
    ).toEqual({ ok: false, reason: "invalid_allocation" });
    const ok = await confirmLine(db, {
      transactionId: l.id,
      companyId: "glicine",
      allocations: [{ invoiceId: "inv12", amount: "100,00" }],
      timeZone: TZ,
      by: "u1",
    });
    expect(ok.ok).toBe(true);
    expect(await owes("inv12")).toBe(0);
  });
});
