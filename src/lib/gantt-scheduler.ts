import { addBusinessDays, differenceInBusinessDays, isWeekend, startOfDay, subBusinessDays } from "date-fns";

import type { SvarLink, SvarTask } from "@/stores/gantt-store";

// ─── Working-days calendar (Mon–Fri) ─────────────────────────────────────────

/**
 * Advances `from` by `n` working days (Mon–Fri).
 * n = 0: returns `from` clamped to the current-or-next working day.
 * n > 0: advances n working days forward.
 * n < 0: see subWorkingDays.
 */
export function addWorkingDays(from: Date, n: number): Date {
  const d = startOfDay(from);
  if (n === 0) return isWeekend(d) ? addBusinessDays(d, 1) : d;
  return addBusinessDays(d, n);
}

/**
 * Moves `from` back by `n` working days.
 * n = 0: returns `from` clamped to the current-or-previous working day.
 */
export function subWorkingDays(from: Date, n: number): Date {
  const d = startOfDay(from);
  if (n === 0) return isWeekend(d) ? subBusinessDays(d, 1) : d;
  return subBusinessDays(d, n);
}

/**
 * Inclusive working-day count between two dates.
 * workingDuration(Monday, Friday) = 5.
 */
export function workingDuration(start: Date, end: Date): number {
  const s = addWorkingDays(start, 0);
  const e = addWorkingDays(end, 0);
  if (s >= e) return 1;
  return Math.max(1, differenceInBusinessDays(e, s) + 1);
}

// ─── Per-type constraint computation ─────────────────────────────────────────

/**
 * Given a predecessor and a link, returns the new start/end dates for the
 * successor so that the dependency constraint is satisfied. The successor's
 * working-day duration is preserved.
 *
 * lagDays semantics (working days):
 *   0 → events can coincide (same working day)
 *   1 → one working-day gap
 *   n → n working-day gap
 *
 * FS: succ.start  = pred.end  + lagDays working days
 * SS: succ.start  = pred.start + lagDays working days
 * FF: succ.end    = pred.end  + lagDays working days  (duration preserved)
 * SF: succ.end    = pred.start + lagDays working days (duration preserved)
 */
function computeConstraint(pred: SvarTask, succ: SvarTask, link: SvarLink): { newStart: Date; newEnd: Date } {
  const dur = workingDuration(succ.start_date, succ.end_date);

  switch (link.depType) {
    case "FS": {
      const newStart = addWorkingDays(pred.end_date, link.lagDays);
      const newEnd = addBusinessDays(newStart, dur - 1);
      return { newStart, newEnd };
    }
    case "SS": {
      const newStart = addWorkingDays(pred.start_date, link.lagDays);
      const newEnd = addBusinessDays(newStart, dur - 1);
      return { newStart, newEnd };
    }
    case "FF": {
      const newEnd = addWorkingDays(pred.end_date, link.lagDays);
      const newStart = subWorkingDays(newEnd, dur - 1);
      return { newStart, newEnd };
    }
    case "SF": {
      const newEnd = addWorkingDays(pred.start_date, link.lagDays);
      const newStart = subWorkingDays(newEnd, dur - 1);
      return { newStart, newEnd };
    }
  }
}

// ─── Recursive scheduler ──────────────────────────────────────────────────────

/**
 * Pure function. Walks all outgoing dependency links of `movedTaskId` and
 * recomputes start/end for each direct successor, then recurses.
 *
 * Returns a new tasks array — inputs are never mutated.
 *
 * The `visited` set prevents infinite loops on cyclic graphs (which the DB
 * already prevents, but we defend against stale link data).
 *
 * Known limitation: when a task has multiple predecessors (diamond pattern),
 * the last-processed predecessor wins. A future improvement could sort tasks
 * topologically before applying constraints.
 */
export function scheduleSuccessors(
  movedTaskId: string,
  tasks: SvarTask[],
  links: SvarLink[],
  visited: Set<string> = new Set(),
): SvarTask[] {
  if (visited.has(movedTaskId)) return tasks;
  visited.add(movedTaskId);

  const outgoing = links.filter((l) => l.source === movedTaskId);
  if (outgoing.length === 0) return tasks;

  let current = tasks;

  for (const link of outgoing) {
    if (visited.has(link.target)) continue;

    const pred = current.find((t) => t.id === movedTaskId);
    const succ = current.find((t) => t.id === link.target);
    if (!pred || !succ) continue;

    const { newStart, newEnd } = computeConstraint(pred, succ, link);
    const newDuration = Math.max(1, Math.round((newEnd.getTime() - newStart.getTime()) / 86400000));

    current = current.map((t) =>
      t.id === link.target ? { ...t, start_date: newStart, end_date: newEnd, duration: newDuration } : t,
    );

    current = scheduleSuccessors(link.target, current, links, visited);
  }

  return current;
}
