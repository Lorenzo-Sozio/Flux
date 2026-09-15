"use server";

import { and, desc, eq, gte, lt, sql } from "drizzle-orm";

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
import { requireCapability } from "@/lib/auth-guard";
import { getDb } from "@/lib/tenant-context";

/**
 * The figures on the first screen after login.
 *
 * ⚠️ This used to be nineteen round trips for a workspace with six pipeline
 * stages, **one after another**: twelve counts awaited in sequence, then the
 * stages, then one more count per stage. On the Neon HTTP driver every statement
 * is its own request, so the page waited for the sum of all of them — on the one
 * screen everybody opens every morning.
 *
 * Seven statements now, all started together, so the wait is the slowest one
 * rather than the total. Each table is read once, with `FILTER` doing what used
 * to take a separate query per condition, and the stage distribution is one
 * `GROUP BY` instead of a count per stage.
 *
 * ⚠️ The return shape is unchanged, field for field. Two details are kept on
 * purpose because the dashboard cards depend on them: a stage with no deals still
 * appears with a zero, which is why that query starts from the stages and joins
 * the deals rather than the other way round; and it counts deals in every status,
 * as it always did.
 */
export async function getDashboardStats() {
  await requireCapability("record:read");
  const db = await getDb();

  // Local midnight to local midnight, as before.
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  const [[leadCounts], [dealValue], [taskCounts], [quoteFigures], [ticketCounts], distribution, sources] =
    await Promise.all([
      db
        .select({
          total: sql<number>`count(*)`,
          active: sql<number>`count(*) filter (where ${leads.status} in ('new', 'contacting'))`,
          converted: sql<number>`count(*) filter (where ${leads.status} = 'converted')`,
        })
        .from(leads),

      db
        .select({ total: sql<number>`coalesce(sum(cast(${deals.amount} as numeric)), 0)` })
        .from(deals)
        .where(eq(deals.status, "open")),

      db
        .select({
          // The comparisons go through drizzle's typed operators rather than a raw
          // `${today}`, so the Date is converted exactly as the column maps it —
          // which is what the separate queries these replace did.
          overdue: sql<number>`count(*) filter (where ${lt(tasks.dueDate, today)})`,
          dueToday: sql<number>`count(*) filter (where ${and(gte(tasks.dueDate, today), lt(tasks.dueDate, tomorrow))})`,
        })
        .from(tasks)
        .where(eq(tasks.status, "todo")),

      db
        .select({
          pipelineValue: sql<number>`coalesce(sum(cast(${quotes.totalAmount} as numeric)) filter (where ${quotes.status} in ('sent', 'viewed')), 0)`,
          openCount: sql<number>`count(*) filter (where ${quotes.status} in ('draft', 'sent', 'viewed'))`,
        })
        .from(quotes),

      db
        .select({
          open: sql<number>`count(*) filter (where ${tickets.status} in ('open', 'in_progress', 'waiting'))`,
          urgent: sql<number>`count(*) filter (where ${tickets.status} in ('open', 'in_progress', 'waiting') and ${tickets.priority} = 'urgent')`,
        })
        .from(tickets),

      // From the stages, so a stage nobody has a deal in still gets its zero.
      db
        .select({
          name: pipelineStages.name,
          color: pipelineStages.color,
          value: sql<number>`count(${deals.id})`,
        })
        .from(pipelineStages)
        .leftJoin(deals, eq(deals.stageId, pipelineStages.id))
        .groupBy(pipelineStages.id, pipelineStages.name, pipelineStages.color, pipelineStages.order)
        .orderBy(pipelineStages.order),

      db.select({ source: leads.source, count: sql<number>`count(*)` }).from(leads).groupBy(leads.source),
    ]);

  const totalLeads = Number(leadCounts?.total ?? 0);
  const convertedLeads = Number(leadCounts?.converted ?? 0);
  const conversionRate = totalLeads > 0 ? (convertedLeads / totalLeads) * 100 : 0;

  return {
    totalDealValue: Number(dealValue?.total ?? 0),
    activeLeadsCount: Number(leadCounts?.active ?? 0),
    conversionRate: conversionRate.toFixed(1),
    overdueTasks: Number(taskCounts?.overdue ?? 0),
    todayTasks: Number(taskCounts?.dueToday ?? 0),
    dealDistribution: distribution.map((stage) => ({
      name: stage.name,
      value: Number(stage.value),
      color: stage.color || "#3b82f6",
    })),
    leadsBySource: sources.map((r) => ({ name: r.source || "Other", value: Number(r.count) })),
    quotesPipelineValue: Number(quoteFigures?.pipelineValue ?? 0),
    quotesOpenCount: Number(quoteFigures?.openCount ?? 0),
    openTicketsCount: Number(ticketCounts?.open ?? 0),
    urgentTicketsCount: Number(ticketCounts?.urgent ?? 0),
  };
}

export async function getTopDeals(limit = 5) {
  await requireCapability("record:read");
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
  await requireCapability("record:read");
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
