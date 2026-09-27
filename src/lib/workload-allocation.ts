/**
 * How many hours a person has on each working day — one rule, read by the workload page
 * (src/actions/workload.ts) and by the panel beside the Gantt, pure so both can run it.
 *
 * ⚠️⚠️ There were two copies, and they answered differently (§11.1). The page gave a task
 * with no estimate one hour and the panel ignored it; the page counted the people
 * responsible beside the assignee and the panel did not; the page skipped parent tasks,
 * whose work is their subtasks', and the panel counted it twice; neither left out the tasks
 * already done. So the same person was overloaded on one screen and free on the other.
 *
 * ⚠️⚠️ Days are calendar dates, `YYYY-MM-DD`, never instants. The page used to send the
 * browser's local midnights to a server on UTC and key the cells with `toISOString()`, so
 * in Rome every cell sat one day to the left of its column. The caller turns a task's
 * dates into days on the workspace's clock (the server) or the person's (the panel); from
 * there on nothing here has a time zone.
 *
 * The rules:
 * - a task's hours are its estimate, or `DEFAULT_TASK_HOURS` without one — unestimated work
 *   is still work, and nothing makes a person look free like leaving the field empty;
 * - spread evenly over the working days from its start to its due date; with no start, on
 *   the due date alone, so the figure does not depend on where the view happens to begin;
 * - to the assignee and everybody else responsible for it;
 * - a task that is another's parent carries none: its subtasks do;
 * - a task already done carries none.
 */

export const DAILY_CAPACITY_HOURS = 8;
export const DEFAULT_TASK_HOURS = 1;

export interface WorkloadTask {
  id: string;
  /** Calendar days, `YYYY-MM-DD`. */
  startDay: string | null;
  dueDay: string | null;
  estimatedHours: number | null;
  /** The assignee and the other people responsible, in any order, duplicates allowed. */
  people: readonly (string | null | undefined)[];
  parentId: string | null;
  status?: string | null;
}

export interface DayLoad {
  hours: number;
  tasks: { id: string; hours: number; estimatedHours: number }[];
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A local date as `YYYY-MM-DD`, for a browser building its own days. */
export function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function nextDay(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return t.toISOString().slice(0, 10);
}

function isWeekend(key: string): boolean {
  const [y, m, d] = key.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 || dow === 6;
}

/** Monday to Friday from `from` to `to`, both included (bounded at ten years, against a typo). */
export function workingDayKeys(from: string, to: string): string[] {
  if (!DAY.test(from) || !DAY.test(to)) return [];
  const out: string[] = [];
  for (let d = from, guard = 0; d <= to && guard < 3700; d = nextDay(d), guard++) {
    if (!isWeekend(d)) out.push(d);
  }
  return out;
}

/** Per person, per day within `days`, the hours and the tasks they come from. */
export function allocateWorkload(
  tasks: readonly WorkloadTask[],
  days: readonly string[],
  /** Every task that has a subtask, when `tasks` is not all of them (a window of them). */
  parentIds?: ReadonlySet<string>,
): Map<string, Map<string, DayLoad>> {
  const visible = new Set(days);
  const parents = parentIds ?? new Set(tasks.map((t) => t.parentId).filter((p): p is string => !!p));
  const out = new Map<string, Map<string, DayLoad>>();

  for (const task of tasks) {
    if (!task.dueDay || parents.has(task.id) || task.status === "done") continue;
    const people = [...new Set(task.people.filter((p): p is string => !!p))];
    if (people.length === 0) continue;
    const start = task.startDay && task.startDay <= task.dueDay ? task.startDay : task.dueDay;
    const span = workingDayKeys(start, task.dueDay);
    if (span.length === 0) continue;
    const estimate = task.estimatedHours ?? DEFAULT_TASK_HOURS;
    // Divided by the whole span, so a task only partly in view does not look heavier.
    const perDay = Math.round((estimate / span.length) * 100) / 100;

    for (const day of span) {
      if (!visible.has(day)) continue;
      for (const person of people) {
        let byDay = out.get(person);
        if (!byDay) {
          byDay = new Map();
          out.set(person, byDay);
        }
        const cell = byDay.get(day) ?? { hours: 0, tasks: [] };
        cell.hours = Math.round((cell.hours + perDay) * 100) / 100;
        cell.tasks.push({ id: task.id, hours: perDay, estimatedHours: estimate });
        byDay.set(day, cell);
      }
    }
  }
  return out;
}

/** Days above capacity, counted per person and day. */
export function countOverloads(load: Map<string, Map<string, DayLoad>>): number {
  let n = 0;
  for (const byDay of load.values()) for (const cell of byDay.values()) if (cell.hours > DAILY_CAPACITY_HOURS) n++;
  return n;
}
