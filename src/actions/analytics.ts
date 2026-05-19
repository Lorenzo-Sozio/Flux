"use server";

import { and, count, eq, gte, isNotNull, ne, sql } from "drizzle-orm";

import { contacts, deals, leads, quotes } from "@/db/schema";
import { getDb } from "@/lib/tenant-context";

export async function getFunnelData(periodDays = 90) {
  const db = await getDb();
  const since = new Date(Date.now() - periodDays * 86_400_000);

  const [[leadsRow], [convertedRow], [contactsRow], [dealsRow], [quotesRow], [wonRow]] = await Promise.all([
    db.select({ n: count() }).from(leads).where(gte(leads.createdAt, since)),
    db
      .select({ n: count() })
      .from(leads)
      .where(and(gte(leads.createdAt, since), eq(leads.isConverted, true))),
    db
      .select({ n: count() })
      .from(contacts)
      .where(and(gte(contacts.createdAt, since), isNotNull(contacts.sourceLeadId))),
    db.select({ n: count() }).from(deals).where(gte(deals.createdAt, since)),
    db
      .select({ n: count() })
      .from(quotes)
      .where(and(gte(quotes.createdAt, since), ne(quotes.status, "draft"))),
    db
      .select({ n: count() })
      .from(deals)
      .where(and(gte(deals.createdAt, since), eq(deals.status, "won"))),
  ]);

  // Avg days from lead creation → conversion
  const [convTimeRow] = await db
    .select({
      avgDays: sql<number>`AVG(EXTRACT(EPOCH FROM (${leads.convertedAt} - ${leads.createdAt})) / 86400)`.as("avg_days"),
    })
    .from(leads)
    .where(and(eq(leads.isConverted, true), isNotNull(leads.convertedAt), gte(leads.createdAt, since)));

  // Avg days from deal creation → won (updated_at is refreshed on every stage change)
  const [dealCycleRow] = await db
    .select({
      avgDays: sql<number>`AVG(EXTRACT(EPOCH FROM (${deals.updatedAt} - ${deals.createdAt})) / 86400)`.as("avg_days"),
    })
    .from(deals)
    .where(and(eq(deals.status, "won"), gte(deals.createdAt, since)));

  // Lead source breakdown
  const sourceRows = await db
    .select({ source: leads.source, n: count() })
    .from(leads)
    .where(gte(leads.createdAt, since))
    .groupBy(leads.source);

  const totalLeads = leadsRow.n;
  const totalConverted = convertedRow.n;
  const totalContacts = contactsRow.n;
  const totalDeals = dealsRow.n;
  const totalQuotesSent = quotesRow.n;
  const totalWon = wonRow.n;

  function rate(num: number, den: number) {
    return den > 0 ? Number(((num / den) * 100).toFixed(1)) : 0;
  }

  const stages = [
    { label: "Leads", count: totalLeads, fill: "#6366f1" },
    { label: "Converted Leads", count: totalConverted, fill: "#8b5cf6" },
    { label: "Contacts (from leads)", count: totalContacts, fill: "#3b82f6" },
    { label: "Deals", count: totalDeals, fill: "#0891b2" },
    { label: "Quotes Sent", count: totalQuotesSent, fill: "#f59e0b" },
    { label: "Won", count: totalWon, fill: "#22c55e" },
  ];

  const conversionRates = [
    { from: "Lead", to: "Converted", rate: rate(totalConverted, totalLeads) },
    { from: "Converted", to: "Contact", rate: rate(totalContacts, totalConverted) },
    { from: "Contact", to: "Deal", rate: rate(totalDeals, totalContacts) },
    { from: "Deal", to: "Quote Sent", rate: rate(totalQuotesSent, totalDeals) },
    { from: "Quote", to: "Won", rate: rate(totalWon, totalQuotesSent) },
  ];

  return {
    stages,
    conversionRates,
    avgLeadConversionDays: Math.round(Number(convTimeRow?.avgDays ?? 0)),
    avgDealCycleDays: Math.round(Number(dealCycleRow?.avgDays ?? 0)),
    sourceBreakdown: sourceRows
      .map((r) => ({ source: r.source ?? "Unknown", count: r.n }))
      .sort((a, b) => b.count - a.count),
    periodDays,
    totals: { totalLeads, totalConverted, totalContacts, totalDeals, totalQuotesSent, totalWon },
  };
}
