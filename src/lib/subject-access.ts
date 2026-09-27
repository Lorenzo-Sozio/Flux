import { and, eq, inArray, or, type SQL, sql } from "drizzle-orm";

import {
  activities,
  appointmentAttendees,
  campaignLogs,
  contacts,
  deals,
  emailJobs,
  emailSuppressions,
  fieldChanges,
  leads,
  quoteActivities,
  quotes,
  tasks,
  ticketMessages,
  tickets,
} from "@/db/schema";
import { findByContactPoint, readContactPoint } from "@/lib/contact-point";

/**
 * Everything this workspace holds about the person reachable at a contact point, as one
 * machine-readable document (GDPR art. 15 and 20) — the other half of `erasure.ts`.
 *
 * ⚠️⚠️ **The same lookup as the erasure**, on purpose: what can be exported is what an
 * erasure would reach, and a person shown one list and then erased from another has been
 * told something untrue about one of them.
 *
 * Records *of* the person (lead, contact, their activities, tasks, tickets, messages,
 * attendance, emails sent to them, quote views, their history and consent) come whole.
 * The business's own records that merely point at them (deals, quotes) come as the link:
 * what it was, not the company's figures around it.
 */

// biome-ignore lint/suspicious/noExplicitAny: Drizzle's database types differ per driver
type AnyDb = any;

export interface SubjectAccessExport {
  generatedAt: string;
  contactPoint: string;
  found: { leads: number; contacts: number };
  consent: { record: string; id: string; marketingConsent: boolean | null; decidedAt: unknown; source: unknown }[];
  records: Record<string, unknown[]>;
}

const none = Promise.resolve([] as unknown[]);

export async function exportByContactPoint(
  db: AnyDb,
  contactPoint: string,
  now: Date = new Date(),
): Promise<SubjectAccessExport> {
  const { email, digits } = readContactPoint(contactPoint);
  const { leadIds, contactIds } = await findByContactPoint(db, email, digits);

  const byPerson = (leadCol: unknown, contactCol: unknown): SQL | undefined => {
    const clauses: SQL[] = [];
    if (leadIds.length && leadCol) clauses.push(inArray(leadCol as never, leadIds));
    if (contactIds.length && contactCol) clauses.push(inArray(contactCol as never, contactIds));
    return clauses.length ? (or(...clauses) as SQL) : undefined;
  };
  const rows = (table: unknown, where: SQL | undefined) =>
    where
      ? (db
          .select()
          .from(table as never)
          .where(where) as Promise<unknown[]>)
      : none;
  const historyWhere = [
    ...(leadIds.length ? [and(eq(fieldChanges.entityType, "lead"), inArray(fieldChanges.entityId, leadIds))] : []),
    ...(contactIds.length
      ? [and(eq(fieldChanges.entityType, "contact"), inArray(fieldChanges.entityId, contactIds))]
      : []),
  ];
  const ticketsWhere = byPerson(tickets.leadId, tickets.contactId);

  const [
    leadRows,
    contactRows,
    activityRows,
    taskRows,
    ticketRows,
    attendeeRows,
    campaignRows,
    historyRows,
    dealRows,
    quoteRows,
    emailRows,
    viewRows,
    suppressionRows,
  ] = await Promise.all([
    leadIds.length ? rows(leads, inArray(leads.id, leadIds)) : none,
    contactIds.length ? rows(contacts, inArray(contacts.id, contactIds)) : none,
    rows(activities, byPerson(activities.leadId, activities.contactId)),
    rows(tasks, byPerson(tasks.leadId, tasks.contactId)),
    rows(tickets, ticketsWhere),
    rows(appointmentAttendees, byPerson(null, appointmentAttendees.contactId)),
    rows(campaignLogs, byPerson(campaignLogs.leadId, campaignLogs.contactId)),
    historyWhere.length ? rows(fieldChanges, or(...historyWhere) as SQL) : none,
    contactIds.length
      ? db
          .select({
            id: deals.id,
            name: deals.name,
            status: deals.status,
            createdAt: deals.createdAt,
            closedAt: deals.closedAt,
          })
          .from(deals)
          .where(inArray(deals.contactId, contactIds))
      : none,
    contactIds.length
      ? db
          .select({ id: quotes.id, number: quotes.quoteNumber, status: quotes.status, createdAt: quotes.createdAt })
          .from(quotes)
          .where(inArray(quotes.contactId, contactIds))
      : none,
    email ? rows(emailJobs, sql`lower(btrim(${emailJobs.toEmail})) = ${email}`) : none,
    email ? rows(quoteActivities, sql`lower(btrim(${quoteActivities.email})) = ${email}`) : none,
    email ? rows(emailSuppressions, sql`lower(btrim(${emailSuppressions.email})) = ${email}`) : none,
  ]);

  // Messages on the person's tickets, and any they wrote from this address on others.
  const ticketIds = (ticketRows as { id: string }[]).map((t) => t.id);
  const messageClauses: SQL[] = [];
  if (ticketIds.length) messageClauses.push(inArray(ticketMessages.ticketId, ticketIds));
  if (email) messageClauses.push(sql`lower(btrim(${ticketMessages.senderEmail})) = ${email}`);
  const messageRows = messageClauses.length ? await rows(ticketMessages, or(...messageClauses) as SQL) : [];

  const consentOf = (record: string) => (r: Record<string, unknown>) => ({
    record,
    id: String(r.id),
    marketingConsent: (r.marketingConsent as boolean | null) ?? null,
    decidedAt: r.consentDate ?? null,
    source: r.consentSource ?? null,
  });

  return {
    generatedAt: now.toISOString(),
    contactPoint,
    found: { leads: leadIds.length, contacts: contactIds.length },
    consent: [
      ...(leadRows as Record<string, unknown>[]).map(consentOf("lead")),
      ...(contactRows as Record<string, unknown>[]).map(consentOf("contact")),
    ],
    records: {
      leads: leadRows,
      contacts: contactRows,
      activities: activityRows,
      tasks: taskRows,
      tickets: ticketRows,
      ticketMessages: messageRows,
      appointmentAttendance: attendeeRows,
      campaignEmails: campaignRows,
      emailsQueuedOrSent: emailRows,
      quoteViews: viewRows,
      history: historyRows,
      deals: dealRows,
      quotes: quoteRows,
      suppression: suppressionRows,
    },
  };
}
