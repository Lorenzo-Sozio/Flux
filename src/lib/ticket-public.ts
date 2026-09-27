/**
 * The customer's side of a ticket: a status page, and a rating asked for once.
 *
 * ⚠️⚠️ **The token is the whole of the customer's access.** Anybody holding it reads the
 * public half of the conversation, so it is 100 random bits (the archive-address
 * alphabet), created on first need and never derived from anything a stranger can see.
 * The status page shows public messages only — an internal note must never reach it.
 *
 * ⚠️⚠️ **Asked once, and the ask is a claim.** `csat_requested_at` is set by an update
 * that applies only while it is still empty, and only the caller that set it queues the
 * email: a ticket resolved twice in a second, from the board and the detail page, sends
 * one. Nothing is sent while the workspace has not switched the feature on — it writes to
 * customers, and a deploy is not a decision to do that.
 *
 * ⚠️ A link a mail scanner fetches must not vote: the email's buttons open the page with
 * the answer preselected, and the page records it from the browser. See /t/.
 */
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";

import { companies, contacts, emailJobs, ticketMessages, tickets, workspaceSettings } from "@/db/schema";
import { type DocumentLanguage, documentLanguage, fill } from "@/lib/document-language";
import { escapeHtml } from "@/lib/escape-html";
import { newArchiveToken } from "@/lib/mail-archive";
import { sanitizeEmailHtml } from "@/lib/sanitize-email-html";
import { TICKET_TEXT } from "@/lib/ticket-public-text";

// biome-ignore lint/suspicious/noExplicitAny: platform and tenant handles share the query builders
type AnyDb = NeonHttpDatabase<any>;

export const CSAT_SETTING_KEY = "support.csat";
export const CSAT_RATINGS = ["good", "bad"] as const;
export type CsatRating = (typeof CSAT_RATINGS)[number];
export const isCsatRating = (v: unknown): v is CsatRating => v === "good" || v === "bad";

/** Only a resolved or closed request can be rated: before that there is nothing to judge. */
const RATEABLE = ["resolved", "closed"];
const COMMENT_MAX = 2000;

/** The shape `newArchiveToken` produces; anything else is refused before it reaches a query. */
export const isPublicToken = (v: unknown): v is string => typeof v === "string" && /^[a-z2-7]{20}$/.test(v);

export function statusPageUrl(base: string, subdomain: string, token: string, rate?: CsatRating): string {
  const url = `${base.replace(/\/$/, "")}/t/${encodeURIComponent(subdomain)}/${token}`;
  return rate ? `${url}?rate=${rate}` : url;
}

// ─── The switch ──────────────────────────────────────────────────────────────

export async function csatEnabled(db: AnyDb): Promise<boolean> {
  const [row] = await db
    .select({ value: workspaceSettings.value })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.key, CSAT_SETTING_KEY))
    .limit(1);
  return Boolean((row?.value as { enabled?: unknown } | undefined)?.enabled === true);
}

export async function setCsatEnabled(db: AnyDb, enabled: boolean): Promise<void> {
  const value = { enabled };
  await db
    .insert(workspaceSettings)
    .values({ key: CSAT_SETTING_KEY, value })
    .onConflictDoUpdate({ target: workspaceSettings.key, set: { value, updatedAt: new Date() } });
}

// ─── The token ───────────────────────────────────────────────────────────────

/** The ticket's token, created the first time somebody needs one. */
export async function ensurePublicToken(db: AnyDb, ticketId: string): Promise<string | null> {
  const [row] = await db.select({ token: tickets.publicToken }).from(tickets).where(eq(tickets.id, ticketId)).limit(1);
  if (!row) return null;
  if (row.token) return row.token;
  // Two callers at once: the conditional write decides, and the loser reads the winner's.
  const [set] = await db
    .update(tickets)
    .set({ publicToken: newArchiveToken() })
    .where(and(eq(tickets.id, ticketId), isNull(tickets.publicToken)))
    .returning({ token: tickets.publicToken });
  if (set?.token) return set.token;
  const [again] = await db
    .select({ token: tickets.publicToken })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1);
  return again?.token ?? null;
}

// ─── Who the customer is ─────────────────────────────────────────────────────

async function customerOf(db: AnyDb, contactId: string | null) {
  if (!contactId) return null;
  const [row] = await db
    .select({
      email: contacts.email,
      contactCountry: contacts.country,
      language: companies.language,
      companyCountry: companies.country,
    })
    .from(contacts)
    .leftJoin(companies, eq(companies.id, contacts.companyId))
    .where(eq(contacts.id, contactId))
    .limit(1);
  if (!row) return null;
  return {
    email: row.email?.trim() || null,
    lang: documentLanguage({ language: row.language, country: row.companyCountry ?? row.contactCountry }),
  };
}

/** The language a ticket's customer reads, for the lines added under a reply. */
export async function ticketLanguage(db: AnyDb, contactId: string | null): Promise<DocumentLanguage> {
  return (await customerOf(db, contactId))?.lang ?? documentLanguage(null);
}

// ─── Asking ──────────────────────────────────────────────────────────────────

export function resolvedEmailHtml(input: {
  lang: DocumentLanguage;
  number: string;
  subject: string;
  base: string;
  subdomain: string;
  token: string;
}): string {
  const t = TICKET_TEXT[input.lang];
  const link = (rate?: CsatRating) => escapeHtml(statusPageUrl(input.base, input.subdomain, input.token, rate));
  const button = (rate: CsatRating, label: string, colour: string) =>
    `<a href="${link(rate)}" style="display:inline-block;padding:10px 18px;margin:0 8px 8px 0;border-radius:6px;background:${colour};color:#ffffff;text-decoration:none;font-weight:600">${escapeHtml(label)}</a>`;
  return `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
  <h2 style="font-size:18px;margin:0 0 12px">${escapeHtml(t.resolvedHeading)}</h2>
  <p>${escapeHtml(fill(t.resolvedBody, { number: input.number, subject: input.subject }))}</p>
  <p style="margin:24px 0 8px;font-weight:600">${escapeHtml(t.ratePrompt)}</p>
  <p>${button("good", t.rateGood, "#16a34a")}${button("bad", t.rateBad, "#dc2626")}</p>
  <p style="margin-top:24px"><a href="${link()}">${escapeHtml(t.followLink)}</a></p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
  <p style="color:#6b7280;font-size:12px">${escapeHtml(t.reopenHint)}</p>
</div>`;
}

/** The line under an agent's reply that leads the customer to the status page. */
export function replyFooterHtml(lang: DocumentLanguage, url: string): string {
  const [before, after = ""] = TICKET_TEXT[lang].replyFooter.split("{link}");
  const href = escapeHtml(url);
  return `<p style="color:#6b7280;font-size:12px">${escapeHtml(before)}<a href="${href}">${href}</a>${escapeHtml(after)}</p>`;
}

export type RatingRequest = "sent" | "disabled" | "asked" | "rated" | "noEmail" | "noLink" | "notFound";

/**
 * Tells the customer their request is resolved and asks, once, how it went. Queued on
 * `email_job`, so it inherits the worker's retries, and threaded under the conversation.
 */
export async function requestRating(
  db: AnyDb,
  input: { ticketId: string; subdomain: string | null; base: string | null; now?: Date },
): Promise<RatingRequest> {
  if (!(await csatEnabled(db))) return "disabled";
  const [ticket] = await db
    .select({
      id: tickets.id,
      number: tickets.ticketNumber,
      subject: tickets.subject,
      contactId: tickets.contactId,
      requestedAt: tickets.csatRequestedAt,
      ratedAt: tickets.csatRatedAt,
    })
    .from(tickets)
    .where(eq(tickets.id, input.ticketId))
    .limit(1);
  if (!ticket) return "notFound";
  if (ticket.ratedAt) return "rated";
  if (ticket.requestedAt) return "asked";
  const customer = await customerOf(db, ticket.contactId);
  if (!customer?.email) return "noEmail";
  // No public origin, no links worth sending: the buttons would point nowhere.
  if (!input.base || !input.subdomain) return "noLink";
  const token = await ensurePublicToken(db, ticket.id);
  if (!token) return "notFound";

  const now = input.now ?? new Date();
  const claimed = await db
    .update(tickets)
    .set({ csatRequestedAt: now })
    .where(and(eq(tickets.id, ticket.id), isNull(tickets.csatRequestedAt)))
    .returning({ id: tickets.id });
  if (claimed.length === 0) return "asked";

  const [last] = await db
    .select({ id: ticketMessages.emailMessageId })
    .from(ticketMessages)
    .where(and(eq(ticketMessages.ticketId, ticket.id), isNotNull(ticketMessages.emailMessageId)))
    .orderBy(desc(ticketMessages.createdAt))
    .limit(1);

  try {
    await db.insert(emailJobs).values({
      toEmail: customer.email,
      // The number in the subject is what threads an answer back to this ticket.
      subject: `[${ticket.number}] Re: ${ticket.subject}`,
      htmlBody: resolvedEmailHtml({
        lang: customer.lang,
        number: ticket.number,
        subject: ticket.subject,
        base: input.base,
        subdomain: input.subdomain,
        token,
      }),
      status: "pending",
      scheduledAt: now,
      inReplyTo: last?.id ?? null,
    });
  } catch (err) {
    // Give the claim back, or the customer is never asked and nothing says why.
    await db.update(tickets).set({ csatRequestedAt: null }).where(eq(tickets.id, ticket.id));
    throw err;
  }
  return "sent";
}

// ─── The page ────────────────────────────────────────────────────────────────

export interface StatusPageMessage {
  fromCustomer: boolean;
  at: Date;
  /** Sanitised: this is HTML from an email, shown to whoever holds the link. */
  html: string;
}

export interface StatusPage {
  lang: DocumentLanguage;
  number: string;
  subject: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  messages: StatusPageMessage[];
  canRate: boolean;
  rating: CsatRating | null;
  comment: string | null;
}

/** Channels on which the ticket's description is the customer's own words. */
const CUSTOMER_WRITTEN = new Set(["email", "web"]);

export async function loadStatusPage(db: AnyDb, token: string): Promise<StatusPage | null> {
  if (!isPublicToken(token)) return null;
  const [ticket] = await db
    .select({
      id: tickets.id,
      number: tickets.ticketNumber,
      subject: tickets.subject,
      description: tickets.description,
      channel: tickets.channel,
      status: tickets.status,
      contactId: tickets.contactId,
      createdAt: tickets.createdAt,
      updatedAt: tickets.updatedAt,
      rating: tickets.csatRating,
      comment: tickets.csatComment,
    })
    .from(tickets)
    .where(eq(tickets.publicToken, token))
    .limit(1);
  if (!ticket) return null;

  const rows = await db
    .select({ senderId: ticketMessages.senderId, content: ticketMessages.content, at: ticketMessages.createdAt })
    .from(ticketMessages)
    // ⚠️⚠️ Public only. An internal note is a colleague talking about the customer.
    .where(and(eq(ticketMessages.ticketId, ticket.id), eq(ticketMessages.isPublic, true)))
    .orderBy(ticketMessages.createdAt);

  const messages: StatusPageMessage[] = rows.map((m: { senderId: string | null; content: string; at: Date }) => ({
    fromCustomer: m.senderId === null,
    at: m.at,
    html: sanitizeEmailHtml(m.content ?? ""),
  }));
  // ⚠️ The description is shown only when the customer wrote it (an email, the web form).
  // Typed in by an agent — from a phone call, a chat — it is the agent's summary, and may
  // hold what was never meant for the customer (decided 27 September 2026).
  if (messages.length === 0 && ticket.description && CUSTOMER_WRITTEN.has(ticket.channel)) {
    messages.push({ fromCustomer: true, at: ticket.createdAt, html: sanitizeEmailHtml(ticket.description) });
  }

  return {
    lang: await ticketLanguage(db, ticket.contactId),
    number: ticket.number,
    subject: ticket.subject,
    status: ticket.status,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    messages,
    canRate: RATEABLE.includes(ticket.status),
    rating: isCsatRating(ticket.rating) ? ticket.rating : null,
    comment: ticket.comment ?? null,
  };
}

// ─── Rating ──────────────────────────────────────────────────────────────────

export type RateResult =
  | {
      ok: true;
      ticketId: string;
      ticketNumber: string;
      notifyUserId: string | null;
      rating: CsatRating;
      /** False for a repeat of the same answer: nobody is told twice. */
      changed: boolean;
    }
  | { ok: false; reason: "notFound" | "notYet" | "invalid" };

/**
 * Records the customer's answer. The latest answer wins — a customer who clicked the wrong
 * button, or changed their mind, can say so — and a comment given with it is kept.
 */
export async function rateTicket(
  db: AnyDb,
  input: { token: unknown; rating: unknown; comment?: unknown; now?: Date },
): Promise<RateResult> {
  if (!isPublicToken(input.token) || !isCsatRating(input.rating)) return { ok: false, reason: "invalid" };
  const comment =
    typeof input.comment === "string" && input.comment.trim() ? input.comment.trim().slice(0, COMMENT_MAX) : null;
  // Only to tell a change from a repeat: a reloaded page, or the comment sent after the click.
  const [before] = await db
    .select({ rating: tickets.csatRating })
    .from(tickets)
    .where(eq(tickets.publicToken, input.token))
    .limit(1);
  const [row] = await db
    .update(tickets)
    .set({
      csatRating: input.rating,
      csatRatedAt: input.now ?? new Date(),
      ...(comment !== null ? { csatComment: comment } : {}),
    })
    .where(and(eq(tickets.publicToken, input.token), inArray(tickets.status, RATEABLE)))
    .returning({
      id: tickets.id,
      number: tickets.ticketNumber,
      assigneeId: tickets.assigneeId,
      ownerId: tickets.ownerId,
    });
  if (!row) {
    const [exists] = await db
      .select({ id: tickets.id })
      .from(tickets)
      .where(eq(tickets.publicToken, input.token))
      .limit(1);
    return { ok: false, reason: exists ? "notYet" : "notFound" };
  }
  return {
    ok: true,
    ticketId: row.id,
    ticketNumber: row.number,
    notifyUserId: row.assigneeId ?? row.ownerId ?? null,
    rating: input.rating,
    changed: before?.rating !== input.rating,
  };
}
