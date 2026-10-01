"use server";

import { and, count, desc, eq, gte, isNotNull, lte, ne, sql } from "drizzle-orm";

import { getPipelineMembers } from "@/actions/pipeline-members";
import { activities, deals, leads, orders, quotes, tasks, tickets, users } from "@/db/schema";
import { requireCapability } from "@/lib/auth-guard";
import { currentPeriodKey, parsePeriodKey, periodKey } from "@/lib/calendar-period";
import { closedBetween, dealEur, orderEur, periodOf, quoteEur, ticketIsOpen, winRatePercent } from "@/lib/metrics";
import { recordScope, visibleWhere } from "@/lib/record-visibility";
import { repScorecard } from "@/lib/rep-scorecard";
import { getDb } from "@/lib/tenant-context";
import { monthStart as workspaceMonthStart } from "@/lib/workspace-day";
import { getWorkspaceTimeZone } from "@/lib/workspace-time-zone";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReportFilters {
  userId?: string;
  from?: string; // ISO date string
  to?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * When an activity happened: the date it was logged for, or when it was written down.
 *
 * ⚠️⚠️ The activity figures on this page read `user_activity_log`, which nothing in the
 * product has ever written — two tabs and the export said, to every manager, that the team
 * had done nothing. They read the calls, meetings, emails and notes people log instead:
 * the question a sales manager asks first, answered from where the answer is.
 */
const activityDay = sql`coalesce(${activities.date}, ${activities.createdAt})`;

type Period = ReturnType<typeof periodOf>;

function dateRange(period: Period) {
  const conditions = [];
  if (period.from) conditions.push(gte(activityDay, period.from));
  if (period.to) conditions.push(lte(activityDay, period.to));
  return conditions;
}

function taskDateRange(period: Period) {
  const conditions = [];
  if (period.from) conditions.push(gte(tasks.createdAt, period.from));
  if (period.to) conditions.push(lte(tasks.createdAt, period.to));
  return conditions;
}

// ─── KPI Overview ─────────────────────────────────────────────────────────────

export async function getReportKPIs(filters: ReportFilters = {}) {
  await requireCapability("report:read");
  const db = await getDb();
  const { from, to, userId } = filters;
  const timeZone = await getWorkspaceTimeZone();
  const period = periodOf(from, to, timeZone);
  // Every figure counts only what the person may see (src/lib/record-visibility.ts); tickets
  // stay whole, support being a shared queue.
  const scope = await recordScope();

  const actConditions = [
    ...dateRange(period),
    ...(userId ? [eq(activities.ownerId, userId)] : []),
    visibleWhere("activity", scope),
  ];

  // Calls, meetings, emails and notes logged in the period
  const [activityCount] = await db
    .select({ count: count() })
    .from(activities)
    .where(actConditions.length ? and(...actConditions) : undefined);

  // Tasks completed in period
  const taskConditions = [
    eq(tasks.status, "done"),
    isNotNull(tasks.completedAt),
    ...(from ? [gte(tasks.completedAt!, period.from as Date)] : []),
    ...(to ? [lte(tasks.completedAt!, period.to as Date)] : []),
    ...(userId ? [eq(tasks.assigneeId, userId)] : []),
    visibleWhere("task", scope),
  ];
  const [tasksCompleted] = await db
    .select({ count: count() })
    .from(tasks)
    .where(and(...taskConditions));

  // Tasks total (to compute completion rate)
  const taskTotalConditions = [
    ...taskDateRange(period),
    ...(userId ? [eq(tasks.assigneeId, userId)] : []),
    visibleWhere("task", scope),
  ];
  const [tasksTotal] = await db
    .select({ count: count() })
    .from(tasks)
    .where(taskTotalConditions.length ? and(...taskTotalConditions) : undefined);

  // Deals created in period
  const dealConditions = [
    ...(from ? [gte(deals.createdAt, period.from as Date)] : []),
    ...(to ? [lte(deals.createdAt, period.to as Date)] : []),
    ...(userId ? [eq(deals.ownerId, userId)] : []),
    visibleWhere("deal", scope),
  ];
  const [dealsCreated] = await db
    .select({ count: count() })
    .from(deals)
    .where(dealConditions.length ? and(...dealConditions) : undefined);

  // Deals won and lost in the period, dated by when they closed (src/lib/metrics.ts).
  const mine = [...(userId ? [eq(deals.ownerId, userId)] : []), visibleWhere("deal", scope)];
  const [[dealsWon], [dealsLost]] = await Promise.all([
    db
      .select({ count: count() })
      .from(deals)
      .where(and(closedBetween("won", period.from, period.to), ...mine)),
    db
      .select({ count: count() })
      .from(deals)
      .where(and(closedBetween("lost", period.from, period.to), ...mine)),
  ]);

  // Leads created in period
  const leadConditions = [
    ...(from ? [gte(leads.createdAt, period.from as Date)] : []),
    ...(to ? [lte(leads.createdAt, period.to as Date)] : []),
    ...(userId ? [eq(leads.ownerId, userId)] : []),
    visibleWhere("lead", scope),
  ];
  const [leadsCreated] = await db
    .select({ count: count() })
    .from(leads)
    .where(leadConditions.length ? and(...leadConditions) : undefined);

  // Quotes sent in period
  const quoteConditions = [
    ...(from ? [gte(quotes.createdAt, period.from as Date)] : []),
    ...(to ? [lte(quotes.createdAt, period.to as Date)] : []),
    ...(userId ? [eq(quotes.ownerId, userId)] : []),
    visibleWhere("quote", scope),
  ];
  const [quotesCreated] = await db
    .select({ count: count() })
    .from(quotes)
    .where(quoteConditions.length ? and(...quoteConditions) : undefined);

  // Open tickets
  const ticketConditions = [
    ticketIsOpen(),
    ...(from ? [gte(tickets.createdAt, period.from as Date)] : []),
    ...(to ? [lte(tickets.createdAt, period.to as Date)] : []),
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
    dealsLost: Number(dealsLost.count),
    // Won ÷ decided, null when nothing was decided — see winRatePercent.
    dealWinRate: winRatePercent(Number(dealsWon.count), Number(dealsLost.count)),
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
  const timeZone = await getWorkspaceTimeZone();
  const period = periodOf(from, to, timeZone);

  const conditions = [...dateRange(period), visibleWhere("activity", await recordScope())];

  const rows = await db
    .select({
      userId: activities.ownerId,
      userName: users.name,
      userEmail: users.email,
      count: count(),
    })
    .from(activities)
    .leftJoin(users, eq(activities.ownerId, users.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .groupBy(activities.ownerId, users.name, users.email)
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
  const timeZone = await getWorkspaceTimeZone();
  const period = periodOf(from, to, timeZone);

  const conditions = [
    ...dateRange(period),
    ...(userId ? [eq(activities.ownerId, userId)] : []),
    visibleWhere("activity", await recordScope()),
  ];

  // By type: call, meeting, email, note.
  const rows = await db
    .select({ action: activities.type, count: count() })
    .from(activities)
    .where(conditions.length ? and(...conditions) : undefined)
    .groupBy(activities.type)
    .orderBy(desc(count()));

  return rows.map((r) => ({ action: r.action, count: Number(r.count) }));
}

// ─── Daily activity trend (last N days) ──────────────────────────────────────

export async function getDailyActivityTrend(filters: ReportFilters = {}) {
  await requireCapability("report:read");
  const db = await getDb();
  const { from, to, userId } = filters;
  const timeZone = await getWorkspaceTimeZone();
  const period = periodOf(from, to, timeZone);

  const conditions = [
    ...dateRange(period),
    ...(userId ? [eq(activities.ownerId, userId)] : []),
    visibleWhere("activity", await recordScope()),
  ];

  const rows = await db
    .select({
      // The day on the workspace's clock: DATE() of an instant is the database session's day (UTC).
      day: sql<string>`(${activityDay} at time zone 'UTC' at time zone ${timeZone})::date::text`,
      count: count(),
    })
    .from(activities)
    .where(conditions.length ? and(...conditions) : undefined)
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  return rows.map((r) => ({ day: r.day, count: Number(r.count) }));
}

// ─── Tasks performance per user ───────────────────────────────────────────────

export async function getTaskPerformanceByUser(filters: ReportFilters = {}) {
  await requireCapability("report:read");
  const db = await getDb();
  const { from, to, userId } = filters;
  const timeZone = await getWorkspaceTimeZone();
  const period = periodOf(from, to, timeZone);
  const mine = [...(userId ? [eq(tasks.assigneeId, userId)] : []), visibleWhere("task", await recordScope())];

  // ⚠️ Three grouped statements, not three per person: on a Worker every statement is a
  // subrequest, and a team of forty made this tab alone cost a hundred and twenty.
  const [allUsers, totals, completed, overdue] = await Promise.all([
    db.select({ id: users.id, name: users.name, email: users.email }).from(users),
    db
      .select({ userId: tasks.assigneeId, n: count() })
      .from(tasks)
      .where(and(isNotNull(tasks.assigneeId), ...taskDateRange(period), ...mine))
      .groupBy(tasks.assigneeId),
    db
      .select({ userId: tasks.assigneeId, n: count() })
      .from(tasks)
      .where(
        and(
          isNotNull(tasks.assigneeId),
          eq(tasks.status, "done"),
          isNotNull(tasks.completedAt),
          ...(from ? [gte(tasks.completedAt, period.from as Date)] : []),
          ...(to ? [lte(tasks.completedAt, period.to as Date)] : []),
          ...mine,
        ),
      )
      .groupBy(tasks.assigneeId),
    // Overdue is anything not done, as everywhere else — not only "todo".
    db
      .select({ userId: tasks.assigneeId, n: count() })
      .from(tasks)
      .where(and(isNotNull(tasks.assigneeId), ne(tasks.status, "done"), lte(tasks.dueDate, new Date()), ...mine))
      .groupBy(tasks.assigneeId),
  ]);

  const tally = (rows: { userId: string | null; n: number }[]) =>
    new Map(rows.map((r) => [r.userId as string, Number(r.n)]));
  const [t, c, o] = [tally(totals), tally(completed), tally(overdue)];
  return allUsers
    .map((u: { id: string; name: string | null; email: string | null }) => {
      const total = t.get(u.id) ?? 0;
      const done = c.get(u.id) ?? 0;
      return {
        userId: u.id,
        userName: u.name ?? u.email ?? "Unknown",
        tasksTotal: total,
        tasksCompleted: done,
        tasksOverdue: o.get(u.id) ?? 0,
        completionRate: total > 0 ? Math.round((done / total) * 100) : 0,
      };
    })
    .filter((r: { tasksTotal: number }) => r.tasksTotal > 0)
    .sort((a: { completionRate: number }, b: { completionRate: number }) => b.completionRate - a.completionRate);
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
  const { from, to, userId } = filters;
  const timeZone = await getWorkspaceTimeZone();
  const period = periodOf(from, to, timeZone);
  // ⚠️ The person chosen above the tabs: this tab used to ignore them and show everyone's
  // sales under one person's name.
  const scope = await recordScope();
  const mineDeals = [...(userId ? [eq(deals.ownerId, userId)] : []), visibleWhere("deal", scope)];

  const quoteConditions = [
    ...(userId ? [eq(quotes.ownerId, userId)] : []),
    visibleWhere("quote", scope),
    eq(quotes.status, "accepted"),
    ...(period.from ? [gte(quotes.acceptedAt, period.from)] : []),
    ...(period.to ? [lte(quotes.acceptedAt, period.to)] : []),
  ];

  const orderConditions = [
    ...(userId ? [eq(orders.ownerId, userId)] : []),
    visibleWhere("order", scope),
    eq(orders.status, "completed"),
    ...(period.from ? [gte(orders.orderDate, period.from)] : []),
    ...(period.to ? [lte(orders.orderDate, period.to)] : []),
  ];

  // All in EUR (src/lib/metrics.ts). An order in another currency with no quote behind it
  // has no known rate: it is counted, and said, never added in as if it were euros.
  const [[dealsWon], [quotesAccepted], [ordersCompleted]] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int`, revenue: sql<number>`coalesce(sum(${dealEur}), 0)` })
      .from(deals)
      .where(and(closedBetween("won", period.from, period.to), ...mineDeals)),
    db
      .select({ count: sql<number>`count(*)::int`, revenue: sql<number>`coalesce(sum(${quoteEur}), 0)` })
      .from(quotes)
      .where(and(...quoteConditions)),
    db
      .select({
        count: sql<number>`count(*)::int`,
        revenue: sql<number>`coalesce(sum(${orderEur}), 0)`,
        unconverted: sql<number>`count(*) filter (where ${orderEur} is null)::int`,
      })
      .from(orders)
      .where(and(...orderConditions)),
  ]);

  // Won value by the month it closed (last 12 months, or the filtered range).
  // By the workspace's month: the column holds UTC.
  // ⚠️ Grouped and ordered by position (`1`): the zone travels as a parameter, and Postgres
  // reads the same expression with a second parameter as a different one.
  const closedMonth = sql<string>`to_char(${deals.closedAt} at time zone 'UTC' at time zone ${timeZone}, 'YYYY-MM')`;
  const monthlyRows = await db
    .select({
      month: closedMonth,
      revenue: sql<number>`coalesce(sum(${dealEur}), 0)`,
      count: sql<number>`count(*)::int`,
    })
    .from(deals)
    .where(
      and(closedBetween("won", period.from ?? workspaceMonthStart(new Date(), timeZone, -11), period.to), ...mineDeals),
    )
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  return {
    dealsWon: { count: Number(dealsWon.count), revenue: Number(dealsWon.revenue) },
    quotesAccepted: { count: Number(quotesAccepted.count), revenue: Number(quotesAccepted.revenue) },
    ordersCompleted: {
      count: Number(ordersCompleted.count),
      revenue: Number(ordersCompleted.revenue),
      unconverted: Number(ordersCompleted.unconverted),
    },
    // ⚠️ The value won, not won deals plus completed orders: turning a quote into an order
    // marks its deal won, so adding the two counted the same sale twice.
    totalRevenue: Number(dealsWon.revenue),
    monthlyRevenue: monthlyRows.map((r) => ({ month: r.month, revenue: Number(r.revenue), count: Number(r.count) })),
  };
}

// ─── Scorecard per salesperson ────────────────────────────────────────────────

/**
 * One row per salesperson for a month, quarter or year (src/lib/rep-scorecard.ts). The
 * period is a target's key; anything else, or nothing, is this month on the workspace's
 * clock.
 */
export async function getRepScorecard(input: { period?: string | null; owners?: string[] } = {}) {
  await requireCapability("report:read");
  const [db, timeZone, members, scope] = await Promise.all([
    getDb(),
    getWorkspaceTimeZone(),
    getPipelineMembers(),
    recordScope(),
  ]);
  const parsed = parsePeriodKey(input.period);
  const period = parsed ? periodKey(parsed) : currentPeriodKey("month", new Date(), timeZone);
  return repScorecard(db, { period, timeZone, members, owners: input.owners, scope });
}
