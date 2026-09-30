/**
 * What the copilot knows about a record: the record as a compact text the model can read
 * (Fase 5, C0/C1–C3).
 *
 * ⚠️⚠️ Built from what Flux already shows the person — the same timeline, the same fields —
 * and nothing else: a proposal can only be as right as its material, and material the person
 * could not see on screen is material they cannot check the proposal against.
 *
 * ⚠️ The caller checks who may read the record (`requireCapability`) before building it. This
 * module takes a workspace database handle and reads what it is told to.
 *
 * ⚠️ Everything the customer or a colleague wrote enters as quoted material inside
 * `<record>`, never as instructions: `renderContext` says so to the model, and the task's
 * system prompt repeats it.
 */
import { and, asc, desc, eq, ne } from "drizzle-orm";

import { companies, contacts, deals, leads, pipelineStages, tasks, ticketMessages, tickets, users } from "@/db/schema";
import { type DocumentLanguage, documentLanguage } from "@/lib/document-language";
import { loadRecordTimeline, type TimelineItem } from "@/lib/record-timeline";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle's database types differ per driver
type AnyDb = any;

export type AiSubjectType = "deal" | "contact" | "company" | "lead" | "ticket";
export const AI_SUBJECT_TYPES: readonly AiSubjectType[] = ["deal", "contact", "company", "lead", "ticket"];

export interface AiSubject {
  type: AiSubjectType;
  id: string;
}

export interface RecordContext {
  subject: AiSubject;
  /** What the record is called on screen. */
  name: string;
  /** "Label: value", only what is filled in. */
  facts: string[];
  /** Open tasks on the record, soonest first. */
  open: string[];
  /** What happened, newest first, each line dated. */
  history: string[];
  /** The language a document to this customer is written in (drafts). */
  language: DocumentLanguage;
  /** Where an email to this person goes, for a contact or a lead. */
  email: string | null;
}

/** How much of the history reaches the model, and how much of each line. */
export const CONTEXT_LIMITS = { history: 40, line: 700, open: 10, messages: 40 };

// ─── Turning rows into lines ─────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/** The text of an HTML fragment: tags out, entities decoded, whitespace folded. */
export function plainText(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

function clip(text: string, max = CONTEXT_LIMITS.line): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** A day on the workspace's clock, as YYYY-MM-DD. */
export function dayOf(value: Date | string | null | undefined, timeZone: string): string | null {
  if (!value) return null;
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** An email activity's JSON (inbound-sales-reply.ts, actions/email.ts) as one line. */
function emailLine(content: string): string | null {
  try {
    const email = JSON.parse(content) as {
      _type?: string;
      direction?: string;
      subject?: string;
      bodyText?: string;
      snippet?: string;
      body?: string;
    };
    if (email._type !== "email_v2") return null;
    const who = email.direction === "in" ? "email FROM the customer" : "email TO the customer";
    const body = email.bodyText || email.snippet || plainText(email.body);
    return `${who}, subject "${email.subject ?? ""}": ${body}`;
  } catch {
    return null;
  }
}

/** One timeline item as one dated line. */
export function describeTimelineItem(item: TimelineItem, timeZone: string): string {
  const day = dayOf(item.at, timeZone) ?? "";
  const via = item.via ? ` [on ${item.via.type} ${item.via.name}]` : "";
  if (item.kind === "activity") {
    const content = item.content ?? "";
    const text = (content.startsWith("{") && emailLine(content)) || `${item.type}: ${plainText(content)}`;
    const outcome = item.outcome ? ` — outcome: ${item.outcome}` : "";
    const who = item.ownerName ? ` (${item.ownerName})` : "";
    return clip(`${day} ${text}${outcome}${who}${via}`);
  }
  if (item.kind === "change") {
    const from = item.oldLabel ?? item.oldValue ?? "—";
    const to = item.newLabel ?? item.newValue ?? "—";
    return clip(`${day} ${item.field} changed from ${from} to ${to}${item.byName ? ` by ${item.byName}` : ""}${via}`);
  }
  return clip(`${day} quote ${item.quoteNumber}: ${item.event}${item.byName ? ` by ${item.byName}` : ""}${via}`);
}

function fact(label: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? `${label}: ${clip(text, 400)}` : null;
}

function money(amount: string | null, currency: string | null): string | null {
  if (amount === null || amount === undefined) return null;
  return `${Number(amount).toFixed(2)} ${currency ?? "EUR"}`;
}

const facts = (...lines: (string | null)[]) => lines.filter((l): l is string => l !== null);

/**
 * The record as the model reads it. Delimited, and labelled as material: whatever a customer
 * wrote inside it is something to work on, not something to obey.
 */
export function renderContext(ctx: RecordContext, extra: string[] = []): string {
  const parts = [
    `<record type="${ctx.subject.type}">`,
    `Name: ${ctx.name}`,
    ...ctx.facts,
    ...(ctx.open.length ? ["", "Open tasks:", ...ctx.open.map((l) => `- ${l}`)] : []),
    ...(ctx.history.length ? ["", "History (newest first):", ...ctx.history.map((l) => `- ${l}`)] : []),
    ...extra,
    "</record>",
  ];
  return parts.join("\n");
}

// ─── Reading the record ──────────────────────────────────────────────────────

async function openTasks(db: AnyDb, subject: AiSubject, timeZone: string): Promise<string[]> {
  const column =
    subject.type === "deal"
      ? tasks.dealId
      : subject.type === "contact"
        ? tasks.contactId
        : subject.type === "company"
          ? tasks.companyId
          : subject.type === "lead"
            ? tasks.leadId
            : tasks.ticketId;
  const rows: { title: string; type: string; dueDate: Date | null }[] = await db
    .select({ title: tasks.title, type: tasks.type, dueDate: tasks.dueDate })
    .from(tasks)
    .where(and(eq(column, subject.id), ne(tasks.status, "done")))
    .orderBy(asc(tasks.dueDate))
    .limit(CONTEXT_LIMITS.open);
  return rows.map((t) => clip(`${dayOf(t.dueDate, timeZone) ?? "no date"} ${t.type}: ${t.title}`, 300));
}

async function history(db: AnyDb, subject: AiSubject, timeZone: string): Promise<string[]> {
  if (subject.type === "ticket") return [];
  const { items } = await loadRecordTimeline(
    db,
    subject as { type: "deal" | "contact" | "company" | "lead"; id: string },
    {
      limit: CONTEXT_LIMITS.history,
    },
  );
  return items.map((item) => describeTimelineItem(item, timeZone));
}

async function ticketThread(db: AnyDb, ticketId: string, timeZone: string): Promise<string[]> {
  const rows: {
    content: string;
    isPublic: boolean;
    senderId: string | null;
    senderName: string | null;
    createdAt: Date;
  }[] = await db
    .select({
      content: ticketMessages.content,
      isPublic: ticketMessages.isPublic,
      senderId: ticketMessages.senderId,
      senderName: ticketMessages.senderName,
      createdAt: ticketMessages.createdAt,
    })
    .from(ticketMessages)
    .where(eq(ticketMessages.ticketId, ticketId))
    .orderBy(desc(ticketMessages.createdAt))
    .limit(CONTEXT_LIMITS.messages);
  return rows.map((m) => {
    const who = !m.isPublic ? "internal note" : m.senderId ? "agent" : "customer";
    return clip(
      `${dayOf(m.createdAt, timeZone) ?? ""} ${who}${m.senderName ? ` ${m.senderName}` : ""}: ${plainText(m.content)}`,
    );
  });
}

/** The record, or null when it does not exist in this workspace. */
export async function loadRecordContext(
  db: AnyDb,
  subject: AiSubject,
  timeZone: string,
): Promise<RecordContext | null> {
  const base = { subject, open: await openTasks(db, subject, timeZone) };

  if (subject.type === "deal") {
    const [row] = await db
      .select({ deal: deals, stage: pipelineStages.name, company: companies, contact: contacts, owner: users.name })
      .from(deals)
      .leftJoin(pipelineStages, eq(deals.stageId, pipelineStages.id))
      .leftJoin(companies, eq(deals.companyId, companies.id))
      .leftJoin(contacts, eq(deals.contactId, contacts.id))
      .leftJoin(users, eq(deals.ownerId, users.id))
      .where(eq(deals.id, subject.id));
    if (!row) return null;
    const d = row.deal;
    const person = row.contact ? `${row.contact.firstName} ${row.contact.lastName}`.trim() : null;
    return {
      ...base,
      name: d.name,
      facts: facts(
        fact("Status", d.status),
        fact("Stage", row.stage),
        fact("Value", money(d.amountOriginal ?? d.amount, d.amountOriginal ? d.currency : "EUR")),
        fact("Probability", d.probability === null ? null : `${d.probability}%`),
        fact("Expected close", dayOf(d.expectedCloseDate, timeZone)),
        fact("Company", row.company?.name),
        fact("Contact", person && row.contact?.jobTitle ? `${person}, ${row.contact.jobTitle}` : person),
        fact("Owner", row.owner),
        fact("Lost reason", d.lostReason),
        fact("Notes", plainText(d.notes)),
      ),
      history: await history(db, subject, timeZone),
      language: documentLanguage(row.company),
      email: row.contact?.email ?? null,
    };
  }

  if (subject.type === "contact") {
    const [row] = await db
      .select({ contact: contacts, company: companies, owner: users.name })
      .from(contacts)
      .leftJoin(companies, eq(contacts.companyId, companies.id))
      .leftJoin(users, eq(contacts.ownerId, users.id))
      .where(eq(contacts.id, subject.id));
    if (!row) return null;
    const c = row.contact;
    return {
      ...base,
      name: `${c.firstName} ${c.lastName}`.trim(),
      facts: facts(
        fact("Job title", c.jobTitle),
        fact("Company", row.company?.name),
        fact("Status", c.status),
        fact("Owner", row.owner),
        fact("City", c.city),
        fact("Notes", plainText(c.notes)),
        c.assistantSince ? "Followed by the AI assistant: do not propose automatic messages" : null,
      ),
      history: await history(db, subject, timeZone),
      language: documentLanguage(row.company ?? { country: c.country }),
      email: c.email,
    };
  }

  if (subject.type === "company") {
    const [row] = await db
      .select({ company: companies, owner: users.name })
      .from(companies)
      .leftJoin(users, eq(companies.ownerId, users.id))
      .where(eq(companies.id, subject.id));
    if (!row) return null;
    const c = row.company;
    return {
      ...base,
      name: c.name,
      facts: facts(
        fact("Industry", c.industry),
        fact("Type", c.type),
        fact("Status", c.status),
        fact("City", c.city),
        fact("Owner", row.owner),
        fact("Description", plainText(c.description)),
      ),
      history: await history(db, subject, timeZone),
      language: documentLanguage(c),
      email: c.mainEmail,
    };
  }

  if (subject.type === "lead") {
    const [row] = await db
      .select({ lead: leads, owner: users.name })
      .from(leads)
      .leftJoin(users, eq(leads.ownerId, users.id))
      .where(eq(leads.id, subject.id));
    if (!row) return null;
    const l = row.lead;
    return {
      ...base,
      name: `${l.firstName} ${l.lastName}`.trim(),
      facts: facts(
        fact("Company", l.companyName),
        fact("Job title", l.jobTitle),
        fact("Status", l.status),
        fact("Rating", l.rating),
        fact("Source", l.source),
        fact("Owner", row.owner),
        fact("Notes", plainText(l.notes)),
        l.assistantSince ? "Followed by the AI assistant: do not propose automatic messages" : null,
      ),
      history: await history(db, subject, timeZone),
      language: documentLanguage({ country: l.country }),
      email: l.email,
    };
  }

  const [row] = await db
    .select({ ticket: tickets, company: companies, contact: contacts })
    .from(tickets)
    .leftJoin(companies, eq(tickets.companyId, companies.id))
    .leftJoin(contacts, eq(tickets.contactId, contacts.id))
    .where(eq(tickets.id, subject.id));
  if (!row) return null;
  const t = row.ticket;
  return {
    ...base,
    name: `#${t.ticketNumber} ${t.subject}`,
    facts: facts(
      fact("Status", t.status),
      fact("Priority", t.priority),
      fact("Type", t.type),
      fact("Customer", row.contact ? `${row.contact.firstName} ${row.contact.lastName}`.trim() : null),
      fact("Company", row.company?.name),
      fact("Description", plainText(t.description)),
    ),
    history: await ticketThread(db, t.id, timeZone),
    language: documentLanguage(row.company),
    email: row.contact?.email ?? null,
  };
}

/** Whichever of these an appointment links, the most specific first (the calendar's own order). */
export function appointmentSubject(appt: {
  dealId: string | null;
  contactId: string | null;
  leadId: string | null;
  companyId: string | null;
}): AiSubject | null {
  if (appt.dealId) return { type: "deal", id: appt.dealId };
  if (appt.contactId) return { type: "contact", id: appt.contactId };
  if (appt.leadId) return { type: "lead", id: appt.leadId };
  if (appt.companyId) return { type: "company", id: appt.companyId };
  return null;
}
