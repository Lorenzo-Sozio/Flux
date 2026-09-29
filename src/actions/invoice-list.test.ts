/**
 * The invoices page's reads, against a real Postgres: the list with every filter, and one
 * invoice with its payments. A statement that does not parse fails here, not in production.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";
import * as schema from "@/db/schema";

const db = drizzle(new PGlite(), { schema });

vi.mock("@/lib/tenant-context", () => ({ getDb: async () => db, getCurrentTenantId: async () => "t1" }));
vi.mock("@/lib/workspace-time-zone", () => ({ getWorkspaceTimeZone: async () => "Europe/Rome" }));
vi.mock("@/lib/auth-guard", () => ({
  requireCapability: async () => ({ userId: "u1", tenantRole: "admin", isPlatformStaff: false }),
  requirePlanModule: async () => undefined,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));

const { getInvoices, getInvoice, getInvoicePayments } = await import("./invoices");
const page = { page: 1, pageSize: 25, search: "", sort: null, dir: "desc" } as never;

beforeAll(async () => {
  await applyTenantMigrations(db as never);
  await db.execute(sql`insert into company (id, name) values ('co', 'Rossi Srl')`);
  await db.execute(sql`insert into invoice (id, status, document_type, document_number, issue_date, due_date, total, currency, company_id)
    values ('late', 'issued', 'TD01', '1', '2026-01-10', '2026-02-10', '1000', 'EUR', 'co'),
           ('paid', 'issued', 'TD01', '2', '2026-01-11', '2026-02-11', '500', 'EUR', 'co'),
           ('draft', 'draft', 'TD01', null, null, null, '0', 'EUR', 'co'),
           ('note', 'issued', 'TD04', '3', '2026-01-12', null, '100', 'EUR', 'co')`);
  await db.execute(
    sql`update invoice set installments = ${JSON.stringify([
      { dueDate: "2026-02-10", amount: 500 },
      { dueDate: "2099-03-10", amount: 500 },
    ])}::jsonb where id = 'late'`,
  );
  await db.execute(
    sql`insert into order_payment (id, invoice_id, amount, paid_at) values ('p1', 'paid', '500', now())`,
  );
}, 120_000);

describe("⚠️⚠️ the invoices page reads", () => {
  it("lists with every filter, each issued invoice with where its money stands", async () => {
    const all = await getInvoices(page, "all");
    expect(all.total).toBe(4);
    const byId = Object.fromEntries(all.rows.map((r) => [r.id, r.payment]));
    expect(byId.late).toMatchObject({ state: "overdue", overdueAmount: 500 });
    expect(byId.paid).toEqual({ state: "paid" });
    expect(byId.draft).toBeNull();
    expect(byId.note).toBeNull();

    expect((await getInvoices(page, "unpaid")).rows.map((r) => r.id)).toEqual(["late"]);
    expect((await getInvoices(page, "overdue")).rows.map((r) => r.id)).toEqual(["late"]);
    expect((await getInvoices(page, "draft")).rows.map((r) => r.id)).toEqual(["draft"]);
    expect((await getInvoices(page, "all", "2026-01")).total).toBe(3);
    expect((await getInvoices({ ...(page as object), search: "Rossi" } as never, "issued")).total).toBe(3);
  });

  it("reads one invoice and its payments", async () => {
    const invoice = await getInvoice("late");
    expect(invoice?.invoice.id).toBe("late");
    const payments = await getInvoicePayments("paid");
    expect(payments?.balance.outstanding).toBe(0);
  });
});
