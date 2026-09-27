"use server";

import { revalidatePath } from "next/cache";

import { and, eq, gte, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";

import { taskAssignees, taskDependencies, tasks, users } from "@/db/schema";
import { requireCapability } from "@/lib/auth-guard";
import { serverT } from "@/lib/i18n-server";
import { getDb } from "@/lib/tenant-context";
import { addDaysToDate, fromWallValue, toWallDate } from "@/lib/wall-clock";
import { allocateWorkload, DAILY_CAPACITY_HOURS, workingDayKeys } from "@/lib/workload-allocation";
import { getWorkspaceTimeZone } from "@/lib/workspace-time-zone";

// ─── Types ────────────────────────────────────────────────────────────────────

export type WorkloadTaskEntry = {
  id: string;
  title: string;
  hours: number; // per-day allocation within the view window
  estimatedHours: number;
  startDate: string | null;
  dueDate: string;
};

export type WorkloadCell = {
  hours: number;
  capacity: number;
  tasks: WorkloadTaskEntry[];
};

export type WorkloadRow = {
  userId: string;
  userName: string;
  days: Record<string, WorkloadCell>; // calendar day (YYYY-MM-DD) → cell
};

// ─── Actions ──────────────────────────────────────────────────────────────────

/**
 * Hours per person per working day from `from` to `to` (calendar days, `YYYY-MM-DD`),
 * by the rule in src/lib/workload-allocation.ts. A task's dates become days on the
 * workspace's clock: on Workers the server is UTC, and a task due at 00:30 in Rome is due
 * that day, not the one before.
 */
export async function getWorkloadMatrix(from: string, to: string): Promise<WorkloadRow[]> {
  await requireCapability("report:read");
  const days = workingDayKeys(from, to);
  if (days.length === 0) return [];
  const db = await getDb();
  const timeZone = await getWorkspaceTimeZone();
  const windowStart = fromWallValue(from, timeZone);
  const windowEnd = fromWallValue(addDaysToDate(to, 1), timeZone);
  if (!windowStart || !windowEnd) return [];

  const taskList = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      startDate: tasks.startDate,
      dueDate: tasks.dueDate,
      estimatedHours: tasks.estimatedHours,
      assigneeId: tasks.assigneeId,
      parentId: tasks.parentId,
      status: tasks.status,
    })
    .from(tasks)
    // Overlaps the window: due on or after its start, and started (if at all) before its end.
    .where(
      and(
        isNotNull(tasks.dueDate),
        gte(tasks.dueDate, windowStart),
        or(isNull(tasks.startDate), lt(tasks.startDate, windowEnd)),
      ),
    );

  const taskIds = taskList.map((t) => t.id);
  const [raciAll, parentRows] = await Promise.all([
    taskIds.length > 0
      ? db
          .select({ taskId: taskAssignees.taskId, userId: taskAssignees.userId })
          .from(taskAssignees)
          .where(inArray(taskAssignees.taskId, taskIds))
      : Promise.resolve([] as { taskId: string; userId: string }[]),
    // Parents across every task, not only this window: a parent whose subtasks fall in view
    // may itself start before it.
    db
      .selectDistinct({ id: tasks.parentId })
      .from(tasks)
      .where(isNotNull(tasks.parentId)),
  ]);

  const raciByTask: Record<string, string[]> = {};
  for (const r of raciAll) raciByTask[r.taskId] = [...(raciByTask[r.taskId] ?? []), r.userId];

  const dayOf = (d: Date | null) => (d ? toWallDate(new Date(d), timeZone) : null);
  const byId = new Map(taskList.map((t) => [t.id, t]));
  const load = allocateWorkload(
    taskList.map((t) => ({
      id: t.id,
      startDay: dayOf(t.startDate),
      dueDay: dayOf(t.dueDate),
      estimatedHours: t.estimatedHours ? parseFloat(t.estimatedHours) : null,
      people: [t.assigneeId, ...(raciByTask[t.id] ?? [])],
      parentId: t.parentId,
      status: t.status,
    })),
    days,
    new Set(parentRows.map((r: { id: string | null }) => r.id as string)),
  );

  const allUsers = await db.select({ id: users.id, name: users.name }).from(users);
  return allUsers
    .filter((u: { id: string }) => load.has(u.id))
    .map((u: { id: string; name: string | null }) => {
      const cells: Record<string, WorkloadCell> = {};
      for (const day of days) {
        const cell = load.get(u.id)?.get(day);
        cells[day] = {
          hours: cell?.hours ?? 0,
          capacity: DAILY_CAPACITY_HOURS,
          tasks: (cell?.tasks ?? []).map((entry) => {
            const task = byId.get(entry.id);
            return {
              ...entry,
              title: task?.title ?? "",
              startDate: dayOf(task?.startDate ?? null),
              dueDate: dayOf(task?.dueDate ?? null) ?? "",
            };
          }),
        };
      }
      return { userId: u.id, userName: u.name ?? u.id, days: cells };
    });
}

export async function rescheduleTaskDueDate(
  taskId: string,
  newDueDate: Date,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { requireWriteAccess } = await import("@/lib/auth-guard");
    await requireWriteAccess();
    const db = await getDb();
    await db.update(tasks).set({ dueDate: newDueDate }).where(eq(tasks.id, taskId));
    revalidatePath("/dashboard/tasks/workload");
    revalidatePath("/dashboard/tasks");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : (await serverT())("generic.unknown") };
  }
}

export async function autoScheduleChain(rootTaskId: string): Promise<{ rescheduled: string[]; conflicts: string[] }> {
  const { requireWriteAccess } = await import("@/lib/auth-guard");
  await requireWriteAccess();
  const db = await getDb();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const visited = new Set<string>();
  const queue = [rootTaskId];
  const rescheduled: string[] = [];
  const conflicts: string[] = [];

  while (queue.length > 0) {
    const cur = queue.shift();
    if (!cur || visited.has(cur)) continue;
    visited.add(cur);

    const [task] = await db
      .select({ id: tasks.id, dueDate: tasks.dueDate, status: tasks.status })
      .from(tasks)
      .where(eq(tasks.id, cur));

    if (!task || task.status === "done" || !task.dueDate) continue;

    const due = new Date(task.dueDate);
    if (due < today) {
      // reschedule to today (not today + overdue days — that would push further into future)
      await db
        .update(tasks)
        .set({ dueDate: new Date(today) })
        .where(eq(tasks.id, cur));
      rescheduled.push(cur);
    }

    const successors = await db
      .select({ successorId: taskDependencies.successorId })
      .from(taskDependencies)
      .where(and(eq(taskDependencies.predecessorId, cur), eq(taskDependencies.type, "FS")));

    for (const s of successors) queue.push(s.successorId);
  }

  return { rescheduled, conflicts };
}
