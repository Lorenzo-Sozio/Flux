/**
 * ⚠️⚠️ The money rules on a real Postgres, through the driver production uses.
 *
 * Everything else runs on PGlite, which is one connection: two requests can never race there, so
 * a guard that only works when nothing else is running looks exactly like one that always works.
 * Here the pooled `pg` driver (`createTenantDb`, the path Hyperdrive takes on Workers) opens real
 * connections, `together()` is a real transaction per `batchOnPool`, and the races are real.
 *
 * Needs a throwaway Postgres: `FLUX_PG_TEST_URL=postgres://postgres:flux@localhost:55432/flux_test`
 * (for instance `docker run --rm -p 55432:5432 -e POSTGRES_PASSWORD=flux -e POSTGRES_DB=flux_test
 * postgres:16`). Without it the file is skipped. ⚠️ It empties the tables it uses: never point it
 * at a database that matters.
 */
import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTenantDb } from "@/db";
import { applyTenantMigrations } from "@/db/migrate-tenant";
import { invoiceScope } from "@/lib/invoice-rules";

import { italianToday } from "./invoice-draft";
import { type IssueInput, issueInvoice } from "./invoice-issue";
import { allocateCredit, recordReceipt, recordRefund } from "./receipts";
import { balanceOf, recordInvoicePayment } from "./receivables";
import { sendToSdi } from "./sdi/transmit";
import { encryptSecret } from "./tenant-db";

const URL = process.env.FLUX_PG_TEST_URL;
const local = URL ? /@(localhost|127\.0\.0\.1)[:/]/.test(URL) : false;
// biome-ignore lint/suspicious/noExplicitAny: the pooled drizzle instance, typed loosely as in the lib
const db = (local ? createTenantDb("pg-test", URL as string) : null) as any;
const TODAY = italianToday();
const YEAR = Number(TODAY.slice(0, 4));
const DAY = new Date();
// A race that passes once proves little: each one runs ten times.
const RUNS = Array.from({ length: 10 }, (_, i) => i);

const rows = async (q: ReturnType<typeof sql>) => ((await db.execute(q)) as { rows: Record<string, unknown>[] }).rows;
const allocatedTo = async (invoiceId: string) =>
  Number(
    (await rows(sql`select coalesce(sum(amount), 0)::text as s from order_payment where invoice_id = ${invoiceId}`))[0]
      .s,
  );

describe.skipIf(!local)("⚠️⚠️ money on a real Postgres, with real races", () => {
  beforeAll(async () => {
    // From nothing, every run: the whole history of migrations applied to the real engine.
    await db.execute(
      sql.raw(`drop schema if exists drizzle cascade; drop schema public cascade; create schema public`),
    );
    const first = await applyTenantMigrations(db);
    expect(first.applied.length).toBeGreaterThan(0);
    // Every tenant migration is re-runnable, on the real engine too.
    const again = await applyTenantMigrations(db);
    expect(again.applied).toEqual([]);
    await db.execute(sql`insert into "user" (id, name, email) values ('u1', 'Anna', 'a@x.it') on conflict do nothing`);
  }, 180_000);

  beforeEach(async () => {
    for (const t of ["order_payment", "receipt", "invoice", "document_counter", "company"])
      await db.execute(sql.raw(`delete from "${t}"`));
    await db.execute(sql`insert into company (id, name) values ('acme', 'Acme')`);
  });

  async function invoice(id: string, total = "1000") {
    await db.execute(sql`insert into invoice (id, status, document_type, total, company_id, currency)
      values (${id}, 'issued', 'TD01', ${total}, 'acme', 'EUR')`);
  }

  it.each(
    RUNS,
  )("⚠️⚠️ #%i two payments crossing on one invoice: it never receives more than it owes, and no money is lost", async () => {
    await invoice("a");
    const [one, two] = await Promise.all([
      recordInvoicePayment(db, { invoiceId: "a", amount: 600, paidAt: DAY, by: "u1" }),
      recordInvoicePayment(db, { invoiceId: "a", amount: 600, paidAt: DAY, by: "u1" }),
    ]);
    expect(await allocatedTo("a")).toBeLessThanOrEqual(1000);
    // Both transfers arrived: both are recorded, and what the invoice could not take is credit.
    expect(one.ok && two.ok).toBe(true);
    const received = await rows(sql`select coalesce(sum(amount), 0)::text as s from receipt`);
    expect(Number(received[0].s)).toBe(1200);
    expect(await allocatedTo("a")).toBe(1000);
    expect((await balanceOf(db, "a"))?.outstanding).toBe(0);
  });

  it.each(RUNS)("⚠️⚠️ #%i two refunds racing for one credit: only what there is goes back", async () => {
    const r = await recordReceipt(db, { companyId: "acme", amount: 150, receivedAt: DAY, by: "u1", allocations: [] });
    expect(r.ok).toBe(true);
    const results = await Promise.all([
      recordRefund(db, { companyId: "acme", currency: "EUR", amount: 100, receivedAt: DAY, by: "u1" }),
      recordRefund(db, { companyId: "acme", currency: "EUR", amount: 100, receivedAt: DAY, by: "u1" }),
    ]);
    expect(results.filter((x) => x.ok)).toHaveLength(1);
    const left = await rows(sql`select coalesce(sum(amount), 0)::text as s from receipt where company_id = 'acme'`);
    expect(Number(left[0].s)).toBe(50);
  });

  it.each(RUNS)("⚠️⚠️ #%i one credit spent on two invoices at once: never more than it holds", async () => {
    await invoice("a", "100");
    await invoice("b", "100");
    const r = await recordReceipt(db, { companyId: "acme", amount: 150, receivedAt: DAY, by: "u1", allocations: [] });
    if (!r.ok) throw new Error("receipt not recorded");
    const results = await Promise.all([
      allocateCredit(db, { receiptId: r.receiptId, invoiceId: "a", amount: 100, by: "u1" }),
      allocateCredit(db, { receiptId: r.receiptId, invoiceId: "b", amount: 100, by: "u1" }),
    ]);
    expect(results.filter((x) => x.ok)).toHaveLength(1);
    const spent = await rows(
      sql`select coalesce(sum(amount), 0)::text as s from order_payment where receipt_id = ${r.receiptId}`,
    );
    expect(Number(spent[0].s)).toBe(100);
  });

  it("⚠️⚠️ a refused statement takes the whole transaction with it", async () => {
    await invoice("a", "100");
    const r = await recordReceipt(db, {
      companyId: "acme",
      amount: 500,
      receivedAt: DAY,
      by: "u1",
      allocations: [{ invoiceId: "a", amount: 500 }],
    });
    expect(r).toEqual({ ok: false, reason: "overpays" });
    expect(await rows(sql`select id from receipt`)).toEqual([]);
    expect(await rows(sql`select id from order_payment`)).toEqual([]);
  });

  it.each(RUNS)("⚠️⚠️ #%i an invoice sent to SDI twice at once is handed to the intermediary once", async () => {
    process.env.PLATFORM_ENCRYPTION_KEY ??= randomBytes(32).toString("hex");
    await db.execute(sql`delete from sdi_setting`);
    await db.execute(sql`insert into sdi_setting (id, channel, environment, username, password)
      values ('workspace', 'aruba', 'demo', 'u', ${encryptSecret("p")})`);
    await db.execute(sql`insert into invoice (id, status, document_type, series, fiscal_year, number, document_number,
        issue_date, total, currency, company_id, issuer_snapshot, customer_snapshot, lines_snapshot)
      values ('s', 'issued', 'TD01', '', ${YEAR}, 1, '1', ${TODAY}, '122', 'EUR', 'acme',
        '{"legalName":"E","vatNumber":"01234567890"}', '{"name":"C","sdiCode":"ABC1234"}',
        '[{"description":"x","quantity":1,"unitPrice":100,"taxPercent":22}]')`);
    let uploads = 0;
    const fakeFetch = async (url: string) => {
      if (url.endsWith("/auth/signin")) return new Response(JSON.stringify({ access_token: "A", expires_in: 1800 }));
      uploads++;
      await new Promise((r) => setTimeout(r, 20));
      return new Response(JSON.stringify({ errorCode: "0000", uploadFileName: "f.xml" }));
    };
    const results = await Promise.all([
      sendToSdi(db, "s", { fetch: fakeFetch }),
      sendToSdi(db, "s", { fetch: fakeFetch }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(uploads).toBe(1);
  });

  describe("issuing", () => {
    const input = (id: string): IssueInput => ({
      invoiceId: id,
      revision: 1,
      scope: invoiceScope("", YEAR),
      series: "",
      fiscalYear: YEAR,
      issueDate: TODAY,
      issuedBy: "u1",
      issuerSnapshot: { legalName: "Esempio S.r.l." },
      customerSnapshot: { name: "Cliente S.p.A." },
      linesSnapshot: [{ description: "Consulenza", quantity: 1, unitPrice: 100, taxPercent: 22 }],
      stampDuty: false,
      totals: { subtotal: 100, discountAmount: 0, taxableAmount: 100, taxAmount: 22, total: 122 },
    });

    it.each(RUNS)("⚠️⚠️ #%i the same draft issued twice at once takes one number", async () => {
      await db.execute(sql`insert into invoice (id, series) values ('d', '')`);
      const results = await Promise.all([issueInvoice(db, input("d")), issueInvoice(db, input("d"))]);
      expect(results.filter(Boolean)).toEqual([{ number: 1, documentNumber: "1" }]);
      const counter = await rows(sql`select last_value from document_counter`);
      expect(counter.map((c) => Number(c.last_value))).toEqual([1]);
    });

    it.each(RUNS)("⚠️⚠️ #%i five drafts issued at once get five numbers, none twice, none skipped", async () => {
      for (const id of ["a", "b", "c", "d", "e"])
        await db.execute(sql`insert into invoice (id, series) values (${id}, '')`);
      const results = await Promise.all(["a", "b", "c", "d", "e"].map((id) => issueInvoice(db, input(id))));
      expect(results.map((r) => r?.number).sort()).toEqual([1, 2, 3, 4, 5]);
    });
  });
});
