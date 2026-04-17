"use server";

import { and, eq, gte, lte, sql } from "drizzle-orm";

import { db } from "@/db";
import { deals, orders, pipelineStages, quotes } from "@/db/schema";
import { requireAdminAccess } from "@/lib/auth-guard";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FinanceDashboardData {
  // KPI cards
  totalRevenue: number; // deals won + orders completed (all time)
  totalRevenueLastMonth: number;
  pipelineValue: number; // open deals weighted by probability
  pipelineValueRaw: number; // open deals sum
  monthlyRevenue: number; // this month (deals won + orders)
  monthlyRevenueLastMonth: number; // last month
  winRate: number; // deals won / (won + lost) — last 90 days
  dealsWon: number;
  dealsLost: number;

  // Revenue trend (last 12 months)
  revenueTrend: { month: string; deals: number; orders: number }[];

  // Revenue sources breakdown
  revenueBreakdown: {
    dealsRevenue: number;
    quotesRevenue: number;
    ordersRevenue: number;
  };

  // Pipeline stage distribution
  pipelineByStage: { name: string; color: string; value: number; count: number }[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function monthStart(offset = 0): Date {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  d.setMonth(d.getMonth() + offset);
  return d;
}

function monthEnd(offset = 0): Date {
  const d = new Date();
  d.setDate(1);
  d.setHours(23, 59, 59, 999);
  d.setMonth(d.getMonth() + offset + 1);
  d.setDate(0); // last day of previous month
  return d;
}

// ─── Main function ─────────────────────────────────────────────────────────────

export async function getFinanceDashboard(): Promise<FinanceDashboardData> {
  await requireAdminAccess();

  const thisMonthStart = monthStart(0);
  const thisMonthEnd = monthEnd(0);
  const lastMonthStart = monthStart(-1);
  const lastMonthEnd = monthEnd(-1);
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const twelveMonthsAgo = monthStart(-11);

  // ── Total Revenue (all time) ─────────────────────────────────────────────
  const [[dealsAllTime], [ordersAllTime]] = await Promise.all([
    db
      .select({ revenue: sql<number>`coalesce(sum(cast(${deals.amount} as numeric)), 0)` })
      .from(deals)
      .where(eq(deals.status, "won")),
    db
      .select({ revenue: sql<number>`coalesce(sum(cast(${orders.totalAmount} as numeric)), 0)` })
      .from(orders)
      .where(eq(orders.status, "completed")),
  ]);
  const totalRevenue = Number(dealsAllTime.revenue) + Number(ordersAllTime.revenue);

  // ── Total Revenue last month (for comparison) ────────────────────────────
  const [[dealsLastMonth], [ordersLastMonth]] = await Promise.all([
    db
      .select({ revenue: sql<number>`coalesce(sum(cast(${deals.amount} as numeric)), 0)` })
      .from(deals)
      .where(and(eq(deals.status, "won"), gte(deals.updatedAt, lastMonthStart), lte(deals.updatedAt, lastMonthEnd))),
    db
      .select({ revenue: sql<number>`coalesce(sum(cast(${orders.totalAmount} as numeric)), 0)` })
      .from(orders)
      .where(
        and(eq(orders.status, "completed"), gte(orders.orderDate, lastMonthStart), lte(orders.orderDate, lastMonthEnd)),
      ),
  ]);
  const totalRevenueLastMonth = Number(dealsLastMonth.revenue) + Number(ordersLastMonth.revenue);

  // ── Pipeline Value (weighted + raw) ─────────────────────────────────────
  const openDeals = await db
    .select({
      amount: deals.amount,
      probability: deals.probability,
    })
    .from(deals)
    .where(eq(deals.status, "open"));

  let pipelineValue = 0;
  let pipelineValueRaw = 0;
  for (const d of openDeals) {
    const amt = Number(d.amount ?? 0);
    const prob = Number(d.probability ?? 0);
    pipelineValueRaw += amt;
    pipelineValue += (amt * prob) / 100;
  }

  // ── Monthly Revenue (this month) ─────────────────────────────────────────
  const [[dealsThisMonth], [ordersThisMonth]] = await Promise.all([
    db
      .select({ revenue: sql<number>`coalesce(sum(cast(${deals.amount} as numeric)), 0)` })
      .from(deals)
      .where(
        and(eq(deals.status, "won"), gte(deals.updatedAt, thisMonthStart), lte(deals.updatedAt, thisMonthEnd)),
      ),
    db
      .select({ revenue: sql<number>`coalesce(sum(cast(${orders.totalAmount} as numeric)), 0)` })
      .from(orders)
      .where(
        and(
          eq(orders.status, "completed"),
          gte(orders.orderDate, thisMonthStart),
          lte(orders.orderDate, thisMonthEnd),
        ),
      ),
  ]);
  const monthlyRevenue = Number(dealsThisMonth.revenue) + Number(ordersThisMonth.revenue);
  const monthlyRevenueLastMonth = Number(dealsLastMonth.revenue) + Number(ordersLastMonth.revenue);

  // ── Win Rate (last 90 days) ───────────────────────────────────────────────
  const [wonResult, lostResult] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(deals)
      .where(and(eq(deals.status, "won"), gte(deals.updatedAt, ninetyDaysAgo))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(deals)
      .where(and(eq(deals.status, "lost"), gte(deals.updatedAt, ninetyDaysAgo))),
  ]);
  const dealsWon = Number(wonResult[0].count);
  const dealsLost = Number(lostResult[0].count);
  const winRate = dealsWon + dealsLost > 0 ? Math.round((dealsWon / (dealsWon + dealsLost)) * 100) : 0;

  // ── Revenue Trend (last 12 months) ───────────────────────────────────────
  const [dealsTrend, ordersTrend] = await Promise.all([
    db
      .select({
        month: sql<string>`to_char(${deals.updatedAt}, 'YYYY-MM')`,
        revenue: sql<number>`coalesce(sum(cast(${deals.amount} as numeric)), 0)`,
      })
      .from(deals)
      .where(and(eq(deals.status, "won"), gte(deals.updatedAt, twelveMonthsAgo)))
      .groupBy(sql`to_char(${deals.updatedAt}, 'YYYY-MM')`)
      .orderBy(sql`to_char(${deals.updatedAt}, 'YYYY-MM')`),

    db
      .select({
        month: sql<string>`to_char(${orders.orderDate}, 'YYYY-MM')`,
        revenue: sql<number>`coalesce(sum(cast(${orders.totalAmount} as numeric)), 0)`,
      })
      .from(orders)
      .where(and(eq(orders.status, "completed"), gte(orders.orderDate, twelveMonthsAgo)))
      .groupBy(sql`to_char(${orders.orderDate}, 'YYYY-MM')`)
      .orderBy(sql`to_char(${orders.orderDate}, 'YYYY-MM')`),
  ]);

  // Merge into 12-month grid
  const monthSet = new Set<string>();
  for (const r of [...dealsTrend, ...ordersTrend]) monthSet.add(r.month);

  // Ensure all 12 months are present even if 0
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthSet.add(key);
  }

  const dealsMap = Object.fromEntries(dealsTrend.map((r) => [r.month, Number(r.revenue)]));
  const ordersMap = Object.fromEntries(ordersTrend.map((r) => [r.month, Number(r.revenue)]));

  const revenueTrend = Array.from(monthSet)
    .sort()
    .slice(-12)
    .map((month) => ({
      month,
      deals: dealsMap[month] ?? 0,
      orders: ordersMap[month] ?? 0,
    }));

  // ── Revenue Breakdown (all time) ─────────────────────────────────────────
  const [quotesAccepted] = await db
    .select({ revenue: sql<number>`coalesce(sum(cast(${quotes.totalAmount} as numeric)), 0)` })
    .from(quotes)
    .where(eq(quotes.status, "accepted"));

  const revenueBreakdown = {
    dealsRevenue: Number(dealsAllTime.revenue),
    quotesRevenue: Number(quotesAccepted.revenue),
    ordersRevenue: Number(ordersAllTime.revenue),
  };

  // ── Pipeline by Stage ─────────────────────────────────────────────────────
  const stages = await db.select().from(pipelineStages).orderBy(pipelineStages.order);
  const pipelineByStage = await Promise.all(
    stages.map(async (stage) => {
      const [row] = await db
        .select({
          value: sql<number>`coalesce(sum(cast(${deals.amount} as numeric)), 0)`,
          count: sql<number>`count(*)::int`,
        })
        .from(deals)
        .where(and(eq(deals.stageId, stage.id), eq(deals.status, "open")));
      return {
        name: stage.name,
        color: stage.color ?? "#3b82f6",
        value: Number(row?.value ?? 0),
        count: Number(row?.count ?? 0),
      };
    }),
  );

  return {
    totalRevenue,
    totalRevenueLastMonth,
    pipelineValue,
    pipelineValueRaw,
    monthlyRevenue,
    monthlyRevenueLastMonth,
    winRate,
    dealsWon,
    dealsLost,
    revenueTrend,
    revenueBreakdown,
    pipelineByStage: pipelineByStage.filter((s) => s.count > 0),
  };
}
