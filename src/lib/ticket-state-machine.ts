const VALID_TRANSITIONS: Record<string, string[]> = {
  new: ["open", "in_progress", "closed"],
  open: ["in_progress", "waiting", "on_hold", "resolved", "closed"],
  in_progress: ["waiting", "on_hold", "resolved", "closed", "open"],
  waiting: ["open", "in_progress", "on_hold", "resolved", "closed"],
  on_hold: ["open", "in_progress", "waiting", "resolved", "closed"],
  resolved: ["open", "closed"],
  closed: [],
};

export function canTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isSLAPauseStatus(status: string): boolean {
  return status === "waiting" || status === "on_hold";
}

export const TICKET_STATUSES = Object.keys(VALID_TRANSITIONS);

export interface StatusStamps {
  status: string;
  resolvedAt?: Date | null;
  closedAt?: Date;
  slaPausedAt?: Date | null;
  slaPauseMinutes?: number;
}

/**
 * What moving a ticket to `next` writes, or null when the move is not allowed.
 *
 * ⚠️⚠️ One rule for every way a status changes. The kanban drag had its own copy, and
 * it skipped the owner check, the rules and everything that follows a resolution.
 *
 * ⚠️ Reopening clears `resolvedAt`. It used to survive, so a reopened ticket still
 * counted as resolved, and its resolution time was measured to the first attempt
 * rather than to the one that stuck.
 */
export function statusStamps(
  ticket: { status: string; slaPausedAt: Date | null; slaPauseMinutes: number | null },
  next: string,
  now: Date,
): StatusStamps | null {
  if (!canTransition(ticket.status, next)) return null;
  const stamps: StatusStamps = { status: next };
  if (next === "resolved") stamps.resolvedAt = now;
  else if (ticket.status === "resolved" && next !== "closed") stamps.resolvedAt = null;
  if (next === "closed") stamps.closedAt = now;

  if (isSLAPauseStatus(next) && !ticket.slaPausedAt) {
    stamps.slaPausedAt = now;
  } else if (!isSLAPauseStatus(next) && ticket.slaPausedAt) {
    const pausedMs = now.getTime() - ticket.slaPausedAt.getTime();
    stamps.slaPauseMinutes = (ticket.slaPauseMinutes ?? 0) + Math.floor(pausedMs / 60000);
    stamps.slaPausedAt = null;
  }
  return stamps;
}

/** A move into "resolved" from anything else: the moment the customer is told, and asked. */
export function becameResolved(from: string, to: string): boolean {
  return to === "resolved" && from !== "resolved";
}
