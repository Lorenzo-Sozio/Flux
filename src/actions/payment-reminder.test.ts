/**
 * A payment reminder (E4): sent only for what is overdue, with the receivables schedule's
 * figures, once an hour at most, and a failed send gives its claim back.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";
import * as schema from "@/db/schema";

const db = drizzle(new PGlite(), { schema });
const sent = vi.hoisted(() => ({ list: [] as Record<string, unknown>[], fail: false }));

vi.mock("@/lib/tenant-context", () => ({ getDb: async () => db, getCurrentTenantId: async () => "t1" }));
vi.mock("@/lib/workspace-time-zone", () => ({ getWorkspaceTimeZone: async () => "Europe/Rome" }));
vi.mock("@/lib/auth-guard", () => ({
  requireCapability: async () => ({ userId: "u1", tenantRole: "admin", isPlatformStaff: false }),
  requirePlanModule: async () => undefined,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("@/lib/invoice-archive", () => ({
  archiveInvoice: async () => undefined,
  readInvoiceFile: async () => {
    throw new Error("no storage in tests");
  },
}));
vi.mock("@/lib/email", () => ({
  sendInvoiceCopyEmail: async () => ({ success: true }),
  sendPaymentReminderEmail: async (data: Record<string, unknown>) => {
    if (sent.fail) return { success: false, error: "smtp down" };
    sent.list.push(data);
    return { success: true };
  },
}));

const { sendPaymentReminder } = await import("./invoices");

async function invoice(over: { dueDate?: string; installments?: { dueDate: string; amount: number }[] } = {}) {
  await db.execute(sql`insert into invoice
    (id, status, document_type, document_number, issue_date, due_date, total, currency, company_id, payment_method,
     issuer_snapshot, customer_snapshot, installments)
    values ('inv', 'issued', 'TD01', '7', '2026-01-10', ${over.dueDate ?? "2026-02-10"}, '1000', 'EUR', 'co', 'MP05',
     ${JSON.stringify({ legalName: "Flux Srl", iban: "IT60 X054 2811 1010 0000 0123 456" })}::jsonb,
     ${JSON.stringify({ name: "Rossi Srl", country: "IT" })}::jsonb,
     ${over.installments ? JSON.stringify(over.installments) : null}::jsonb)`);
}
const state = async () =>
  (await db.execute(sql`select reminded_at, reminder_count from invoice where id = 'inv'`)).rows[0] as {
    reminded_at: Date | null;
    reminder_count: number;
  };

beforeAll(async () => {
  await applyTenantMigrations(db as never);
  await db.execute(sql`insert into company (id, name) values ('co', 'Rossi Srl')`);
}, 120_000);

beforeEach(async () => {
  sent.list.length = 0;
  sent.fail = false;
  for (const t of ["order_payment", "receipt", "invoice"]) await db.execute(sql.raw(`delete from "${t}"`));
});

describe("⚠️⚠️ a payment reminder", () => {
  it("chases what is overdue, with the IBAN for a transfer — and only once in the hour", async () => {
    await invoice();
    expect(await sendPaymentReminder("inv", "amministrazione@rossi.it")).toEqual({ ok: true });
    expect(sent.list).toHaveLength(1);
    expect(sent.list[0]).toMatchObject({
      to: "amministrazione@rossi.it",
      documentNumber: "7",
      dueDate: "2026-02-10",
      iban: "IT60 X054 2811 1010 0000 0123 456",
      pdf: null,
      lang: "it",
    });
    expect(String(sent.list[0].amount)).toContain("1.000,00");
    expect((await state()).reminder_count).toBe(1);

    // A double click, or a colleague on the same invoice: nothing goes out.
    expect(await sendPaymentReminder("inv", "amministrazione@rossi.it")).toEqual({
      ok: false,
      error: "reminderJustSent",
    });
    expect(sent.list).toHaveLength(1);
  });

  it("⚠️⚠️ chases the installment that is late, not the invoice total", async () => {
    await invoice({
      dueDate: "2099-03-10",
      installments: [
        { dueDate: "2026-02-10", amount: 500 },
        { dueDate: "2099-03-10", amount: 500 },
      ],
    });
    await db.execute(
      sql`insert into order_payment (id, invoice_id, amount, paid_at) values ('p1', 'inv', '200', now())`,
    );
    expect(await sendPaymentReminder("inv", "a@rossi.it")).toEqual({ ok: true });
    expect(sent.list[0]).toMatchObject({ dueDate: "2026-02-10" });
    expect(String(sent.list[0].amount)).toContain("300,00");
  });

  it("refuses an invoice that is paid, or not yet due", async () => {
    await invoice();
    await db.execute(
      sql`insert into order_payment (id, invoice_id, amount, paid_at) values ('p1', 'inv', '1000', now())`,
    );
    expect(await sendPaymentReminder("inv", "a@rossi.it")).toEqual({ ok: false, error: "reminderNotOverdue" });
    await db.execute(sql`delete from order_payment`);
    await db.execute(sql`update invoice set due_date = '2099-01-01'`);
    expect(await sendPaymentReminder("inv", "a@rossi.it")).toEqual({ ok: false, error: "reminderNotOverdue" });
    expect(sent.list).toHaveLength(0);
    expect((await state()).reminder_count).toBe(0);
  });

  it("a send that fails gives the claim back: the next attempt is not refused", async () => {
    await invoice();
    sent.fail = true;
    expect(await sendPaymentReminder("inv", "a@rossi.it")).toEqual({ ok: false, error: "smtp down" });
    expect(await state()).toEqual({ reminded_at: null, reminder_count: 0 });
    sent.fail = false;
    expect(await sendPaymentReminder("inv", "a@rossi.it")).toEqual({ ok: true });
  });
});
