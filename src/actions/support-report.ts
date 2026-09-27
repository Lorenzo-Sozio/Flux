"use server";

import { revalidatePath } from "next/cache";

import { and, gte, inArray, lt, or, sql } from "drizzle-orm";

import { tickets, users } from "@/db/schema";
import { requireCapability, requirePlanModule } from "@/lib/auth-guard";
import { currentPeriodKey, parsePeriodKey, periodBounds, periodKey } from "@/lib/calendar-period";
import {
  type AgentFigures,
  agentReport,
  backlogSeries,
  OPEN_TICKET_STATUSES,
  type TicketFacts,
} from "@/lib/support-metrics";
import { getDb } from "@/lib/tenant-context";
import { csatEnabled, setCsatEnabled } from "@/lib/ticket-public";
import { getWorkspaceTimeZone } from "@/lib/workspace-time-zone";

const DAY = 86_400_000;
const BACKLOG_WEEKS = 8;
/** A month of a busy desk is a few thousand tickets; this is a ceiling, not a page size. */
const ROW_CAP = 20_000;

export interface SupportAgentReport {
  period: string;
  team: AgentFigures;
  agents: { assigneeId: string | null; name: string | null; figures: AgentFigures }[];
  backlog: { at: string; open: number }[];
  csatEnabled: boolean;
  truncated: boolean;
}

/**
 * The desk by person for a month, quarter or year (§12.2): what arrived, what was solved,
 * how fast, which promises were kept, and what the customers said. Rules in
 * src/lib/support-metrics.ts; this only decides which rows can matter.
 */
export async function getSupportAgentReport(input: { period?: string | null } = {}): Promise<SupportAgentReport> {
  await requireCapability("report:read");
  await requirePlanModule("support");
  const [db, timeZone] = await Promise.all([getDb(), getWorkspaceTimeZone()]);
  const now = new Date();
  const parsed = parsePeriodKey(input.period);
  const period = parsed ? periodKey(parsed) : currentPeriodKey("month", now, timeZone);
  const bounds = periodBounds(period, timeZone) ?? { from: now, to: now };

  // The backlog is read at the end of each of the last weeks up to the period's end.
  const last = new Date(Math.min(now.getTime(), bounds.to.getTime()));
  const ends = Array.from(
    { length: BACKLOG_WEEKS },
    (_, i) => new Date(last.getTime() - (BACKLOG_WEEKS - 1 - i) * 7 * DAY),
  );
  const lower = new Date(Math.min(bounds.from.getTime(), ends[0].getTime()));

  // Every ticket that can move a figure: open now, or touched by an event since `lower`.
  const rows = await db
    .select({
      assigneeId: tickets.assigneeId,
      priority: tickets.priority,
      status: tickets.status,
      createdAt: tickets.createdAt,
      firstResponseAt: tickets.firstResponseAt,
      firstResponseDueAt: tickets.firstResponseDueAt,
      resolvedAt: tickets.resolvedAt,
      closedAt: tickets.closedAt,
      slaDeadlineAt: tickets.slaDeadlineAt,
      slaBreachedAt: tickets.slaBreachedAt,
      slaPauseMinutes: tickets.slaPauseMinutes,
      csatRating: tickets.csatRating,
      csatRatedAt: tickets.csatRatedAt,
    })
    .from(tickets)
    .where(
      and(
        lt(tickets.createdAt, bounds.to),
        or(
          inArray(tickets.status, [...OPEN_TICKET_STATUSES]),
          gte(tickets.createdAt, lower),
          gte(sql`coalesce(${tickets.resolvedAt}, ${tickets.closedAt})`, lower),
          gte(tickets.firstResponseDueAt, lower),
          gte(tickets.csatRatedAt, lower),
        ),
      ),
    )
    .limit(ROW_CAP + 1);

  const facts = rows.slice(0, ROW_CAP) as TicketFacts[];
  const report = agentReport(facts, bounds.from, bounds.to, now);
  const people = await db.select({ id: users.id, name: users.name, email: users.email }).from(users);
  const nameOf = new Map(people.map((p) => [p.id, p.name ?? p.email]));

  return {
    period,
    team: report.team,
    agents: report.agents
      .map((a) => ({ ...a, name: a.assigneeId ? (nameOf.get(a.assigneeId) ?? null) : null }))
      // Busiest first: the person carrying the desk is the row a reader looks for.
      .sort((a, b) => b.figures.received + b.figures.solved - (a.figures.received + a.figures.solved)),
    backlog: backlogSeries(facts, ends).map((p) => ({ at: p.at.toISOString(), open: p.open })),
    csatEnabled: await csatEnabled(db),
    truncated: rows.length > ROW_CAP,
  };
}

// ─── The switch ──────────────────────────────────────────────────────────────

export async function getCsatSetting(): Promise<{ enabled: boolean }> {
  await requireCapability("sla:manage");
  return { enabled: await csatEnabled(await getDb()) };
}

/** Whether a resolved ticket emails the customer and asks how it went (src/lib/ticket-public.ts). */
export async function setCsatSettingAction(enabled: boolean): Promise<{ ok: true }> {
  await requireCapability("sla:manage");
  await setCsatEnabled(await getDb(), Boolean(enabled));
  revalidatePath("/dashboard/support/sla");
  revalidatePath("/dashboard/support");
  return { ok: true };
}
