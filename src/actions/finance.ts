"use server";

import { and, eq, gte, lte, sql } from "drizzle-orm";

import { deals, orders, pipelineStages } from "@/db/schema";
import { requireAdminAccess, requirePlanModule } from "@/lib/auth-guard";
import { type CashStats, cashStats } from "@/lib/cash-stats";
import { closedBetween, dealEur, orderEur } from "@/lib/metrics";
import { getDb } from "@/lib/tenant-context";
import { toWallDate } from "@/lib/wall-clock";
import { monthStart as workspaceMonthStart } from "@/lib/workspace-day";
import { getWorkspaceTimeZone } from "@/lib/workspace-time-zone";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FinanceDashboardData {
  // KPI cards
  totalRevenue: number; // value won, all time, by closedAt
  totalRevenueLastMonth: number;
  pipelineValue: number; // open deals weighted by probability (the stage's when the deal has none)
  pipelineValueRaw: number; // open deals sum
  monthlyRevenue: number; // value won this month
  monthlyRevenueLastMonth: number; // last month
  // Orders completed this month, in EUR; those in a currency with no known rate are counted
  // in `unconverted` and left out of the sum.
  ordersThisMonth: { revenue: number; count: number; unconverted: number };

  // Revenue trend (last 12 months)
  revenueTrend: { month: string; deals: number; orders: number }[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Months on the workspace's clock — the server's is UTC on Workers (src/lib/workspace-day.ts).
function monthStart(timeZone: string, offset = 0): Date {
  return workspaceMonthStart(new Date(), timeZone, offset);
}

function monthEnd(timeZone: string, offset = 0): Date {
  return new Date(workspaceMonthStart(new Date(), timeZone, offset + 1).getTime() - 1);
}

// ─── Main function ─────────────────────────────────────────────────────────────

/**
 * ⚠️⚠️ Every figure here is defined in src/lib/metrics.ts. This page used to date wins by
 * `updatedAt` (re-saving an old deal moved it into this month), add completed orders to won
 * deals (a quote turned into an order marks its deal won — the same sale twice, and three
 * times in the "revenue sources" bar), and weight open deals with a probability of 0 when
 * the deal had none of its own, while the pipeline report used the stage's.
 *
 * ⚠️ No win rate and no pipeline by stage (§11.1): both are the Pipeline section's, and a
 * second copy here is a second place for them to disagree. This page is about money that
 * has come in or is booked; rebuilding it on invoices waits for payments to be recorded
 * (I9), without which "invoiced" cannot say what was collected.
 */
export async function getFinanceDashboard(): Promise<FinanceDashboardData> {
  await requireAdminAccess();
  const db = await getDb();

  const timeZone = await getWorkspaceTimeZone();
  const thisMonthStart = monthStart(timeZone, 0);
  const thisMonthEnd = monthEnd(timeZone, 0);
  const lastMonthStart = monthStart(timeZone, -1);
  const lastMonthEnd = monthEnd(timeZone, -1);
  const twelveMonthsAgo = monthStart(timeZone, -11);

  const wonValue = (from?: Date, to?: Date) =>
    db
      .select({ revenue: sql<number>`coalesce(sum(${dealEur}), 0)` })
      .from(deals)
      .where(closedBetween("won", from, to));
  const [[allTime], [lastMonth], [thisMonth], [ordersNow]] = await Promise.all([
    wonValue(),
    wonValue(lastMonthStart, lastMonthEnd),
    wonValue(thisMonthStart, thisMonthEnd),
    db
      .select({
        revenue: sql<number>`coalesce(sum(${orderEur}), 0)`,
        count: sql<number>`count(*)::int`,
        unconverted: sql<number>`count(*) filter (where ${orderEur} is null)::int`,
      })
      .from(orders)
      .where(
        and(eq(orders.status, "completed"), gte(orders.orderDate, thisMonthStart), lte(orders.orderDate, thisMonthEnd)),
      ),
  ]);

  // ── Open pipeline, weighted the way the pipeline report weights it ─────────
  const probability = sql<number>`coalesce(${deals.probability}, ${pipelineStages.defaultProbability}, 0)`;
  const [open] = await db
    .select({
      value: sql<number>`coalesce(sum(${dealEur}), 0)`,
      weighted: sql<number>`coalesce(sum(${dealEur} * ${probability} / 100), 0)`,
    })
    .from(deals)
    .innerJoin(pipelineStages, eq(deals.stageId, pipelineStages.id))
    .where(eq(deals.status, "open"));

  const pipelineValueRaw = Number(open.value);
  const pipelineValue = Number(open.weighted);

  // ── Trend: won value by the month it closed, orders by their date — side by side ──
  // Grouped by the workspace's month: the columns hold UTC.
  // ⚠️ Grouped and ordered by position (`1`): the zone travels as a parameter, and Postgres
  // reads the same expression with a second parameter as a different one.
  const closedMonth = sql<string>`to_char(${deals.closedAt} at time zone 'UTC' at time zone ${timeZone}, 'YYYY-MM')`;
  const orderMonth = sql<string>`to_char(${orders.orderDate} at time zone 'UTC' at time zone ${timeZone}, 'YYYY-MM')`;
  const [dealsTrend, ordersTrend] = await Promise.all([
    db
      .select({ month: closedMonth, revenue: sql<number>`coalesce(sum(${dealEur}), 0)` })
      .from(deals)
      .where(closedBetween("won", twelveMonthsAgo))
      .groupBy(sql`1`)
      .orderBy(sql`1`),
    db
      .select({ month: orderMonth, revenue: sql<number>`coalesce(sum(${orderEur}), 0)` })
      .from(orders)
      .where(and(eq(orders.status, "completed"), gte(orders.orderDate, twelveMonthsAgo)))
      .groupBy(sql`1`)
      .orderBy(sql`1`),
  ]);

  const months: string[] = [];
  for (let i = 11; i >= 0; i--) months.push(toWallDate(monthStart(timeZone, -i), timeZone).slice(0, 7));
  const dealsMap = Object.fromEntries(dealsTrend.map((r) => [r.month, Number(r.revenue)]));
  const ordersMap = Object.fromEntries(ordersTrend.map((r) => [r.month, Number(r.revenue)]));
  const revenueTrend = months.map((month) => ({
    month,
    deals: dealsMap[month] ?? 0,
    orders: ordersMap[month] ?? 0,
  }));

  return {
    totalRevenue: Number(allTime.revenue),
    totalRevenueLastMonth: Number(lastMonth.revenue),
    pipelineValue,
    pipelineValueRaw,
    monthlyRevenue: Number(thisMonth.revenue),
    monthlyRevenueLastMonth: Number(lastMonth.revenue),
    ordersThisMonth: {
      revenue: Number(ordersNow.revenue),
      count: Number(ordersNow.count),
      unconverted: Number(ordersNow.unconverted),
    },
    revenueTrend,
  };
}

/**
 * The cash side (I14): what came in, what was invoiced, DSO, the collection rate, deposits to
 * invoice and customers' credit — each defined in src/lib/cash-stats.ts, where the page's
 * definitions are written too.
 */
export async function getCashStats(): Promise<CashStats> {
  await requireAdminAccess();
  await requirePlanModule("sales");
  const [db, timeZone] = await Promise.all([getDb(), getWorkspaceTimeZone()]);
  return cashStats(db, { today: toWallDate(new Date(), timeZone), timeZone });
}
