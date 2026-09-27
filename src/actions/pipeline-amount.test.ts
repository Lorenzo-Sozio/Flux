/**
 * createDeal and updateDeal, against a real Postgres: a deal in another currency keeps its
 * value through any number of edits.
 *
 * ⚠️⚠️ The edit form sent the EUR figure back with the deal's own currency, and
 * updateDeal converted it again — a USD deal lost the exchange rate on every save.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";
import { dealAmountForEditing } from "@/lib/deal-amount";

const db = drizzle(new PGlite());

vi.mock("@/lib/tenant-context", () => ({ getDb: async () => db, getCurrentTenantId: async () => "t1" }));
vi.mock("@/lib/auth-guard", () => ({
  // The real shape: `requireWriteAccess` answers with `user`, not with the actor.
  requireWriteAccess: async () => ({ user: { id: "u1", role: "editor" } }),
  requireCapability: async () => ({ userId: "u1", tenantRole: "editor", isPlatformStaff: false }),
  requireAdminAccess: async () => undefined,
  requirePlanLimit: async () => undefined,
}));
vi.mock("@/lib/exchange-rates", () => ({ getExchangeRates: async () => ({ rates: { usd: 1.08 } }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k, getFormatter: async () => ({}) }));
vi.mock("@/lib/webhook-dispatch", () => ({ dispatchWebhook: async () => undefined }));
vi.mock("@/components/crm/automation/rule-engine", () => ({ runAutomations: async () => undefined }));
vi.mock("@/lib/notify", () => ({ notify: async () => undefined }));

const { createDeal, updateDeal } = await import("./pipeline");

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  await db.execute(sql`delete from deal`);
  await db.execute(sql`delete from pipeline_stage`);
  await db.execute(sql`insert into pipeline_stage (id, name, "order") values ('s1', 'Proposta', 1)`);
});

async function stored(id: string) {
  const row = (await db.execute(sql`select amount, amount_original, currency from deal where id = ${id}`)).rows[0];
  return row as { amount: string; amount_original: string | null; currency: string };
}

describe("⚠️⚠️ a deal in dollars", () => {
  it("is created with the typed figure kept and the EUR figure derived", async () => {
    const deal = await createDeal({ name: "Sede USA", stageId: "s1", amount: "1000", currency: "USD" });

    expect(await stored(deal.id)).toEqual({ amount: "925.93", amount_original: "1000.00", currency: "USD" });
  });

  it("keeps its value however many times the form is opened and saved", async () => {
    const deal = await createDeal({ name: "Sede USA", stageId: "s1", amount: "1000", currency: "USD" });

    for (let i = 0; i < 3; i++) {
      const [row] = (await db.execute(sql`select * from deal where id = ${deal.id}`)).rows as Record<string, string>[];
      const form = dealAmountForEditing({
        amount: row.amount,
        amountOriginal: row.amount_original,
        currency: row.currency,
      });
      await updateDeal(deal.id, { name: "Sede USA", amount: form.amount, currency: form.currency });
    }

    expect(await stored(deal.id)).toEqual({ amount: "925.93", amount_original: "1000.00", currency: "USD" });
  });

  it("an edit that changes the figure converts the new figure, once", async () => {
    const deal = await createDeal({ name: "Sede USA", stageId: "s1", amount: "1000", currency: "USD" });

    await updateDeal(deal.id, { amount: "2160", currency: "USD" });

    expect(await stored(deal.id)).toEqual({ amount: "2000.00", amount_original: "2160.00", currency: "USD" });
  });
});
