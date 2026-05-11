"use server";

import { and, desc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";

import { getDb } from "@/lib/tenant-context";
import {
  activities,
  companies,
  contacts,
  deals,
  leads,
  pipelineStages,
  quotes,
  tasks,
  tickets,
  users,
} from "@/db/schema";

export async function getDashboardStats() {
  const db = await getDb();
  // 1. Total Deal Value
  const dealValueResult = await db
    .select({ total: sql<number>`sum(CAST(${deals.amount} AS NUMERIC))` })
    .from(deals)
    .where(eq(deals.status, "open"));
  const totalDealValue = Number(dealValueResult[0]?.total || 0);

  // 2. Active Leads Count
  const activeLeadsResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(leads)
    .where(sql`${leads.status} IN ('new', 'contacting')`);
  const activeLeadsCount = Number(activeLeadsResult[0]?.count || 0);

  // 3. Conversion Rate
  const totalLeadsResult = await db.select({ count: sql<number>`count(*)` }).from(leads);
  const convertedLeadsResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(leads)
    .where(eq(leads.status, "converted"));

  const totalLeads = Number(totalLeadsResult[0]?.count || 0);
  const convertedLeads = Number(convertedLeadsResult[0]?.count || 0);
  const conversionRate = totalLeads > 0 ? (convertedLeads / totalLeads) * 100 : 0;

  // 4. Tasks Summary
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  const overdueTasksResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(tasks)
    .where(and(lt(tasks.dueDate, today), eq(tasks.status, "todo")));

  const todayTasksResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(tasks)
    .where(and(gte(tasks.dueDate, today), lt(tasks.dueDate, tomorrow), eq(tasks.status, "todo")));

  const overdueTasks = Number(overdueTasksResult[0]?.count || 0);
  const todayTasks = Number(todayTasksResult[0]?.count || 0);

  // 5. Deal Distribution by Stage
  const stages = await db.select().from(pipelineStages).orderBy(pipelineStages.order);
  const dealDistribution = await Promise.all(
    stages.map(async (stage) => {
      const countResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(deals)
        .where(eq(deals.stageId, stage.id));
      return {
        name: stage.name,
        value: Number(countResult[0]?.count || 0),
        color: stage.color || "#3b82f6",
      };
    }),
  );

  // 6. Leads by Source
  const sourcesResult = await db
    .select({
      source: leads.source,
      count: sql<number>`count(*)`,
    })
    .from(leads)
    .groupBy(leads.source);

  const leadsBySource = sourcesResult.map((r) => ({
    name: r.source || "Other",
    value: Number(r.count),
  }));

  // 7. Quotes pipeline: total value of quotes awaiting response (sent + viewed)
  const quotesPipelineResult = await db
    .select({ total: sql<number>`coalesce(sum(CAST(${quotes.totalAmount} AS NUMERIC)), 0)` })
    .from(quotes)
    .where(sql`${quotes.status} IN ('sent', 'viewed')`);
  const quotesPipelineValue = Number(quotesPipelineResult[0]?.total || 0);

  const quotesOpenCountResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(quotes)
    .where(sql`${quotes.status} IN ('draft', 'sent', 'viewed')`);
  const quotesOpenCount = Number(quotesOpenCountResult[0]?.count || 0);

  // 8. Support tickets: open count + urgent count
  const openTicketsResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(tickets)
    .where(sql`${tickets.status} IN ('open', 'in_progress', 'waiting')`);
  const openTicketsCount = Number(openTicketsResult[0]?.count || 0);

  const urgentTicketsResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(tickets)
    .where(and(sql`${tickets.status} IN ('open', 'in_progress', 'waiting')`, eq(tickets.priority, "urgent")));
  const urgentTicketsCount = Number(urgentTicketsResult[0]?.count || 0);

  return {
    totalDealValue,
    activeLeadsCount,
    conversionRate: conversionRate.toFixed(1),
    overdueTasks,
    todayTasks,
    dealDistribution,
    leadsBySource,
    quotesPipelineValue,
    quotesOpenCount,
    openTicketsCount,
    urgentTicketsCount,
  };
}

export async function getTopDeals(limit = 5) {
  const db = await getDb();
  const rows = await db
    .select({
      id: deals.id,
      name: deals.name,
      amount: deals.amount,
      currency: deals.currency,
      probability: deals.probability,
      status: deals.status,
      expectedCloseDate: deals.expectedCloseDate,
      stageName: pipelineStages.name,
      stageColor: pipelineStages.color,
      companyName: companies.name,
    })
    .from(deals)
    .leftJoin(pipelineStages, eq(deals.stageId, pipelineStages.id))
    .leftJoin(companies, eq(deals.companyId, companies.id))
    .where(eq(deals.status, "open"))
    .orderBy(desc(sql`CAST(${deals.amount} AS NUMERIC)`))
    .limit(limit);

  return rows.map((r) => ({
    ...r,
    amount: Number(r.amount ?? 0),
  }));
}

export async function getRecentActivities(limit = 10) {
  const db = await getDb();
  const rows = await db
    .select({
      id: activities.id,
      type: activities.type,
      content: activities.content,
      date: activities.date,
      createdAt: activities.createdAt,
      ownerName: users.name,
      leadId: activities.leadId,
      contactId: activities.contactId,
      companyId: activities.companyId,
      dealId: activities.dealId,
      contactFirstName: contacts.firstName,
      contactLastName: contacts.lastName,
      companyName: companies.name,
    })
    .from(activities)
    .leftJoin(users, eq(activities.ownerId, users.id))
    .leftJoin(contacts, eq(activities.contactId, contacts.id))
    .leftJoin(companies, eq(activities.companyId, companies.id))
    .orderBy(desc(activities.createdAt))
    .limit(limit);

  return rows;
}
