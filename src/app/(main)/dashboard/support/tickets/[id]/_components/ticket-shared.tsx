import type React from "react";

import { Mail, MessageCircle, Phone, Users } from "lucide-react";
import type { useFormatter, useTranslations } from "next-intl";

import type { getTicketById, updateTicketAction } from "@/actions/support";
import type { getTasksByTicketId } from "@/actions/tasks";
import type { Tone } from "@/components/crm/record/record-page";
import type { ticketMacros } from "@/db/schema";
import { slaRemainingFraction, THRESHOLDS } from "@/lib/next-actions";

/**
 * What every part of the ticket screen shares: the row shapes, the helpers and the
 * one place that decides what state the SLA is in.
 *
 * No hooks and no "use client": it is imported by the client components beside it
 * and has no reason to be one itself.
 */

// ─── Row shapes ───────────────────────────────────────────────────────────────
//
// Derived from what the loaders actually return, rather than `any`. Every prop on
// this page was untyped, so a renamed column compiled fine and rendered blank.

export type TicketRow = NonNullable<Awaited<ReturnType<typeof getTicketById>>>;
export type TicketMessage = TicketRow["messages"][number];
export type TicketAuditEntry = TicketRow["auditLogs"][number];
export type TicketDocument = { id: string; name: string; url: string; mimeType?: string | null; size?: number | null };
export type TicketMacro = typeof ticketMacros.$inferSelect;
export type PresenceEntry = { userId?: string; userName?: string; typing?: boolean; action?: string };
export type TicketStatus = NonNullable<Parameters<typeof updateTicketAction>[1]["status"]>;
export type TicketPriority = NonNullable<Parameters<typeof updateTicketAction>[1]["priority"]>;
export type LinkedTask = Awaited<ReturnType<typeof getTasksByTicketId>>[number];

export type Translate = ReturnType<typeof useTranslations>;
export type Formatter = ReturnType<typeof useFormatter>;

// ─── Constants ────────────────────────────────────────────────────────────────

export const CHANNEL_ICONS: Record<string, React.ReactNode> = {
  email: <Mail className="h-3.5 w-3.5" />,
  chat: <MessageCircle className="h-3.5 w-3.5" />,
  phone: <Phone className="h-3.5 w-3.5" />,
  social: <Users className="h-3.5 w-3.5" />,
};

export const STATUS_VALUES = ["new", "open", "in_progress", "waiting", "on_hold", "resolved", "closed"] as const;
export const PRIORITY_VALUES = ["urgent", "high", "normal", "low"] as const;

/**
 * The five shared tones, so a ticket's status reads in the colours every other
 * record uses: blue is live work, green is done, grey is parked or finished with.
 * "Waiting" is grey rather than amber on purpose — the ball is in the customer's
 * court and the SLA clock is paused, so nothing here needs the agent's attention.
 */
export const STATUS_TONE: Record<string, Tone> = {
  new: "info",
  open: "info",
  in_progress: "info",
  waiting: "neutral",
  on_hold: "neutral",
  pending: "neutral",
  resolved: "success",
  closed: "neutral",
};

export const PRIORITY_TONE: Record<string, Tone> = { urgent: "danger", high: "warning" };
export const SEVERITY_TONE: Record<string, Tone> = { critical: "danger", high: "warning" };

const AVATAR_PALETTE = [
  "from-violet-500 to-violet-700",
  "from-blue-500 to-blue-700",
  "from-emerald-500 to-emerald-700",
  "from-rose-500 to-rose-700",
  "from-indigo-500 to-indigo-700",
  "from-cyan-500 to-cyan-700",
  "from-amber-500 to-amber-700",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** The message from a caught value, which is `unknown` and not an Error. */
export function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export function avatarColor(name: string) {
  const h = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

/** A stored value shown through a message map when the map knows it, and as itself when not. */
export function labelOf(t: Translate, prefix: string, value: string): string {
  return t.has(`${prefix}.${value}`) ? t(`${prefix}.${value}`) : value;
}

export function formatStamp(date: Date, format: Formatter, t: Translate) {
  const now = Date.now();
  const diff = now - date.getTime();
  if (diff < 60_000) return t("detail.justNow");
  if (diff < 3_600_000) return t("detail.minutesAgo", { count: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return format.dateTime(date, { hour: "2-digit", minute: "2-digit" });
  return format.dateTime(date, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * A length of time the way an agent reads it at a glance: "2d 4h", "3h 20m", "12m".
 * The SLA timer used to say "53h 10m", which asks the reader to divide by 24.
 */
export function formatDuration(ms: number, t: Translate): string {
  const minutes = Math.max(0, Math.floor(Math.abs(ms) / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days > 0) return t("detail.duration.days", { days, hours });
  if (hours > 0) return t("detail.duration.hours", { hours, minutes: rest });
  return t("detail.duration.minutes", { minutes: rest });
}

// ─── SLA ──────────────────────────────────────────────────────────────────────

/**
 * The two promises the SLA makes for this ticket.
 *
 * ⚠️ The stored deadlines first. They are what the breach job and the dashboard's
 * next actions read, and they are the only ones that know about business hours
 * and about a priority change re-starting the clock. This screen used to add the
 * policy's minutes to `createdAt` itself, so on a policy measured in working
 * hours it showed a different deadline from the one that would page somebody.
 * The sum stays only as the fallback for tickets older than those columns.
 */
export function slaDeadlines(ticket: TicketRow): { firstDue: Date | null; resolutionDue: Date | null } {
  const created = new Date(ticket.createdAt).getTime();
  const firstDue = ticket.firstResponseDueAt
    ? new Date(ticket.firstResponseDueAt)
    : ticket.sla
      ? new Date(created + ticket.sla.firstResponseTimeMinutes * 60_000)
      : null;
  const resolutionDue = ticket.slaDeadlineAt
    ? new Date(ticket.slaDeadlineAt)
    : ticket.sla
      ? new Date(created + ticket.sla.resolutionTimeMinutes * 60_000)
      : null;
  return { firstDue, resolutionDue };
}

export type SlaState = "breached" | "atRisk" | "paused" | "met" | "onTrack";

export const SLA_TONE: Record<SlaState, Tone> = {
  breached: "danger",
  atRisk: "warning",
  paused: "neutral",
  met: "success",
  onTrack: "neutral",
};

/**
 * Where the ticket stands against its SLA, or null when it has none.
 *
 * "At risk" is the same line the dashboard's next actions draw — a fifth of the
 * ticket's own window left — so a ticket that is flagged there is flagged here,
 * and nowhere else invents a second threshold.
 *
 * `now` is null until the page is mounted: the server and the browser disagree
 * about what time it is, and a badge that differed between them would be a
 * hydration mismatch. Until then only what the database already decided shows.
 */
export function slaStateOf(ticket: TicketRow, now: number | null): SlaState | null {
  const { firstDue, resolutionDue } = slaDeadlines(ticket);
  if (!firstDue && !resolutionDue) return null;
  if (ticket.slaBreachedAt || ticket.firstResponseBreachedAt) return "breached";

  const resolvedAt = ticket.resolvedAt ? new Date(ticket.resolvedAt).getTime() : null;
  if (resolvedAt !== null || ticket.status === "resolved" || ticket.status === "closed") {
    return resolutionDue && resolvedAt !== null && resolvedAt > resolutionDue.getTime() ? "breached" : "met";
  }
  if (ticket.slaPausedAt) return "paused";
  if (now === null) return null;

  const created = new Date(ticket.createdAt);
  const awaitingFirst = !ticket.firstResponseAt && firstDue;
  if (resolutionDue && resolutionDue.getTime() <= now) return "breached";
  if (awaitingFirst && firstDue.getTime() <= now) return "breached";
  const risky = (due: Date) => slaRemainingFraction(created, due, now) <= THRESHOLDS.slaRemainingFraction;
  if ((resolutionDue && risky(resolutionDue)) || (awaitingFirst && risky(firstDue))) return "atRisk";
  return "onTrack";
}
