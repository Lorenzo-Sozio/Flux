import { and, eq, sql } from "drizzle-orm";

import { activities, companies, contacts, leads, tasks } from "@/db/schema";

/**
 * An email from somebody a salesperson owns goes to that salesperson, not to support.
 *
 * ⚠️⚠️ Every inbound email that named no ticket opened a support ticket — including a
 * prospect answering the quote their account manager had just sent. The reply sat in the
 * support queue, a stub contact was created beside the lead who wrote it, and nothing
 * reached the lead's timeline or the person waiting for the answer.
 *
 * So, before a ticket: if the sender is a contact (or a lead not yet converted) with an
 * owner — the contact's own, or failing that its company's — the email is recorded on that
 * record's timeline and becomes a task for the owner, "reply to …", due today. It shows in
 * their agenda, counts as the deal's next step, and completing it asks how it went.
 *
 * A sender nobody owns is still support's, exactly as before.
 */

// biome-ignore lint/suspicious/noExplicitAny: Drizzle's database types differ per driver
type AnyDb = any;

export interface SalesReplyTarget {
  ownerId: string;
  leadId: string | null;
  contactId: string | null;
  companyId: string | null;
  name: string;
}

/** Who owns the sender, if anybody does. A contact wins over a lead: it is what a lead becomes. */
export async function findSalesOwner(db: AnyDb, senderEmail: string): Promise<SalesReplyTarget | null> {
  const email = senderEmail.trim().toLowerCase();
  if (!email) return null;

  const [contact] = await db
    .select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      ownerId: contacts.ownerId,
      companyId: contacts.companyId,
      companyOwnerId: companies.ownerId,
    })
    .from(contacts)
    .leftJoin(companies, eq(companies.id, contacts.companyId))
    .where(sql`lower(${contacts.email}) = ${email}`)
    .limit(1);
  if (contact) {
    const ownerId = contact.ownerId ?? contact.companyOwnerId;
    if (!ownerId) return null;
    return {
      ownerId,
      leadId: null,
      contactId: contact.id,
      companyId: contact.companyId,
      name: `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || senderEmail,
    };
  }

  const [lead] = await db
    .select({ id: leads.id, firstName: leads.firstName, lastName: leads.lastName, ownerId: leads.ownerId })
    .from(leads)
    .where(and(sql`lower(${leads.email}) = ${email}`, eq(leads.isConverted, false)))
    .limit(1);
  if (lead?.ownerId) {
    return {
      ownerId: lead.ownerId,
      leadId: lead.id,
      contactId: null,
      companyId: null,
      name: `${lead.firstName ?? ""} ${lead.lastName ?? ""}`.trim() || senderEmail,
    };
  }
  return null;
}

/** The body kept on the timeline, in the shape the email card already reads. */
export function inboundEmailContent(input: { from: string; to: string; subject: string; text: string }): string {
  const text = input.text.trim();
  return JSON.stringify({
    _type: "email_v2",
    direction: "in",
    from: input.from,
    to: input.to,
    subject: input.subject,
    snippet: text.substring(0, 300),
    bodyText: text.substring(0, 5000),
  });
}

/** What marks a task as a reply owed: the work list finds them by it (src/actions/next-actions.ts). */
export const REPLY_TASK_PREFIX = "↩ ";

/** "↩ Mario Rossi: Re: Preventivo" — stored text, so a mark rather than a sentence in one language. */
export function replyTaskTitle(name: string, subject: string): string {
  return `${REPLY_TASK_PREFIX}${name}: ${subject}`.slice(0, 200);
}

/** Records the reply on the record and gives the owner a task to answer it. */
export async function fileSalesReply(
  db: AnyDb,
  target: SalesReplyTarget,
  email: { from: string; to: string; subject: string; text: string },
  now = new Date(),
): Promise<{ activityId: string; taskId: string }> {
  const activityId = crypto.randomUUID();
  const taskId = crypto.randomUUID();
  const links = { leadId: target.leadId, contactId: target.contactId, companyId: target.companyId };
  await db.insert(activities).values({
    id: activityId,
    type: "email",
    content: inboundEmailContent(email),
    date: now,
    // Written by the customer, not by one of our people.
    ownerId: null,
    ...links,
  });
  await db.insert(tasks).values({
    id: taskId,
    title: replyTaskTitle(target.name, email.subject),
    type: "email",
    status: "todo",
    dueDate: now,
    allDay: true,
    ownerId: target.ownerId,
    assigneeId: target.ownerId,
    ...links,
  });
  return { activityId, taskId };
}

/** Whether replies can reach Flux at all: an inbound email webhook is configured. */
export function inboundEmailConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.RESEND_INBOUND_WEBHOOK_SECRET || env.INBOUND_EMAIL_SECRET);
}

/**
 * Where a customer's answer to an email sent from a record should go.
 *
 * ⚠️ With inbound email configured, nowhere special: the answer comes back to the
 * workspace address, lands on the record and reaches the owner (above) — tracked. Without
 * it, that address is a dead end, so the answer goes to the person who wrote, whose own
 * mailbox at least receives it.
 */
export function replyToFor(inbound: boolean, senderEmail: string | null | undefined): string | undefined {
  return inbound ? undefined : senderEmail?.trim() || undefined;
}
