"use server";

import { and, count, eq, gte, isNotNull, ne, sql } from "drizzle-orm";

import { contacts, deals, leads, quotes } from "@/db/schema";
import { requireCapability } from "@/lib/auth-guard";
import { ownerCondition } from "@/lib/pipeline-filters";
import { sourceLabeller } from "@/lib/record-sources-load";
import { recordScope, visibleWhere } from "@/lib/record-visibility";
import { tolerateUnmigrated } from "@/lib/schema-ready";
import { getDb } from "@/lib/tenant-context";

type FunnelStageKey = "leads" | "converted" | "contacts" | "deals" | "quotesSent" | "won";

/**
 * Leads to won deals over a period, optionally for some agents.
 *
 * Each stage is filtered on its own record's owner (the lead's, the contact's,
 * the deal's, the quote's) because that is who did that step. Stage labels are
 * keys (`analytics.funnel.stages.*`), translated where they are drawn.
 */
export async function getFunnelData(periodDays = 90, owners: string[] = []) {
  await requireCapability("report:read");
  const db = await getDb();
  const since = new Date(Date.now() - periodDays * 86_400_000);
  // Each stage counts only what the person may see (src/lib/record-visibility.ts).
  const scope = await recordScope();
  const byLead = and(ownerCondition(leads.ownerId, owners), visibleWhere("lead", scope));
  const byDeal = and(ownerCondition(deals.ownerId, owners), visibleWhere("deal", scope));

  const [[leadsRow], [convertedRow], [contactsRow], [dealsRow], [quotesRow], [wonRow]] = await Promise.all([
    db
      .select({ n: count() })
      .from(leads)
      .where(and(gte(leads.createdAt, since), byLead)),
    db
      .select({ n: count() })
      .from(leads)
      .where(and(gte(leads.createdAt, since), eq(leads.isConverted, true), byLead)),
    db
      .select({ n: count() })
      .from(contacts)
      .where(
        and(
          gte(contacts.createdAt, since),
          isNotNull(contacts.sourceLeadId),
          ownerCondition(contacts.ownerId, owners),
          visibleWhere("contact", scope),
        ),
      ),
    db
      .select({ n: count() })
      .from(deals)
      .where(and(gte(deals.createdAt, since), byDeal)),
    db
      .select({ n: count() })
      .from(quotes)
      .where(
        and(
          gte(quotes.createdAt, since),
          ne(quotes.status, "draft"),
          ownerCondition(quotes.ownerId, owners),
          visibleWhere("quote", scope),
        ),
      ),
    db
      .select({ n: count() })
      .from(deals)
      .where(and(gte(deals.createdAt, since), eq(deals.status, "won"), byDeal)),
  ]);

  // Avg days from lead creation → conversion
  const [convTimeRow] = await db
    .select({
      avgDays: sql<number>`AVG(EXTRACT(EPOCH FROM (${leads.convertedAt} - ${leads.createdAt})) / 86400)`.as("avg_days"),
    })
    .from(leads)
    .where(and(eq(leads.isConverted, true), isNotNull(leads.convertedAt), gte(leads.createdAt, since), byLead));

  // Avg days from deal creation to the day it was won. `closedAt`, not `updatedAt`: the
  // latter moves on every edit, so any note added to an old won deal lengthened its cycle.
  const [dealCycleRow] = await db
    .select({
      avgDays: sql<number>`AVG(EXTRACT(EPOCH FROM (${deals.closedAt} - ${deals.createdAt})) / 86400)`.as("avg_days"),
    })
    .from(deals)
    .where(and(eq(deals.status, "won"), isNotNull(deals.closedAt), gte(deals.createdAt, since), byDeal));

  // Lead source breakdown
  const sourceRows = await db
    .select({ source: leads.source, n: count() })
    .from(leads)
    .where(and(gte(leads.createdAt, since), byLead))
    .groupBy(leads.source);

  // What was sold, by where the customer came from: the deal carries its lead's source
  // (migration 0073). Amounts are the deal's stored EUR figure, as on the scorecard.
  const wonSourceRows = await tolerateUnmigrated(
    "deal source (0073)",
    () =>
      db
        .select({ source: deals.source, n: count(), value: sql<string>`coalesce(sum(${deals.amount}), 0)` })
        .from(deals)
        .where(and(gte(deals.createdAt, since), eq(deals.status, "won"), byDeal))
        .groupBy(deals.source),
    [] as { source: string | null; n: number; value: string }[],
  );
  const label = await sourceLabeller(db);

  const totalLeads = leadsRow.n;
  const totalConverted = convertedRow.n;
  const totalContacts = contactsRow.n;
  const totalDeals = dealsRow.n;
  const totalQuotesSent = quotesRow.n;
  const totalWon = wonRow.n;

  function rate(num: number, den: number) {
    return den > 0 ? Number(((num / den) * 100).toFixed(1)) : 0;
  }

  const stages: { key: FunnelStageKey; count: number; fill: string }[] = [
    { key: "leads", count: totalLeads, fill: "#6366f1" },
    { key: "converted", count: totalConverted, fill: "#8b5cf6" },
    { key: "contacts", count: totalContacts, fill: "#3b82f6" },
    { key: "deals", count: totalDeals, fill: "#0891b2" },
    { key: "quotesSent", count: totalQuotesSent, fill: "#f59e0b" },
    { key: "won", count: totalWon, fill: "#22c55e" },
  ];

  const conversionRates: { from: FunnelStageKey; to: FunnelStageKey; rate: number }[] = [
    { from: "leads", to: "converted", rate: rate(totalConverted, totalLeads) },
    { from: "converted", to: "contacts", rate: rate(totalContacts, totalConverted) },
    { from: "contacts", to: "deals", rate: rate(totalDeals, totalContacts) },
    { from: "deals", to: "quotesSent", rate: rate(totalQuotesSent, totalDeals) },
    { from: "quotesSent", to: "won", rate: rate(totalWon, totalQuotesSent) },
  ];

  return {
    stages,
    conversionRates,
    avgLeadConversionDays: Math.round(Number(convTimeRow?.avgDays ?? 0)),
    avgDealCycleDays: Math.round(Number(dealCycleRow?.avgDays ?? 0)),
    sourceBreakdown: sourceRows
      .map((r) => ({ source: r.source, label: label(r.source), count: r.n }))
      .sort((a, b) => b.count - a.count),
    wonBySource: wonSourceRows
      .map((r) => ({ source: r.source, label: label(r.source), count: Number(r.n), value: Number(r.value) }))
      .sort((a, b) => b.value - a.value || b.count - a.count),
    periodDays,
    totals: { totalLeads, totalConverted, totalContacts, totalDeals, totalQuotesSent, totalWon },
  };
}
