/**
 * Money recorded on an order reaches its invoice when there is no doubt which one it pays
 * (I9): the order's page and the receivables schedule then agree.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";
import * as schema from "@/db/schema";

// The Neon driver's `batch` is one transaction; statement by statement is enough here.
const db = Object.assign(drizzle(new PGlite(), { schema }), {
  batch: async (queries: unknown[]) => {
    const out: unknown[] = [];
    for (const q of queries) out.push(await q);
    return out;
  },
});
const events = vi.hoisted(() => [] as { name: string; payload: unknown }[]);

vi.mock("@/lib/tenant-context", () => ({ getDb: async () => db, getCurrentTenantId: async () => "t1" }));
vi.mock("@/lib/auth-guard", () => ({
  requireCapability: async () => ({ userId: "u1", tenantRole: "admin", isPlatformStaff: false }),
  requirePlanModule: async () => undefined,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("@/lib/webhook-dispatch", () => ({
  dispatchWebhook: async (name: string, payload: unknown) => {
    events.push({ name, payload });
  },
}));

const { deleteOrder, recordOrderPayment } = await import("./orders");

async function invoice(id: string, over: { status?: string; type?: string } = {}) {
  await db.execute(sql`insert into invoice (id, status, document_type, total, order_id)
    values (${id}, ${over.status ?? "issued"}, ${over.type ?? "TD01"}, '1000', 'o1')`);
}
const links = async () =>
  (
    (await db.execute(sql`select invoice_id from order_payment order by amount`)).rows as {
      invoice_id: string | null;
    }[]
  ).map((r) => r.invoice_id);

beforeAll(async () => {
  await applyTenantMigrations(db as never);
  await db.execute(sql`insert into "user" (id, name, email) values ('u1', 'Anna', 'a@x.it')`);
}, 120_000);

beforeEach(async () => {
  events.length = 0;
  for (const t of ["order_payment", "receipt", "invoice", "order"]) await db.execute(sql.raw(`delete from "${t}"`));
  await db.execute(
    sql`insert into "order" (id, order_number, status, total_amount) values ('o1', 'ORD-1', 'confirmed', '1000')`,
  );
});

describe("⚠️⚠️ a payment on an order and the order's invoice", () => {
  it("one issued invoice: recorded against it, and settling it says so", async () => {
    await invoice("only");
    await invoice("draft", { status: "draft" });
    await invoice("credit", { type: "TD04" });
    await recordOrderPayment("o1", { amount: 400 });
    await recordOrderPayment("o1", { amount: 600 });
    expect(await links()).toEqual(["only", "only"]);
    expect(events).toEqual([{ name: "invoice.paid", payload: { id: "only", paid: 1000, due: 1000 } }]);
  });

  it("⚠️⚠️ several issued invoices: it must say which — and then it pays that one", async () => {
    // I10: it used to stay on the order, and both invoices then read unpaid for ever.
    await invoice("a");
    await invoice("b");
    await expect(recordOrderPayment("o1", { amount: 400 })).rejects.toThrow("paymentChooseInvoice");
    expect(await links()).toEqual([]);
    await recordOrderPayment("o1", { amount: 400, invoiceId: "b" });
    expect(await links()).toEqual(["b"]);
    // An invoice of another order is not one it can pay.
    await db.execute(
      sql`insert into "order" (id, order_number, status, total_amount) values ('o2', 'ORD-2', 'confirmed', '10')`,
    );
    await db.execute(
      sql`insert into invoice (id, status, document_type, total, order_id) values ('other', 'issued', 'TD01', '10', 'o2')`,
    );
    await expect(recordOrderPayment("o1", { amount: 5, invoiceId: "other" })).rejects.toThrow("notFound");
  });

  it("no invoice yet: on the order, as before", async () => {
    await recordOrderPayment("o1", { amount: 400 });
    expect(await links()).toEqual([null]);
  });

  it("⚠️⚠️ deleting a cancelled order keeps what was paid on its invoice", async () => {
    await invoice("only");
    await recordOrderPayment("o1", { amount: 400 });
    await db.execute(sql`insert into order_payment (id, order_id, amount) values ('order-only', 'o1', '50')`);
    await db.execute(sql`update "order" set status = 'cancelled'`);
    await deleteOrder("o1");
    const rows = (await db.execute(sql`select order_id, invoice_id, amount::text as amount from order_payment`)).rows;
    // The invoice's money stays, detached from the order; the order's own went with it.
    expect(rows).toEqual([{ order_id: null, invoice_id: "only", amount: "400.00" }]);
  });

  it("refuses an amount that is not one, or a day that is not a day", async () => {
    await expect(recordOrderPayment("o1", { amount: "12abc" as never })).rejects.toThrow("paymentPositive");
    await expect(recordOrderPayment("o1", { amount: 10, paidAt: "garbage" })).rejects.toThrow("paymentDate");
    expect(await links()).toEqual([]);
  });
});
