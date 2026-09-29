/**
 * One definition per number — against a real Postgres, through the screens that show them.
 *
 * ⚠️⚠️ Home, Reports, Finance and the Pipeline pages each computed the same figures their
 * own way: wins dated by `updatedAt` on some and `closedAt` on others, a sale counted once as
 * a won deal and again as the order it became, win rate over deals *created*, "open tickets"
 * without the `new` ones, and document totals in different currencies added as euros.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";

import { isTicketOpen } from "./ticket-states";

const db = drizzle(new PGlite());

vi.mock("@/lib/tenant-context", () => ({ getDb: async () => db, getCurrentTenantId: async () => "t1" }));
vi.mock("@/lib/auth-guard", () => ({
  requireCapability: async () => undefined,
  requireAdminAccess: async () => undefined,
  requireWriteAccess: async () => undefined,
  requirePlanLimit: async () => undefined,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (k: string) => k,
  getFormatter: async () => ({ dateTime: (d: Date) => d.toISOString().slice(0, 7) }),
}));

const { getReportKPIs, getSalesReport } = await import("@/actions/reports");
const { periodOf } = await import("@/lib/metrics");
const { getFinanceDashboard } = await import("@/actions/finance");
const { getDashboardStats } = await import("@/actions/dashboard");

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  for (const table of ["order", "quote", "deal", "ticket", "pipeline_stage", "company"]) {
    await db.execute(sql.raw(`delete from "${table}"`));
  }
  await db.execute(
    sql`insert into pipeline_stage (id, name, "order", default_probability) values ('s1', 'Proposta', 1, 40), ('won', 'Vinta', 9, 100)`,
  );
  await db.execute(sql`insert into company (id, name) values ('co', 'Rossi Srl')`);
});

async function deal(id: string, status: string, amount: number, closedAt: string | null, updatedAt: string) {
  await db.execute(
    sql`insert into deal (id, name, amount, status, stage_id, closed_at, updated_at) values (${id}, ${id}, ${String(amount)}, ${status}, ${status === "open" ? "s1" : "won"}, ${closedAt}, ${updatedAt})`,
  );
}

const september = { from: "2026-09-01", to: "2026-09-30" };

describe("⚠️⚠️ won this period", () => {
  it("is dated by when the deal closed, not by when it was last saved", async () => {
    // Won in March, a note added in September.
    await deal("marzo", "won", 1000, "2026-03-10T10:00:00Z", "2026-09-15T10:00:00Z");
    await deal("settembre", "won", 500, "2026-09-12T10:00:00Z", "2026-09-12T10:00:00Z");

    const kpi = await getReportKPIs(september);
    const sales = await getSalesReport(september);
    expect(kpi.dealsWon).toBe(1);
    expect(sales.dealsWon).toEqual({ count: 1, revenue: 500 });
  });

  it("⚠️⚠️ counts a sale once — not once as a deal and again as the order it became", async () => {
    await deal("d1", "won", 1000, "2026-09-12T10:00:00Z", "2026-09-12T10:00:00Z");
    await db.execute(
      sql`insert into "order" (id, order_number, company_id, deal_id, status, total_amount, currency, order_date) values ('o1', 'ORD-1', 'co', 'd1', 'completed', '1000', 'EUR', '2026-09-13T10:00:00Z')`,
    );

    const sales = await getSalesReport(september);
    expect(sales.totalRevenue).toBe(1000);
    expect(sales.ordersCompleted.revenue).toBe(1000);
  });
});

describe("⚠️⚠️ the month a win belongs to", () => {
  it("is the workspace's month: 00:30 on 1 October in Rome is October, though UTC still says September", async () => {
    await deal("mezzanotte", "won", 700, "2026-09-30T22:30:00Z", "2026-09-30T22:30:00Z");
    const sales = await getSalesReport({ from: "2026-09-01", to: "2026-10-31" });
    expect(sales.monthlyRevenue).toEqual([{ month: "2026-10", revenue: 700, count: 1 }]);
  });

  it("⚠️⚠️ a period is bounded on the workspace's clock: 00:30 on 1 October in Rome is not September", async () => {
    await deal("mezzanotte", "won", 700, "2026-09-30T22:30:00Z", "2026-09-30T22:30:00Z");
    await deal("primo", "won", 300, "2026-08-31T22:30:00Z", "2026-08-31T22:30:00Z");
    const sales = await getSalesReport(september);
    // 00:30 on 1 September in Rome is in; 00:30 on 1 October is out.
    expect(sales.dealsWon).toEqual({ count: 1, revenue: 300 });
  });

  it("periodOf gives the first and last instant of the days in the zone", () => {
    const p = periodOf("2026-09-01", "2026-09-30", "Europe/Rome");
    expect(p.from?.toISOString()).toBe("2026-08-31T22:00:00.000Z");
    expect(p.to?.toISOString()).toBe("2026-09-30T21:59:59.999Z");
    // Across the change of hour: 25 October is 25 hours long.
    expect(periodOf("2026-10-25", "2026-10-25", "Europe/Rome").to?.toISOString()).toBe("2026-10-25T22:59:59.999Z");
  });
});

describe("⚠️⚠️ win rate", () => {
  it("is won out of decided, over deals closed in the same period", async () => {
    await deal("w", "won", 1, "2026-09-12T10:00:00Z", "2026-09-12T10:00:00Z");
    await deal("l1", "lost", 1, "2026-09-13T10:00:00Z", "2026-09-13T10:00:00Z");
    await deal("l2", "lost", 1, "2026-09-14T10:00:00Z", "2026-09-14T10:00:00Z");
    // Created in the period, still open: not part of the rate.
    await deal("o", "open", 1, null, "2026-09-14T10:00:00Z");

    expect((await getReportKPIs(september)).dealWinRate).toBe(33);
  });

  it("is unknown, not zero, when nothing closed", async () => {
    expect((await getReportKPIs(september)).dealWinRate).toBeNull();
  });
});

describe("⚠️⚠️ money in other currencies", () => {
  it("converts a quote at its own rate, and leaves out an order whose rate nobody knows", async () => {
    await deal("dq", "open", 0, null, "2026-09-01T10:00:00Z");
    await db.execute(
      sql`insert into quote (id, quote_number, deal_id, company_id, status, subtotal, tax_amount, total_amount, currency, eur_rate, accepted_at) values ('q1', 'P-1', 'dq', 'co', 'accepted', '1000', '0', '1000', 'USD', '0.9', '2026-09-10T10:00:00Z')`,
    );
    await db.execute(
      sql`insert into "order" (id, order_number, company_id, quote_id, status, total_amount, currency, order_date) values ('o1', 'ORD-1', 'co', 'q1', 'completed', '1000', 'USD', '2026-09-11T10:00:00Z'), ('o2', 'ORD-2', 'co', null, 'completed', '500', 'GBP', '2026-09-11T10:00:00Z')`,
    );

    const sales = await getSalesReport(september);
    expect(sales.quotesAccepted.revenue).toBe(900);
    expect(sales.ordersCompleted).toEqual({ count: 2, revenue: 900, unconverted: 1 });
  });
});

describe("⚠️ open tickets", () => {
  it("include the ones that have just arrived", () => {
    expect(isTicketOpen("new")).toBe(true);
    expect(isTicketOpen("on_hold")).toBe(true);
    expect(isTicketOpen("resolved")).toBe(false);
    expect(isTicketOpen("closed")).toBe(false);
  });
});

describe("⚠️ weighted pipeline", () => {
  it("uses the stage's probability when the deal has none of its own", async () => {
    await deal("aperta", "open", 1000, null, "2026-09-12T10:00:00Z");
    // The form allows "no probability"; the column's default of 0 is a probability.
    await db.execute(sql`update deal set probability = null where id = 'aperta'`);
    const finance = await getFinanceDashboard();
    expect(finance.pipelineValueRaw).toBe(1000);
    expect(finance.pipelineValue).toBe(400);
  });
});

describe("⚠️ the figures narrowed to one person", () => {
  it("the sales tab shows that person's sales, not everybody's under their name", async () => {
    await deal("mine", "won", 300, "2026-09-12T10:00:00Z", "2026-09-12T10:00:00Z");
    await deal("theirs", "won", 900, "2026-09-12T10:00:00Z", "2026-09-12T10:00:00Z");
    await db.execute(
      sql`insert into "user" (id, name, email) values ('anna', 'Anna', 'anna@x.it') on conflict do nothing`,
    );
    await db.execute(sql`update deal set owner_id = 'anna' where id = 'mine'`);
    const sales = await getSalesReport({ ...september, userId: "anna" });
    expect(sales.dealsWon).toEqual({ count: 1, revenue: 300 });
    expect(sales.monthlyRevenue).toEqual([{ month: "2026-09", revenue: 300, count: 1 }]);
  });
});

describe("⚠️ the deal distribution on the home page", () => {
  it("is the open pipeline: no won or lost column, and no closed deal in an open stage", async () => {
    await db.execute(
      sql`insert into pipeline_stage (id, name, "order", is_lost) values ('lost', 'Persa', 10, true) on conflict do nothing`,
    );
    await db.execute(sql`update pipeline_stage set is_won = true where id = 'won'`);
    await deal("o1", "open", 1, null, "2026-09-12T10:00:00Z");
    await deal("w1", "won", 1, "2026-09-12T10:00:00Z", "2026-09-12T10:00:00Z");
    // Won while sitting in an open stage (an import, an old record): not open pipeline.
    await db.execute(sql`insert into deal (id, name, amount, status, stage_id) values ('w2', 'w2', '1', 'won', 's1')`);
    const { dealDistribution } = await getDashboardStats();
    expect(dealDistribution.map((d) => [d.name, d.value])).toEqual([["Proposta", 1]]);
  });
});
