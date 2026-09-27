import { and, eq, sql } from "drizzle-orm";

import { activities, contacts, leads, ticketMessages, tickets, webForms } from "@/db/schema";
import { consentPatch } from "@/lib/consent";
import { escapeHtml } from "@/lib/escape-html";
import { newArchiveToken } from "@/lib/mail-archive";
import { ticketEventPayload } from "@/lib/ticket-events";
import { generateTicketNumber } from "@/lib/ticket-number";
import { resolveSla } from "@/lib/ticket-sla";
import { dispatchWebhook } from "@/lib/webhook-dispatch";

/**
 * The workspace's two public forms (V3.6): "contact us" files a lead, "support request"
 * opens a ticket. Hosted at `/f/<subdomain>/<token>`, or posted to from the customer's own
 * site (`POST /api/forms`).
 *
 * ⚠️⚠️ **Somebody already known is not created twice.** A contact or an open lead with that
 * address gets the message on their timeline instead of a second record — the web form is
 * the channel most likely to bring back somebody who wrote before. The ticket form, like
 * inbound email, finds the contact by address or creates one.
 *
 * ⚠️ Consent is what the person ticked, recorded as a decision taken through the web form
 * (`consentSource: "web"`): never assumed from having written in.
 *
 * ⚠️ What a visitor typed is stored as text and, where it is shown as HTML (a ticket
 * message), escaped: the form is the one input anybody on the internet can fill.
 */

// biome-ignore lint/suspicious/noExplicitAny: Drizzle's database types differ per driver
type AnyDb = any;

export const WEB_FORM_KINDS = ["lead", "ticket"] as const;
export type WebFormKind = (typeof WEB_FORM_KINDS)[number];
export type WebForm = typeof webForms.$inferSelect;

/** Both forms, created closed the first time anybody looks. */
export async function ensureWebForms(db: AnyDb): Promise<WebForm[]> {
  await db
    .insert(webForms)
    .values(WEB_FORM_KINDS.map((kind) => ({ id: newArchiveToken(), kind })))
    .onConflictDoNothing();
  return db.select().from(webForms);
}

export async function webFormByToken(db: AnyDb, token: string): Promise<WebForm | null> {
  if (!/^[a-z2-7]{20}$/.test(token)) return null;
  const [row] = await db.select().from(webForms).where(eq(webForms.id, token));
  return row ?? null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export interface LeadSubmission {
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  message: string;
  consent: boolean;
}

export interface TicketSubmission {
  name: string;
  email: string;
  subject: string;
  description: string;
}

/** What was sent, as a submission — or null when there is no name, address or message. */
export function readLeadSubmission(body: Record<string, unknown>): LeadSubmission | null {
  const s = {
    name: text(body.name, 120),
    email: text(body.email, 254).toLowerCase(),
    phone: text(body.phone, 40) || null,
    company: text(body.company, 200) || null,
    message: text(body.message, 5000),
    consent: body.consent === true || body.consent === "on" || body.consent === "true",
  };
  return s.name && EMAIL.test(s.email) ? s : null;
}

export function readTicketSubmission(body: Record<string, unknown>): TicketSubmission | null {
  const s = {
    name: text(body.name, 120),
    email: text(body.email, 254).toLowerCase(),
    subject: text(body.subject, 200),
    description: text(body.description, 10_000),
  };
  return s.name && EMAIL.test(s.email) && s.subject && s.description ? s : null;
}

function splitName(name: string, email: string): { firstName: string; lastName: string } {
  const [first, ...rest] = name.split(/\s+/);
  return { firstName: first || email.split("@")[0], lastName: rest.join(" ") };
}

function noteContent(label: string, s: LeadSubmission): string {
  return [label, s.message, s.company && `— ${s.company}`, s.phone && `— ${s.phone}`].filter(Boolean).join("\n");
}

export type LeadFormResult =
  | { kind: "created"; leadId: string; ownerId: string | null; row: Record<string, unknown> }
  | { kind: "known"; leadId: string | null; contactId: string | null; ownerId: string | null };

export async function submitLeadForm(
  db: AnyDb,
  form: WebForm,
  s: LeadSubmission,
  label: string,
  now: Date = new Date(),
): Promise<LeadFormResult> {
  const [contact] = await db
    .select({ id: contacts.id, ownerId: contacts.ownerId, companyId: contacts.companyId })
    .from(contacts)
    .where(sql`lower(${contacts.email}) = ${s.email}`)
    .limit(1);
  const [lead] = contact
    ? []
    : await db
        .select({ id: leads.id, ownerId: leads.ownerId })
        .from(leads)
        .where(and(sql`lower(${leads.email}) = ${s.email}`, eq(leads.isConverted, false)))
        .limit(1);

  if (contact || lead) {
    await db.insert(activities).values({
      type: "note",
      content: noteContent(label, s),
      date: now,
      // Written by the visitor, not by one of our people.
      ownerId: null,
      contactId: contact?.id ?? null,
      companyId: contact?.companyId ?? null,
      leadId: lead?.id ?? null,
    });
    return {
      kind: "known",
      contactId: contact?.id ?? null,
      leadId: lead?.id ?? null,
      ownerId: contact?.ownerId ?? lead?.ownerId ?? form.ownerId,
    };
  }

  const leadId = crypto.randomUUID();
  const [row] = await db
    .insert(leads)
    .values({
      id: leadId,
      ...splitName(s.name, s.email),
      email: s.email,
      phone: s.phone,
      companyName: s.company,
      source: "web_form",
      status: "new",
      ownerId: form.ownerId,
      ...consentPatch(null, s.consent, "web", now),
    })
    .returning();
  if (s.message) {
    await db
      .insert(activities)
      .values({ type: "note", content: noteContent(label, s), date: now, leadId, ownerId: null });
  }
  return { kind: "created", leadId, ownerId: form.ownerId, row };
}

export async function submitTicketForm(
  db: AnyDb,
  s: TicketSubmission,
): Promise<{ ticketId: string; ticketNumber: string; contactId: string; row: Record<string, unknown> }> {
  const [found] = await db
    .select({ id: contacts.id, companyId: contacts.companyId })
    .from(contacts)
    .where(sql`lower(${contacts.email}) = ${s.email}`)
    .limit(1);
  let contact = found as { id: string; companyId: string | null } | undefined;
  if (!contact) {
    const id = crypto.randomUUID();
    await db.insert(contacts).values({
      id,
      ...splitName(s.name, s.email),
      email: s.email,
      source: "web_form",
      status: "active",
    });
    contact = { id, companyId: null };
  }

  const ticketId = crypto.randomUUID();
  const ticketNumber = generateTicketNumber();
  const html = `<p>${escapeHtml(s.description).replace(/\n\n+/g, "</p><p>").replace(/\n/g, "<br>")}</p>`;
  // A request from the site carries the same promise as one typed in (src/lib/ticket-sla.ts).
  const sla = await resolveSla(db, "normal");
  const [row] = await db
    .insert(tickets)
    .values({
      id: ticketId,
      ticketNumber,
      subject: s.subject,
      description: s.description.slice(0, 500),
      channel: "web",
      priority: "normal",
      status: "new",
      contactId: contact.id,
      companyId: contact.companyId,
      slaId: sla.slaId,
      firstResponseDueAt: sla.firstResponseDueAt,
      slaDeadlineAt: sla.slaDeadlineAt,
    })
    .returning();
  await db.insert(ticketMessages).values({
    ticketId,
    content: html,
    channel: "web",
    isPublic: true,
    senderEmail: s.email,
    senderName: s.name,
    // One of our people, and the database enforces it: the visitor is senderEmail/Name.
    senderId: null,
  });
  // The visitor wrote it: `user`, with no actor, as a quote accepted from its page.
  dispatchWebhook("ticket.created", ticketEventPayload(row), { via: "user", actor: null }, db as never).catch((err) =>
    console.error("[web-forms] ticket.created not dispatched", err),
  );
  return { ticketId, ticketNumber, contactId: contact.id, row };
}
