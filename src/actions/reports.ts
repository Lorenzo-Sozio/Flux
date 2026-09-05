"use server";

import { and, count, desc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";

import {
  campaignLogs,
  deals,
  leads,
  marketingCampaigns,
  orders,
  pipelineStages,
  quotes,
  tasks,
  tickets,
  userActivityLogs,
  users,
} from "@/db/schema";
import { requireCapability } from "@/lib/auth-guard";
import { getDb } from "@/lib/tenant-context";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReportFilters {
  userId?: string;
  from?: string; // ISO date string
  to?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dateRange(from?: string, to?: string) {
  const conditions = [];
  if (from) conditions.push(gte(userActivityLogs.createdAt, new Date(from)));
  if (to) {
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);
    conditions.push(lte(userActivityLogs.createdAt, toDate));
  }
  return conditions;
}

function taskDateRange(from?: string, to?: string) {
  const conditions = [];
  if (from) conditions.push(gte(tasks.createdAt, new Date(from)));
  if (to) {
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);
    conditions.push(lte(tasks.createdAt, toDate));
  }
  return conditions;
}

// ─── KPI Overview ─────────────────────────────────────────────────────────────

export async function getReportKPIs(filters: ReportFilters = {}) {
  await requireCapability("report:read");
  const db = await getDb();
  const { from, to, userId } = filters;

  const actConditions = [...dateRange(from, to), ...(userId ? [eq(userActivityLogs.userId, userId)] : [])];

  // Total logged actions in period
  const [activityCount] = await db
    .select({ count: count() })
    .from(userActivityLogs)
    .where(actConditions.length ? and(...actConditions) : undefined);

  // Tasks completed in period
  const taskConditions = [
    eq(tasks.status, "done"),
    isNotNull(tasks.completedAt),
    ...(from ? [gte(tasks.completedAt!, new Date(from))] : []),
    ...(to ? [lte(tasks.completedAt!, new Date(`${to}T23:59:59`))] : []),
    ...(userId ? [eq(tasks.assigneeId, userId)] : []),
  ];
  const [tasksCompleted] = await db
    .select({ count: count() })
    .from(tasks)
    .where(and(...taskConditions));

  // Tasks total (to compute completion rate)
  const taskTotalConditions = [...taskDateRange(from, to), ...(userId ? [eq(tasks.assigneeId, userId)] : [])];
  const [tasksTotal] = await db
    .select({ count: count() })
    .from(tasks)
    .where(taskTotalConditions.length ? and(...taskTotalConditions) : undefined);

  // Deals created in period
  const dealConditions = [
    ...(from ? [gte(deals.createdAt, new Date(from))] : []),
    ...(to ? [lte(deals.createdAt, new Date(`${to}T23:59:59`))] : []),
    ...(userId ? [eq(deals.ownerId, userId)] : []),
  ];
  const [dealsCreated] = await db
    .select({ count: count() })
    .from(deals)
    .where(dealConditions.length ? and(...dealConditions) : undefined);

  // Deals won in period
  const dealsWonConditions = [
    eq(deals.status, "won"),
    ...(from ? [gte(deals.updatedAt, new Date(from))] : []),
    ...(to ? [lte(deals.updatedAt, new Date(`${to}T23:59:59`))] : []),
    ...(userId ? [eq(deals.ownerId, userId)] : []),
  ];
  const [dealsWon] = await db
    .select({ count: count() })
    .from(deals)
    .where(and(...dealsWonConditions));

  // Leads created in period
  const leadConditions = [
    ...(from ? [gte(leads.createdAt, new Date(from))] : []),
    ...(to ? [lte(leads.createdAt, new Date(`${to}T23:59:59`))] : []),
    ...(userId ? [eq(leads.ownerId, userId)] : []),
  ];
  const [leadsCreated] = await db
    .select({ count: count() })
    .from(leads)
    .where(leadConditions.length ? and(...leadConditions) : undefined);

  // Quotes sent in period
  const quoteConditions = [
    ...(from ? [gte(quotes.createdAt, new Date(from))] : []),
    ...(to ? [lte(quotes.createdAt, new Date(`${to}T23:59:59`))] : []),
    ...(userId ? [eq(quotes.ownerId, userId)] : []),
  ];
  const [quotesCreated] = await db
    .select({ count: count() })
    .from(quotes)
    .where(quoteConditions.length ? and(...quoteConditions) : undefined);

  // Open tickets
  const ticketConditions = [
    sql`${tickets.status} IN ('open','in_progress','waiting')`,
    ...(from ? [gte(tickets.createdAt, new Date(from))] : []),
    ...(to ? [lte(tickets.createdAt, new Date(`${to}T23:59:59`))] : []),
    ...(userId ? [eq(tickets.ownerId, userId)] : []),
  ];
  const [openTickets] = await db
    .select({ count: count() })
    .from(tickets)
    .where(and(...ticketConditions));

  const totalTasks = Number(tasksTotal.count);
  const completedTasks = Number(tasksCompleted.count);

  return {
    activityCount: Number(activityCount.count),
    tasksCompleted: completedTasks,
    tasksTotal: totalTasks,
    taskCompletionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
    dealsCreated: Number(dealsCreated.count),
    dealsWon: Number(dealsWon.count),
    dealWinRate:
      Number(dealsCreated.count) > 0 ? Math.round((Number(dealsWon.count) / Number(dealsCreated.count)) * 100) : 0,
    leadsCreated: Number(leadsCreated.count),
    quotesCreated: Number(quotesCreated.count),
    openTickets: Number(openTickets.count),
  };
}

// ─── Activity by user (leaderboard) ──────────────────────────────────────────

export async function getActivityByUser(filters: ReportFilters = {}) {
  await requireCapability("report:read");
  const db = await getDb();
  const { from, to } = filters;

  const conditions = dateRange(from, to);

  const rows = await db
    .select({
      userId: userActivityLogs.userId,
      userName: users.name,
      userEmail: users.email,
      count: count(),
    })
    .from(userActivityLogs)
    .leftJoin(users, eq(userActivityLogs.userId, users.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .groupBy(userActivityLogs.userId, users.name, users.email)
    .orderBy(desc(count()));

  return rows.map((r) => ({
    userId: r.userId ?? "system",
    userName: r.userName ?? r.userEmail ?? "Unknown",
    userEmail: r.userEmail ?? "",
    count: Number(r.count),
  }));
}

// ─── Activity by action type ──────────────────────────────────────────────────

export async function getActivityByAction(filters: ReportFilters = {}) {
  await requireCapability("report:read");
  const db = await getDb();
  const { from, to, userId } = filters;

  const conditions = [...dateRange(from, to), ...(userId ? [eq(userActivityLogs.userId, userId)] : [])];

  const rows = await db
    .select({ action: userActivityLogs.action, count: count() })
    .from(userActivityLogs)
    .where(conditions.length ? and(...conditions) : undefined)
    .groupBy(userActivityLogs.action)
    .orderBy(desc(count()));

  return rows.map((r) => ({ action: r.action, count: Number(r.count) }));
}

// ─── Daily activity trend (last N days) ──────────────────────────────────────

export async function getDailyActivityTrend(filters: ReportFilters = {}) {
  await requireCapability("report:read");
  const db = await getDb();
  const { from, to, userId } = filters;

  const conditions = [...dateRange(from, to), ...(userId ? [eq(userActivityLogs.userId, userId)] : [])];

  const rows = await db
    .select({
      day: sql<string>`DATE(${userActivityLogs.createdAt})`,
      count: count(),
    })
    .from(userActivityLogs)
    .where(conditions.length ? and(...conditions) : undefined)
    .groupBy(sql`DATE(${userActivityLogs.createdAt})`)
    .orderBy(sql`DATE(${userActivityLogs.createdAt})`);

  return rows.map((r) => ({ day: r.day, count: Number(r.count) }));
}

// ─── Tasks performance per user ───────────────────────────────────────────────

export async function getTaskPerformanceByUser(filters: ReportFilters = {}) {
  await requireCapability("report:read");
  const db = await getDb();
  const { from, to, userId } = filters;

  const allUsers = await db.select({ id: users.id, name: users.name, email: users.email }).from(users);

  const results = await Promise.all(
    allUsers.map(async (u) => {
      if (userId && u.id !== userId) return null;

      const baseConditions = [eq(tasks.assigneeId, u.id), ...taskDateRange(from, to)];

      const [total] = await db
        .select({ count: count() })
        .from(tasks)
        .where(and(...baseConditions));

      const completedConditions = [
        eq(tasks.assigneeId, u.id),
        eq(tasks.status, "done"),
        isNotNull(tasks.completedAt),
        ...(from ? [gte(tasks.completedAt!, new Date(from))] : []),
        ...(to ? [lte(tasks.completedAt!, new Date(`${to}T23:59:59`))] : []),
      ];

      const [completed] = await db
        .select({ count: count() })
        .from(tasks)
        .where(and(...completedConditions));

      const overdue = await db
        .select({ count: count() })
        .from(tasks)
        .where(and(eq(tasks.assigneeId, u.id), eq(tasks.status, "todo"), lte(tasks.dueDate!, new Date())));

      const t = Number(total.count);
      const c = Number(completed.count);
      return {
        userId: u.id,
        userName: u.name ?? u.email ?? "Unknown",
        tasksTotal: t,
        tasksCompleted: c,
        tasksOverdue: Number(overdue[0].count),
        completionRate: t > 0 ? Math.round((c / t) * 100) : 0,
      };
    }),
  );

  // Narrowed by a type predicate rather than by `filter(Boolean)` and a cast: the
  // cast told the compiler the nulls were gone while the optional chaining right
  // after it said they were not, and one of the two had to be wrong.
  type Row = NonNullable<(typeof results)[number]>;
  return results
    .filter((r): r is Row => r !== null && r !== undefined)
    .filter((r) => r.tasksTotal > 0)
    .sort((a, b) => b.completionRate - a.completionRate);
}

// ─── Recent activity log (paginated) ─────────────────────────────────────────

export async function getRecentActivityLog(filters: ReportFilters & { limit?: number } = {}) {
  await requireCapability("report:read");
  const db = await getDb();
  const { from, to, userId, limit = 100 } = filters;

  const conditions = [...dateRange(from, to), ...(userId ? [eq(userActivityLogs.userId, userId)] : [])];

  const rows = await db
    .select({
      id: userActivityLogs.id,
      action: userActivityLogs.action,
      entityType: userActivityLogs.entityType,
      entityId: userActivityLogs.entityId,
      metadata: userActivityLogs.metadata,
      ipAddress: userActivityLogs.ipAddress,
      createdAt: userActivityLogs.createdAt,
      userName: users.name,
      userEmail: users.email,
    })
    .from(userActivityLogs)
    .leftJoin(users, eq(userActivityLogs.userId, users.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(userActivityLogs.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    ...r,
    userName: r.userName ?? r.userEmail ?? "System",
    userEmail: r.userEmail ?? "",
  }));
}

// ─── All users (for filter dropdown) ─────────────────────────────────────────

export async function getReportUsers() {
  await requireCapability("report:read");
  const db = await getDb();
  return db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(users)
    .orderBy(users.name);
}

// ─── Sales report ────────────────────────────────────────────────────────────

export async function getSalesReport(filters: ReportFilters = {}) {
  await requireCapability("report:read");
  const db = await getDb();
  const { from, to } = filters;

  const dealConditions = [
    eq(deals.status, "won"),
    ...(from ? [gte(deals.updatedAt, new Date(from))] : []),
    ...(to ? [lte(deals.updatedAt, new Date(`${to}T23:59:59`))] : []),
  ];

  const quoteConditions = [
    eq(quotes.status, "accepted"),
    ...(from ? [gte(quotes.updatedAt, new Date(from))] : []),
    ...(to ? [lte(quotes.updatedAt, new Date(`${to}T23:59:59`))] : []),
  ];

  const orderConditions = [
    eq(orders.status, "completed"),
    ...(from ? [gte(orders.orderDate, new Date(from))] : []),
    ...(to ? [lte(orders.orderDate, new Date(`${to}T23:59:59`))] : []),
  ];

  // Aggregate totals
  const [[dealsWon], [quotesAccepted], [ordersCompleted]] = await Promise.all([
    db
      .select({
        count: sql<number>`count(*)::int`,
        revenue: sql<number>`coalesce(sum(cast(${deals.amount} as numeric)), 0)`,
      })
      .from(deals)
      .where(and(...dealConditions)),

    db
      .select({
        count: sql<number>`count(*)::int`,
        revenue: sql<number>`coalesce(sum(cast(${quotes.totalAmount} as numeric)), 0)`,
      })
      .from(quotes)
      .where(and(...quoteConditions)),

    db
      .select({
        count: sql<number>`count(*)::int`,
        revenue: sql<number>`coalesce(sum(cast(${orders.totalAmount} as numeric)), 0)`,
      })
      .from(orders)
      .where(and(...orderConditions)),
  ]);

  // Revenue by pipeline stage (won deals)
  const stages = await db.select().from(pipelineStages).orderBy(pipelineStages.order);
  const revenueByStage = await Promise.all(
    stages.map(async (stage) => {
      const [row] = await db
        .select({
          revenue: sql<number>`coalesce(sum(cast(${deals.amount} as numeric)), 0)`,
          count: sql<number>`count(*)::int`,
        })
        .from(deals)
        .where(
          and(
            eq(deals.stageId, stage.id),
            eq(deals.status, "won"),
            ...(from ? [gte(deals.updatedAt, new Date(from))] : []),
            ...(to ? [lte(deals.updatedAt, new Date(`${to}T23:59:59`))] : []),
          ),
        );
      return {
        name: stage.name,
        color: stage.color ?? "#3b82f6",
        revenue: Number(row?.revenue ?? 0),
        count: Number(row?.count ?? 0),
      };
    }),
  );

  // Monthly revenue from won deals (last 12 months or filtered range)
  const monthlyRows = await db
    .select({
      month: sql<string>`to_char(${deals.updatedAt}, 'YYYY-MM')`,
      revenue: sql<number>`coalesce(sum(cast(${deals.amount} as numeric)), 0)`,
      count: sql<number>`count(*)::int`,
    })
    .from(deals)
    .where(
      and(
        eq(deals.status, "won"),
        ...(from
          ? [gte(deals.updatedAt, new Date(from))]
          : [gte(deals.updatedAt, new Date(new Date().getFullYear(), new Date().getMonth() - 11, 1))]),
        ...(to ? [lte(deals.updatedAt, new Date(`${to}T23:59:59`))] : []),
      ),
    )
    .groupBy(sql`to_char(${deals.updatedAt}, 'YYYY-MM')`)
    .orderBy(sql`to_char(${deals.updatedAt}, 'YYYY-MM')`);

  const monthlyRevenue = monthlyRows.map((r) => ({
    month: r.month,
    revenue: Number(r.revenue),
    count: Number(r.count),
  }));

  return {
    dealsWon: { count: Number(dealsWon.count), revenue: Number(dealsWon.revenue) },
    quotesAccepted: { count: Number(quotesAccepted.count), revenue: Number(quotesAccepted.revenue) },
    ordersCompleted: { count: Number(ordersCompleted.count), revenue: Number(ordersCompleted.revenue) },
    totalRevenue: Number(dealsWon.revenue) + Number(ordersCompleted.revenue),
    revenueByStage: revenueByStage.filter((s) => s.count > 0),
    monthlyRevenue,
  };
}

// ─── Campaign performance summary ─────────────────────────────────────────────

export async function getCampaignPerformanceSummary(filters: ReportFilters = {}) {
  await requireCapability("report:read");
  const db = await getDb();
  const { from, to } = filters;

  const campaigns = await db
    .select()
    .from(marketingCampaigns)
    .where(
      from || to
        ? and(
            ...[
              ...(from ? [gte(marketingCampaigns.createdAt, new Date(from))] : []),
              ...(to ? [lte(marketingCampaigns.createdAt, new Date(`${to}T23:59:59`))] : []),
            ],
          )
        : undefined,
    );

  const allLogs = await db.select().from(campaignLogs);

  return campaigns.map((c) => {
    const logs = allLogs.filter((l) => l.campaignId === c.id);
    const sent = logs.filter((l) => !["failed", "queued"].includes(l.status)).length;
    const opened = logs.filter((l) => ["opened", "clicked"].includes(l.status)).length;
    const clicked = logs.filter((l) => l.status === "clicked").length;
    return {
      id: c.id,
      name: c.name,
      status: c.status,
      total: logs.length,
      sent,
      opened,
      clicked,
      openRate: sent > 0 ? ((opened / sent) * 100).toFixed(1) : "0",
      clickRate: sent > 0 ? ((clicked / sent) * 100).toFixed(1) : "0",
    };
  });
}
