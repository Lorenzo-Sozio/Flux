"use server";

import { revalidatePath } from "next/cache";

import { and, eq, gte, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";

import { taskAssignees, taskDependencies, tasks, users } from "@/db/schema";
import { getDb } from "@/lib/tenant-context";

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
  days: Record<string, WorkloadCell>; // ISO date string → cell
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getWorkingDays(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  const d = new Date(start);
  d.setHours(0, 0, 0, 0);
  const e = new Date(end);
  e.setHours(0, 0, 0, 0);
  while (d <= e) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export async function getWorkloadMatrix(startDate: Date, endDate: Date): Promise<WorkloadRow[]> {
  const db = await getDb();
  const taskList = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      startDate: tasks.startDate,
      dueDate: tasks.dueDate,
      estimatedHours: tasks.estimatedHours,
      assigneeId: tasks.assigneeId,
      parentId: tasks.parentId,
    })
    .from(tasks)
    // overlap: task overlaps [startDate, endDate] iff dueDate >= startDate AND (startDate IS NULL OR startDate <= endDate)
    .where(
      and(
        isNotNull(tasks.dueDate),
        gte(tasks.dueDate, startDate),
        or(isNull(tasks.startDate), lte(tasks.startDate, endDate)),
      ),
    );

  const taskIds = taskList.map((t) => t.id);

  const raciAll =
    taskIds.length > 0
      ? await db
          .select({ taskId: taskAssignees.taskId, userId: taskAssignees.userId })
          .from(taskAssignees)
          .where(inArray(taskAssignees.taskId, taskIds))
      : [];

  const raciByTask: Record<string, string[]> = {};
  for (const r of raciAll) {
    if (!raciByTask[r.taskId]) raciByTask[r.taskId] = [];
    raciByTask[r.taskId].push(r.userId);
  }

  const userIdSet = new Set<string>();
  for (const t of taskList) {
    if (t.assigneeId) userIdSet.add(t.assigneeId);
    for (const uid of raciByTask[t.id] ?? []) userIdSet.add(uid);
  }

  const allUsers = await db.select({ id: users.id, name: users.name }).from(users);
  const displayUsers = allUsers.filter((u) => userIdSet.has(u.id));

  const capacity = 8;
  const allDays = getWorkingDays(startDate, endDate);

  const matrix: Record<string, Record<string, WorkloadCell>> = {};
  for (const u of displayUsers) {
    matrix[u.id] = {};
    for (const d of allDays) {
      matrix[u.id][toDateStr(d)] = { hours: 0, capacity, tasks: [] };
    }
  }

  // Tasks whose ID appears as parentId of another task are "containers" — skip them
  // to avoid double-counting (their work is represented by their subtasks)
  const parentTaskIds = new Set(taskList.map((t) => t.parentId).filter(Boolean));

  for (const task of taskList) {
    if (parentTaskIds.has(task.id)) continue;
    const estH = task.estimatedHours ? parseFloat(task.estimatedHours) : 1; // default 1h when no estimate

    // biome-ignore lint/style/noNonNullAssertion: filtered by isNotNull above
    const end = new Date(task.dueDate!);
    const start = task.startDate ? new Date(task.startDate) : new Date(startDate);
    const allDayStrs = new Set(allDays.map(toDateStr));
    const totalWorkDays = getWorkingDays(start, end);
    const visibleWorkDays = totalWorkDays.filter((d) => allDayStrs.has(toDateStr(d)));
    if (visibleWorkDays.length === 0) continue;

    // divide by TOTAL span so partially-visible tasks don't inflate the daily rate
    const hoursPerDay = estH / totalWorkDays.length;
    const assignedUsers = new Set<string>();
    if (task.assigneeId) assignedUsers.add(task.assigneeId);
    for (const uid of raciByTask[task.id] ?? []) assignedUsers.add(uid);

    for (const uid of assignedUsers) {
      if (!matrix[uid]) continue;
      for (const d of visibleWorkDays) {
        const ds = toDateStr(d);
        if (!matrix[uid][ds]) continue;
        matrix[uid][ds].hours = Math.round((matrix[uid][ds].hours + hoursPerDay) * 100) / 100;
        matrix[uid][ds].tasks.push({
          id: task.id,
          title: task.title,
          hours: Math.round(hoursPerDay * 100) / 100,
          estimatedHours: estH,
          startDate: task.startDate ? toDateStr(new Date(task.startDate)) : null,
          // biome-ignore lint/style/noNonNullAssertion: filtered above
          dueDate: toDateStr(new Date(task.dueDate!)),
        });
      }
    }
  }

  return displayUsers.map((u) => ({
    userId: u.id,
    userName: u.name ?? u.id,
    days: matrix[u.id] ?? {},
  }));
}

export type WorkloadConflict = {
  userId: string;
  userName: string;
  date: string;
  hours: number;
  capacity: number;
  tasks: WorkloadTaskEntry[];
};

export async function getWorkloadConflicts(startDate: Date, endDate: Date): Promise<WorkloadConflict[]> {
  const matrix = await getWorkloadMatrix(startDate, endDate);
  const conflicts: WorkloadConflict[] = [];
  for (const row of matrix) {
    for (const [date, cell] of Object.entries(row.days)) {
      if (cell.hours > cell.capacity) {
        conflicts.push({ userId: row.userId, userName: row.userName, date, ...cell });
      }
    }
  }
  return conflicts.sort((a, b) => a.date.localeCompare(b.date));
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
    return { success: false, error: err instanceof Error ? err.message : "Errore sconosciuto" };
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
