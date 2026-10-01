import { and, eq, sql } from "drizzle-orm";

import { companies, contacts, deals, leads } from "@/db/schema";
import { ownerCondition } from "@/lib/pipeline-filters";
import { type RecordScope, SEE_ALL, visibleWhere } from "@/lib/record-visibility";

/**
 * The two statements behind the territory report.
 *
 * Both group by distinct address, so each returns one row per place however many
 * records share it; src/lib/territory-report.ts maps those places to territories.
 * Built separately from the action so a test can read the SQL they generate.
 *
 * ⚠️ Periods are on the date the thing happened — `created_at` for a new lead,
 * `converted_at` for a conversion, `closed_at` for a won or lost deal — never on
 * `updated_at`, which moves whenever somebody re-saves an old record and would put
 * last year's win into this month.
 *
 * `scope` is the reader's (src/lib/record-visibility.ts): a salesperson's map counts only the
 * leads and deals they may see.
 */

// biome-ignore lint/suspicious/noExplicitAny: the tenant db handle is built per request
type AnyDb = any;

export function leadsByPlace(db: AnyDb, since: Date, owners: readonly string[] = [], scope: RecordScope = SEE_ALL) {
  const from = since.toISOString();
  return db
    .select({
      country: leads.country,
      state: leads.state,
      zipCode: leads.zipCode,
      openLeads: sql<string>`count(*) filter (where ${leads.isConverted} = false and ${leads.status} <> 'unqualified')`,
      newLeads: sql<string>`count(*) filter (where ${leads.createdAt} >= ${from})`,
      convertedLeads: sql<string>`count(*) filter (where ${leads.isConverted} = true and ${leads.convertedAt} >= ${from})`,
    })
    .from(leads)
    .where(and(ownerCondition(leads.ownerId, owners), visibleWhere("lead", scope)))
    .groupBy(leads.country, leads.state, leads.zipCode);
}

export function dealsByPlace(db: AnyDb, since: Date, owners: readonly string[] = [], scope: RecordScope = SEE_ALL) {
  const from = since.toISOString();
  return db
    .select({
      companyCountry: companies.country,
      companyState: companies.state,
      companyZip: companies.zipCode,
      contactCountry: contacts.country,
      contactState: contacts.state,
      contactZip: contacts.zipCode,
      openDeals: sql<string>`count(*) filter (where ${deals.status} = 'open')`,
      openValue: sql<string>`coalesce(sum(${deals.amount}) filter (where ${deals.status} = 'open'), 0)`,
      wonDeals: sql<string>`count(*) filter (where ${deals.status} = 'won' and ${deals.closedAt} >= ${from})`,
      wonValue: sql<string>`coalesce(sum(${deals.amount}) filter (where ${deals.status} = 'won' and ${deals.closedAt} >= ${from}), 0)`,
      lostDeals: sql<string>`count(*) filter (where ${deals.status} = 'lost' and ${deals.closedAt} >= ${from})`,
    })
    .from(deals)
    .leftJoin(companies, eq(companies.id, deals.companyId))
    .leftJoin(contacts, eq(contacts.id, deals.contactId))
    .where(and(ownerCondition(deals.ownerId, owners), visibleWhere("deal", scope)))
    .groupBy(companies.country, companies.state, companies.zipCode, contacts.country, contacts.state, contacts.zipCode);
}
