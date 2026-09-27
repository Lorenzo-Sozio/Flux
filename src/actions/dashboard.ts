"use server";

import { and, desc, eq, gte, lt, ne, sql } from "drizzle-orm";

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
import { quoteEur, ticketIsOpen } from "@/lib/metrics";
import { getDb } from "@/lib/tenant-context";
import { dayBounds } from "@/lib/workspace-day";
import { getWorkspaceTimeZone } from "@/lib/workspace-time-zone";

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
 * the deals rather than the other way round.
 *
 * ⚠️ The distribution is of the **open** deals, over the stages a deal can be open in. It
 * counted every status, so every deal ever won stood in the "Won" column and every loss in
 * "Lost": the largest bars on the chart said nothing about the pipeline (§11.1).
 */
export async function getDashboardStats() {
  await requireCapability("record:read");
  const db = await getDb();

  // The workspace's midnight to midnight — not the server's, which is UTC on Workers.
  const { start: today, end: tomorrow } = dayBounds(new Date(), await getWorkspaceTimeZone());

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
        // Everything not done: a task somebody has started is still pending, and counting
        // only `todo` left it out of both figures the moment work began.
        .where(ne(tasks.status, "done")),

      db
        .select({
          // In EUR at each quote's own rate: quotes in different currencies used to be added
          // together as they stood.
          pipelineValue: sql<number>`coalesce(sum(${quoteEur}) filter (where ${quotes.status} in ('sent', 'viewed')), 0)`,
          // The same quotes the value adds up: those with the customer. Drafts were counted and
          // not summed, so the number and the amount on one card described different lists.
          openCount: sql<number>`count(*) filter (where ${quotes.status} in ('sent', 'viewed'))`,
        })
        .from(quotes),

      db
        .select({
          // Every ticket not finished — `new` included, which is how every ticket arrives.
          open: sql<number>`count(*) filter (where ${ticketIsOpen()})`,
          urgent: sql<number>`count(*) filter (where ${ticketIsOpen()} and ${tickets.priority} = 'urgent')`,
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
        .leftJoin(deals, and(eq(deals.stageId, pipelineStages.id), eq(deals.status, "open")))
        .where(and(eq(pipelineStages.isWon, false), eq(pipelineStages.isLost, false)))
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
