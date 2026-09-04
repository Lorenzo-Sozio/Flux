/**
 * merge-children.ts — what has to travel when two records become one.
 *
 * A merge moves everything that pointed at the losing record onto the surviving
 * one, and then deletes the loser. The list of what to move was written by hand
 * at each call site, and it drifted from the schema, in two directions and in
 * silence:
 *
 * - `order.company_id` and `order.contact_id` arrived after the lists did and
 *   were never added to them. They are `ON DELETE SET NULL`, so merging two
 *   customers left the losing one's orders in place with nobody to bill.
 * - `campaign_log.contact_id` is `ON DELETE CASCADE`. Merging two contacts did
 *   not move the campaign history: it destroyed it. Every send, open and click
 *   belonging to the losing contact went with the row, and nothing said so.
 *
 * Neither is visible at the moment it happens — a merge that ate a year of
 * marketing history looks exactly like a merge that worked.
 *
 * So the lists live here, in one place, next to a test that reads the foreign
 * keys back out of the schema and fails when one of them is not listed. Adding a
 * table with a `companyId` and forgetting this file is the mistake that has
 * already been made; it is now a red test rather than a customer's missing past.
 */

import type { AnyPgColumn, AnyPgTable } from "drizzle-orm/pg-core";

import {
  activities,
  appointmentAttendees,
  appointments,
  campaignLogs,
  companies,
  contacts,
  deals,
  leads,
  orders,
  quotes,
  tasks,
  tickets,
} from "@/db/schema";

export interface MergeChild {
  table: AnyPgTable;
  /** The camelCase column on that table which points at the merged record. */
  field: string;
}

/** The column itself, looked up once so the field name is the only thing written twice. */
export function childColumn(child: MergeChild): AnyPgColumn {
  return (child.table as unknown as Record<string, AnyPgColumn>)[child.field];
}

export const COMPANY_CHILDREN: MergeChild[] = [
  { table: contacts, field: "companyId" },
  { table: deals, field: "companyId" },
  { table: quotes, field: "companyId" },
  { table: orders, field: "companyId" },
  { table: tickets, field: "companyId" },
  { table: appointments, field: "companyId" },
  { table: activities, field: "companyId" },
  { table: tasks, field: "companyId" },
];

export const CONTACT_CHILDREN: MergeChild[] = [
  { table: deals, field: "contactId" },
  { table: quotes, field: "contactId" },
  { table: orders, field: "contactId" },
  { table: tickets, field: "contactId" },
  { table: appointments, field: "contactId" },
  { table: appointmentAttendees, field: "contactId" },
  { table: activities, field: "contactId" },
  { table: tasks, field: "contactId" },
  { table: campaignLogs, field: "contactId" },
];

export const LEAD_CHILDREN: MergeChild[] = [
  { table: tickets, field: "leadId" },
  { table: appointments, field: "leadId" },
  { table: activities, field: "leadId" },
  { table: tasks, field: "leadId" },
  { table: campaignLogs, field: "leadId" },
];

/** The three merges, for anything that wants to check all of them at once. */
export const MERGE_PARENTS: { parent: AnyPgTable; children: MergeChild[] }[] = [
  { parent: companies, children: COMPANY_CHILDREN },
  { parent: contacts, children: CONTACT_CHILDREN },
  { parent: leads, children: LEAD_CHILDREN },
];
