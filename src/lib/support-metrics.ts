/**
 * Who on the desk is keeping the promises, from the tickets themselves (§12.2).
 *
 * Pure: the action reads the rows, this decides what they mean. Each figure says what it
 * counts, because every one of them has an easy wrong version:
 *
 * - **Solved** is a ticket resolved — or closed without a resolution — *and still so*. A
 *   reopened ticket has its `resolvedAt` cleared (statusStamps), so it is not a solve.
 * - **First answer on time** counts the tickets whose first answer *fell due* in the
 *   period: answered by then is met, answered later or still unanswered is missed. One
 *   not yet due is not counted either way — it has not had its chance to fail.
 * - **Resolved on time** counts the solves in the period that had a deadline, against the
 *   deadline moved by the time the clock was paused (waiting on the customer). The breach
 *   job's stamp counts too: it saw the ticket late while it was still open.
 * - **Satisfaction** is the answers given in the period, good over all; no answers is no
 *   figure, never 100%.
 *
 * ⚠️ Medians, not means: one ticket left over a holiday makes a mean describe nobody.
 */

export const OPEN_TICKET_STATUSES = ["new", "open", "in_progress", "waiting", "on_hold"] as const;
const SOLVED = ["resolved", "closed"];
export const PRIORITIES = ["urgent", "high", "normal", "low"] as const;

export interface TicketFacts {
  assigneeId: string | null;
  priority: string;
  status: string;
  createdAt: Date;
  firstResponseAt: Date | null;
  firstResponseDueAt: Date | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  slaDeadlineAt: Date | null;
  slaBreachedAt: Date | null;
  slaPauseMinutes: number | null;
  csatRating: string | null;
  csatRatedAt: Date | null;
}

export interface Ratio {
  met: number;
  total: number;
}

export interface AgentFigures {
  received: number;
  solved: number;
  openNow: number;
  firstResponseMedianMinutes: number | null;
  resolutionMedianMinutes: number | null;
  firstResponseOnTime: Ratio;
  resolutionOnTime: Ratio;
  /** Missed promises of either kind, by the ticket's priority. */
  missedByPriority: Record<string, number>;
  csat: { good: number; bad: number };
}

const MINUTE = 60_000;
const within = (d: Date | null, from: Date, to: Date) => d !== null && d >= from && d < to;

/** When a ticket stopped needing us: resolved, or closed without being resolved first. */
export function solvedAt(t: Pick<TicketFacts, "status" | "resolvedAt" | "closedAt">): Date | null {
  if (!SOLVED.includes(t.status)) return null;
  return t.resolvedAt ?? t.closedAt;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Whether the first answer kept its promise; null when it has not been put to the test yet. */
export function firstResponseKept(t: TicketFacts, now: Date): boolean | null {
  if (!t.firstResponseDueAt) return null;
  if (t.firstResponseAt) return t.firstResponseAt <= t.firstResponseDueAt;
  return t.firstResponseDueAt < now ? false : null;
}

/** Whether a solved ticket met its deadline, the paused time given back. Null without one. */
export function resolutionKept(t: TicketFacts): boolean | null {
  const at = solvedAt(t);
  if (!at || !t.slaDeadlineAt) return null;
  if (t.slaBreachedAt) return false;
  const deadline = t.slaDeadlineAt.getTime() + (t.slaPauseMinutes ?? 0) * MINUTE;
  return at.getTime() <= deadline;
}

function empty(): AgentFigures {
  return {
    received: 0,
    solved: 0,
    openNow: 0,
    firstResponseMedianMinutes: null,
    resolutionMedianMinutes: null,
    firstResponseOnTime: { met: 0, total: 0 },
    resolutionOnTime: { met: 0, total: 0 },
    missedByPriority: {},
    csat: { good: 0, bad: 0 },
  };
}

export function figuresFor(rows: readonly TicketFacts[], from: Date, to: Date, now: Date): AgentFigures {
  const f = empty();
  const firstTimes: number[] = [];
  const solveTimes: number[] = [];
  const miss = (priority: string) => {
    f.missedByPriority[priority] = (f.missedByPriority[priority] ?? 0) + 1;
  };
  for (const t of rows) {
    if (within(t.createdAt, from, to)) f.received++;
    if ((OPEN_TICKET_STATUSES as readonly string[]).includes(t.status)) f.openNow++;

    if (t.firstResponseAt && within(t.firstResponseAt, from, to)) {
      firstTimes.push((t.firstResponseAt.getTime() - t.createdAt.getTime()) / MINUTE);
    }
    if (within(t.firstResponseDueAt, from, to)) {
      const kept = firstResponseKept(t, now);
      if (kept !== null) {
        f.firstResponseOnTime.total++;
        if (kept) f.firstResponseOnTime.met++;
        else miss(t.priority);
      }
    }

    const at = solvedAt(t);
    if (at && within(at, from, to)) {
      f.solved++;
      solveTimes.push((at.getTime() - t.createdAt.getTime()) / MINUTE);
      const kept = resolutionKept(t);
      if (kept !== null) {
        f.resolutionOnTime.total++;
        if (kept) f.resolutionOnTime.met++;
        else miss(t.priority);
      }
    }

    if (within(t.csatRatedAt, from, to)) {
      if (t.csatRating === "good") f.csat.good++;
      else if (t.csatRating === "bad") f.csat.bad++;
    }
  }
  f.firstResponseMedianMinutes = median(firstTimes);
  f.resolutionMedianMinutes = median(solveTimes);
  return f;
}

/** Figures per assignee — the unassigned under `null` — and the whole desk. */
export function agentReport(
  rows: readonly TicketFacts[],
  from: Date,
  to: Date,
  now: Date,
): { team: AgentFigures; agents: { assigneeId: string | null; figures: AgentFigures }[] } {
  const byAgent = new Map<string | null, TicketFacts[]>();
  for (const t of rows) byAgent.set(t.assigneeId, [...(byAgent.get(t.assigneeId) ?? []), t]);
  const agents = [...byAgent.entries()].map(([assigneeId, list]) => ({
    assigneeId,
    figures: figuresFor(list, from, to, now),
  }));
  return { team: figuresFor(rows, from, to, now), agents };
}

/**
 * How many tickets were open at the end of each week — what the desk carried. A ticket is
 * open at a moment when it had arrived and was not yet solved.
 *
 * ⚠️ Reconstructed from the timestamps, not from a log: a ticket reopened and solved again
 * counts as open from its arrival to its last solve, which is what a reader expects.
 */
export function backlogSeries(rows: readonly TicketFacts[], ends: readonly Date[]): { at: Date; open: number }[] {
  return ends.map((at) => ({
    at,
    open: rows.filter((t) => {
      if (t.createdAt > at) return false;
      const solved = solvedAt(t);
      return !solved || solved > at;
    }).length,
  }));
}

export const ratio = (r: Ratio): number | null => (r.total === 0 ? null : r.met / r.total);
export const csatScore = (c: { good: number; bad: number }): number | null =>
  c.good + c.bad === 0 ? null : c.good / (c.good + c.bad);
