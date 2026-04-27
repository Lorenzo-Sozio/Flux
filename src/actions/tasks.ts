"use server";

import { revalidatePath } from "next/cache";

import { and, desc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { createNotificationAction } from "@/actions/auth";
import { dispatchWebhook } from "@/actions/webhooks";
import { db } from "@/db";
import {
  activities,
  companies,
  contacts,
  leads,
  taskAssignees,
  taskDependencies,
  tasks,
  taskTimeLogs,
  tickets,
  users,
} from "@/db/schema";
import { requireWriteAccess } from "@/lib/auth-guard";

export async function createTask(data: {
  title: string;
  description?: string;
  dueDate?: Date;
  startDate?: Date;
  status?: string;
  priority?: string;
  ownerId?: string;
  assigneeId?: string;
  parentId?: string;
  leadId?: string;
  contactId?: string;
  companyId?: string;
  dealId?: string;
  ticketId?: string;
  estimatedHours?: string;
}) {
  await requireWriteAccess();
  let depth = 0;
  if (data.parentId) {
    const parent = await db.select({ depth: tasks.depth }).from(tasks).where(eq(tasks.id, data.parentId)).limit(1);
    if (!parent[0]) throw new Error("Parent task not found");
    depth = (parent[0].depth ?? 0) + 1;
    if (depth > 3) throw new Error("Maximum subtask depth (3) reached");
  }
  const result = await db
    .insert(tasks)
    .values({ ...data, depth })
    .returning();
  if (data.leadId) revalidatePath(`/dashboard/leads/${data.leadId}`);
  if (data.contactId) revalidatePath(`/dashboard/contacts/${data.contactId}`);
  if (data.companyId) revalidatePath(`/dashboard/companies/${data.companyId}`);
  if (data.ticketId) revalidatePath(`/dashboard/support/tickets/${data.ticketId}`);
  if (data.parentId) await recalcParentProgress(data.parentId);
  revalidatePath("/dashboard/tasks");
  revalidatePath("/dashboard/calendar");
  return result[0];
}

export async function createSubtask(
  parentId: string,
  data: {
    title: string;
    description?: string;
    dueDate?: Date;
    priority?: string;
    ownerId?: string;
    assigneeId?: string;
  },
) {
  return createTask({ ...data, parentId });
}

export async function recalcParentProgress(taskId: string): Promise<void> {
  const children = await db.select({ status: tasks.status }).from(tasks).where(eq(tasks.parentId, taskId));
  if (children.length === 0) return;
  const done = children.filter((c) => c.status === "done").length;
  const pct = Math.round((done / children.length) * 100);
  await db.update(tasks).set({ progressPct: pct }).where(eq(tasks.id, taskId));
  // propagate up
  const parent = await db.select({ parentId: tasks.parentId }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (parent[0]?.parentId) await recalcParentProgress(parent[0].parentId);
}

export async function getSubtasks(parentId: string) {
  const creator = alias(users, "creator");
  const assignee = alias(users, "assignee");
  return await db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      dueDate: tasks.dueDate,
      status: tasks.status,
      priority: tasks.priority,
      depth: tasks.depth,
      progressPct: tasks.progressPct,
      parentId: tasks.parentId,
      estimatedHours: tasks.estimatedHours,
      actualHours: tasks.actualHours,
      createdAt: tasks.createdAt,
      completedAt: tasks.completedAt,
      ownerName: creator.name,
      assigneeName: assignee.name,
    })
    .from(tasks)
    .leftJoin(creator, eq(tasks.ownerId, creator.id))
    .leftJoin(assignee, eq(tasks.assigneeId, assignee.id))
    .where(eq(tasks.parentId, parentId))
    .orderBy(tasks.createdAt);
}

export async function addTaskAssignee(taskId: string, userId: string, role: string) {
  await requireWriteAccess();
  const existing = await db
    .select({ id: taskAssignees.id })
    .from(taskAssignees)
    .where(and(eq(taskAssignees.taskId, taskId), eq(taskAssignees.userId, userId)))
    .limit(1);
  if (existing[0]) {
    await db.update(taskAssignees).set({ role }).where(eq(taskAssignees.id, existing[0].id));
  } else {
    await db.insert(taskAssignees).values({ taskId, userId, role });
  }
}

export async function removeTaskAssignee(taskId: string, userId: string) {
  await requireWriteAccess();
  await db.delete(taskAssignees).where(and(eq(taskAssignees.taskId, taskId), eq(taskAssignees.userId, userId)));
}

export async function getTaskAssignees(taskId: string) {
  return await db
    .select({
      id: taskAssignees.id,
      userId: taskAssignees.userId,
      role: taskAssignees.role,
      userName: users.name,
    })
    .from(taskAssignees)
    .leftJoin(users, eq(taskAssignees.userId, users.id))
    .where(eq(taskAssignees.taskId, taskId));
}

export async function getTasksByLead(leadId: string) {
  return await getTasksGeneric({ leadId });
}

export async function getTasksByContact(contactId: string) {
  return await getTasksGeneric({ contactId });
}

export async function getTasksByCompany(companyId: string) {
  return await getTasksGeneric({ companyId });
}

export async function getTasksByDeal(dealId: string) {
  return await getTasksGeneric({ dealId });
}

async function getTasksGeneric(where: { leadId?: string; contactId?: string; companyId?: string; dealId?: string }) {
  const creator = alias(users, "creator");
  const assignee = alias(users, "assignee");

  let query = db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      dueDate: tasks.dueDate,
      status: tasks.status,
      priority: tasks.priority,
      createdAt: tasks.createdAt,
      completedAt: tasks.completedAt,
      ownerName: creator.name,
      assigneeName: assignee.name,
    })
    .from(tasks)
    .leftJoin(creator, eq(tasks.ownerId, creator.id))
    .leftJoin(assignee, eq(tasks.assigneeId, assignee.id));

  if (where.leadId) {
    query = query.where(eq(tasks.leadId, where.leadId)) as any;
  } else if (where.contactId) {
    query = query.where(eq(tasks.contactId, where.contactId)) as any;
  } else if (where.companyId) {
    query = query.where(eq(tasks.companyId, where.companyId)) as any;
  } else if (where.dealId) {
    query = query.where(eq(tasks.dealId, where.dealId)) as any;
  }

  return await query.orderBy(desc(tasks.createdAt));
}

export async function updateTask(id: string, data: Partial<typeof tasks.$inferInsert>, revalidatePathStr?: string) {
  await requireWriteAccess();
  const result = await db.update(tasks).set(data).where(eq(tasks.id, id)).returning();
  if (revalidatePathStr) revalidatePath(revalidatePathStr);
  revalidatePath("/dashboard/calendar");
  return result[0];
}

export async function updateTaskStatus(id: string, status: string, revalidatePathStr?: string) {
  await requireWriteAccess();
  if (status === "done") {
    const blocking = await checkDependencyViolation(id);
    if (blocking.length > 0) {
      throw new Error(`Blocked by: ${blocking.map((b) => b.title).join(", ")}`);
    }
  }
  const completedAt = status === "done" ? new Date() : null;
  const [task] = await db.update(tasks).set({ status, completedAt }).where(eq(tasks.id, id)).returning();
  if (task?.parentId) await recalcParentProgress(task.parentId);

  // When a task is completed, auto-record in the related entity's activity timeline
  if (status === "done" && task) {
    const activityPayload = {
      type: "note" as const,
      content: `Task completed: "${task.title}"`,
      date: new Date(),
      ownerId: task.ownerId ?? undefined,
      leadId: task.leadId ?? undefined,
      contactId: task.contactId ?? undefined,
      companyId: task.companyId ?? undefined,
      dealId: task.dealId ?? undefined,
    };
    await db
      .insert(activities)
      .values(activityPayload)
      // biome-ignore lint/suspicious/noEmptyBlockStatements: swallow fire-and-forget errors
      .catch(() => {});

    // Webhook dispatch
    dispatchWebhook("task.completed", {
      id: task.id,
      title: task.title,
      contactId: task.contactId ?? null,
      leadId: task.leadId ?? null,
      dealId: task.dealId ?? null,
      // biome-ignore lint/suspicious/noEmptyBlockStatements: swallow fire-and-forget errors
    }).catch(() => {});

    // In-app notification to assignee (if different from owner)
    const notifyUserId = task.assigneeId ?? task.ownerId;
    if (notifyUserId) {
      await createNotificationAction({
        userId: notifyUserId,
        type: "task_due",
        title: "Task completed",
        message: `"${task.title}" was marked as done.`,
        link: "/dashboard/calendar",
        // biome-ignore lint/suspicious/noEmptyBlockStatements: swallow fire-and-forget errors
      }).catch(() => {});
    }
  }

  if (revalidatePathStr) revalidatePath(revalidatePathStr);
  revalidatePath("/dashboard/calendar");
}

export async function deleteTask(id: string, revalidatePathStr?: string) {
  await requireWriteAccess();
  await db.delete(tasks).where(eq(tasks.id, id));
  if (revalidatePathStr) revalidatePath(revalidatePathStr);
  revalidatePath("/dashboard/calendar");
}

export async function getAllUsers() {
  return await db.select({ id: users.id, name: users.name }).from(users);
}

export async function getCalendarTasks() {
  return await db
    .select({
      id: tasks.id,
      title: tasks.title,
      dueDate: tasks.dueDate,
      status: tasks.status,
      priority: tasks.priority,
      leadId: tasks.leadId,
      contactId: tasks.contactId,
      companyId: tasks.companyId,
    })
    .from(tasks)
    .where(isNotNull(tasks.dueDate))
    .orderBy(tasks.dueDate);
}

// Returns tasks due today (for email/notification dispatch)
/** All tasks visible to the current user (admin = all, user = own+assigned). */
export async function getAllTasks(userId: string, role: string) {
  const ownerAlias = alias(users, "owner");
  const assigneeAlias = alias(users, "assignee");
  const leadAlias = alias(leads, "lead");
  const contactAlias = alias(contacts, "contact");
  const companyAlias = alias(companies, "company");

  const base = db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      dueDate: tasks.dueDate,
      startDate: tasks.startDate,
      status: tasks.status,
      priority: tasks.priority,
      depth: tasks.depth,
      progressPct: tasks.progressPct,
      parentId: tasks.parentId,
      estimatedHours: tasks.estimatedHours,
      actualHours: tasks.actualHours,
      createdAt: tasks.createdAt,
      completedAt: tasks.completedAt,
      ownerId: tasks.ownerId,
      assigneeId: tasks.assigneeId,
      ownerName: ownerAlias.name,
      assigneeName: assigneeAlias.name,
      leadId: tasks.leadId,
      contactId: tasks.contactId,
      companyId: tasks.companyId,
      dealId: tasks.dealId,
      ticketId: tasks.ticketId,
      leadName: leadAlias.firstName,
      leadLastName: leadAlias.lastName,
      contactName: contactAlias.firstName,
      contactLastName: contactAlias.lastName,
      companyName: companyAlias.name,
      ticketNumber: tickets.ticketNumber,
      ticketSubject: tickets.subject,
    })
    .from(tasks)
    .leftJoin(ownerAlias, eq(tasks.ownerId, ownerAlias.id))
    .leftJoin(assigneeAlias, eq(tasks.assigneeId, assigneeAlias.id))
    .leftJoin(leadAlias, eq(tasks.leadId, leadAlias.id))
    .leftJoin(contactAlias, eq(tasks.contactId, contactAlias.id))
    .leftJoin(companyAlias, eq(tasks.companyId, companyAlias.id))
    .leftJoin(tickets, eq(tasks.ticketId, tickets.id));

  const isPrivileged = role === "admin" || role === "owner";
  const result = isPrivileged
    ? await base.orderBy(desc(tasks.createdAt))
    : await base
        .where(
          and(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sql`(${tasks.ownerId} = ${userId} OR ${tasks.assigneeId} = ${userId})` as any,
          ),
        )
        .orderBy(desc(tasks.createdAt));

  // Compute blockedByDeps: count open FS predecessors per task (one query, O(1) round-trips)
  const blockingRows = await db
    .select({ successorId: taskDependencies.successorId, predecessorStatus: tasks.status })
    .from(taskDependencies)
    .innerJoin(tasks, eq(taskDependencies.predecessorId, tasks.id))
    .where(eq(taskDependencies.type, "FS"));

  const blockedCountMap: Record<string, number> = {};
  for (const row of blockingRows) {
    if (row.predecessorStatus !== "done") {
      blockedCountMap[row.successorId] = (blockedCountMap[row.successorId] ?? 0) + 1;
    }
  }

  return result.map((t) => ({ ...t, blockedByDeps: blockedCountMap[t.id] ?? 0 }));
}

export async function getTasksByTicketId(ticketId: string) {
  const ownerAlias = alias(users, "owner");
  const assigneeAlias = alias(users, "assignee");
  return db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      status: tasks.status,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      startDate: tasks.startDate,
      depth: tasks.depth,
      progressPct: tasks.progressPct,
      parentId: tasks.parentId,
      estimatedHours: tasks.estimatedHours,
      actualHours: tasks.actualHours,
      completedAt: tasks.completedAt,
      createdAt: tasks.createdAt,
      ownerId: tasks.ownerId,
      assigneeId: tasks.assigneeId,
      ownerName: ownerAlias.name,
      assigneeName: assigneeAlias.name,
      leadId: tasks.leadId,
      contactId: tasks.contactId,
      companyId: tasks.companyId,
      dealId: tasks.dealId,
      ticketId: tasks.ticketId,
    })
    .from(tasks)
    .leftJoin(ownerAlias, eq(tasks.ownerId, ownerAlias.id))
    .leftJoin(assigneeAlias, eq(tasks.assigneeId, assigneeAlias.id))
    .where(eq(tasks.ticketId, ticketId))
    .orderBy(desc(tasks.createdAt));
}

export async function getTasksDueToday() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return await db
    .select({
      id: tasks.id,
      title: tasks.title,
      dueDate: tasks.dueDate,
      status: tasks.status,
      ownerId: tasks.ownerId,
      assigneeId: tasks.assigneeId,
      leadId: tasks.leadId,
      contactId: tasks.contactId,
      companyId: tasks.companyId,
    })
    .from(tasks)
    .where(and(eq(tasks.status, "todo"), gte(tasks.dueDate, start), lte(tasks.dueDate, end)));
}

export async function getTaskActualHours(taskId: string): Promise<string | null> {
  const [row] = await db.select({ actualHours: tasks.actualHours }).from(tasks).where(eq(tasks.id, taskId));
  return row?.actualHours ?? null;
}

// ─── Time Tracking ─────────────────────────────────────────────────────────────

export async function startTimer(taskId: string, userId: string) {
  await requireWriteAccess();
  const [log] = await db.insert(taskTimeLogs).values({ taskId, userId, startedAt: new Date() }).returning();
  return log;
}

export async function stopTimer(logId: string) {
  await requireWriteAccess();
  const stoppedAt = new Date();
  const [log] = await db
    .select({ startedAt: taskTimeLogs.startedAt, taskId: taskTimeLogs.taskId })
    .from(taskTimeLogs)
    .where(eq(taskTimeLogs.id, logId))
    .limit(1);
  if (!log) throw new Error("Timer log not found");
  const hours = (stoppedAt.getTime() - new Date(log.startedAt).getTime()) / 3_600_000;
  const roundedHours = Math.round(hours * 100) / 100;
  await db
    .update(taskTimeLogs)
    .set({ stoppedAt, hours: String(roundedHours) })
    .where(eq(taskTimeLogs.id, logId));
  // recalculate actualHours on task
  const total = await db
    .select({ hours: taskTimeLogs.hours })
    .from(taskTimeLogs)
    .where(eq(taskTimeLogs.taskId, log.taskId));
  const totalHours = total.reduce((sum, l) => sum + parseFloat(l.hours ?? "0"), 0);
  await db
    .update(tasks)
    .set({ actualHours: String(Math.round(totalHours * 100) / 100) })
    .where(eq(tasks.id, log.taskId));
  revalidatePath("/dashboard/tasks");
  return { logId, hours: roundedHours };
}

export async function logHoursManual(taskId: string, userId: string, hours: number, note?: string) {
  await requireWriteAccess();
  const now = new Date();
  await db.insert(taskTimeLogs).values({
    taskId,
    userId,
    startedAt: now,
    stoppedAt: now,
    hours: String(hours),
    note,
  });
  // recalculate actualHours
  const total = await db
    .select({ hours: taskTimeLogs.hours })
    .from(taskTimeLogs)
    .where(eq(taskTimeLogs.taskId, taskId));
  const totalHours = total.reduce((sum, l) => sum + parseFloat(l.hours ?? "0"), 0);
  await db
    .update(tasks)
    .set({ actualHours: String(Math.round(totalHours * 100) / 100) })
    .where(eq(tasks.id, taskId));
  revalidatePath("/dashboard/tasks");
}

export async function getTimeLogs(taskId: string) {
  return await db
    .select({
      id: taskTimeLogs.id,
      userId: taskTimeLogs.userId,
      userName: users.name,
      startedAt: taskTimeLogs.startedAt,
      stoppedAt: taskTimeLogs.stoppedAt,
      hours: taskTimeLogs.hours,
      note: taskTimeLogs.note,
      createdAt: taskTimeLogs.createdAt,
    })
    .from(taskTimeLogs)
    .leftJoin(users, eq(taskTimeLogs.userId, users.id))
    .where(eq(taskTimeLogs.taskId, taskId))
    .orderBy(desc(taskTimeLogs.createdAt));
}

export async function deleteTimeLog(logId: string, taskId: string) {
  await requireWriteAccess();
  await db.delete(taskTimeLogs).where(eq(taskTimeLogs.id, logId));
  // recalculate
  const total = await db
    .select({ hours: taskTimeLogs.hours })
    .from(taskTimeLogs)
    .where(eq(taskTimeLogs.taskId, taskId));
  const totalHours = total.reduce((sum, l) => sum + parseFloat(l.hours ?? "0"), 0);
  await db
    .update(tasks)
    .set({ actualHours: String(Math.round(totalHours * 100) / 100) })
    .where(eq(tasks.id, taskId));
  revalidatePath("/dashboard/tasks");
}

export async function updateTaskHours(taskId: string, estimatedHours: number | null) {
  await requireWriteAccess();
  await db
    .update(tasks)
    .set({ estimatedHours: estimatedHours !== null ? String(estimatedHours) : null })
    .where(eq(tasks.id, taskId));
  revalidatePath("/dashboard/tasks");
}

// ─── F3: Task Dependencies ────────────────────────────────────────────────────

export async function addDependency(predecessorId: string, successorId: string, type = "FS", lagDays = 0) {
  await requireWriteAccess();
  if (predecessorId === successorId) throw new Error("A task cannot depend on itself.");

  // cycle check: would adding predecessorId→successorId create a cycle?
  // i.e., is successorId already an ancestor of predecessorId?
  const visited = new Set<string>();
  const queue = [predecessorId];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (!cur) break;
    if (cur === successorId) throw new Error("Circular dependency detected.");
    if (visited.has(cur)) continue;
    visited.add(cur);
    const preds = await db
      .select({ predecessorId: taskDependencies.predecessorId })
      .from(taskDependencies)
      .where(eq(taskDependencies.successorId, cur));
    for (const p of preds) queue.push(p.predecessorId);
  }

  // max 10 dependencies per task
  const count = await db
    .select({ c: sql<number>`count(*)` })
    .from(taskDependencies)
    .where(eq(taskDependencies.successorId, successorId));
  if (Number(count[0].c) >= 10) throw new Error("Max 10 dependencies per task.");

  await db.insert(taskDependencies).values({ predecessorId, successorId, type, lagDays });
  revalidatePath("/dashboard/tasks");
}

export async function removeDependency(dependencyId: string) {
  await requireWriteAccess();
  await db.delete(taskDependencies).where(eq(taskDependencies.id, dependencyId));
  revalidatePath("/dashboard/tasks");
}

export async function getDependencies(taskId: string) {
  const predecessor = alias(tasks, "predecessor");
  const successor = alias(tasks, "successor");

  const predecessors = await db
    .select({
      id: taskDependencies.id,
      type: taskDependencies.type,
      lagDays: taskDependencies.lagDays,
      taskId: predecessor.id,
      taskTitle: predecessor.title,
      taskStatus: predecessor.status,
    })
    .from(taskDependencies)
    .innerJoin(predecessor, eq(taskDependencies.predecessorId, predecessor.id))
    .where(eq(taskDependencies.successorId, taskId));

  const successors = await db
    .select({
      id: taskDependencies.id,
      type: taskDependencies.type,
      lagDays: taskDependencies.lagDays,
      taskId: successor.id,
      taskTitle: successor.title,
      taskStatus: successor.status,
    })
    .from(taskDependencies)
    .innerJoin(successor, eq(taskDependencies.successorId, successor.id))
    .where(eq(taskDependencies.predecessorId, taskId));

  return { predecessors, successors };
}

export async function checkDependencyViolation(taskId: string) {
  const predecessor = alias(tasks, "predecessor");
  const blocking = await db
    .select({
      id: taskDependencies.id,
      predecessorId: taskDependencies.predecessorId,
      title: predecessor.title,
      status: predecessor.status,
    })
    .from(taskDependencies)
    .innerJoin(predecessor, eq(taskDependencies.predecessorId, predecessor.id))
    .where(and(eq(taskDependencies.successorId, taskId), eq(taskDependencies.type, "FS")));

  return blocking.filter((d) => d.status !== "done");
}

export async function propagateDateShift(
  taskId: string,
  deltaDays: number,
  visited: Set<string> = new Set(),
): Promise<string[]> {
  if (visited.has(taskId)) return [];
  visited.add(taskId);
  await requireWriteAccess();
  const task = await db.select({ dueDate: tasks.dueDate }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task[0]) return [];

  const newDue = task[0].dueDate ? new Date(task[0].dueDate.getTime() + deltaDays * 86400000) : null;
  await db.update(tasks).set({ dueDate: newDue }).where(eq(tasks.id, taskId));

  const successorRows = await db
    .select({ successorId: taskDependencies.successorId })
    .from(taskDependencies)
    .where(and(eq(taskDependencies.predecessorId, taskId), eq(taskDependencies.type, "FS")));

  const shifted = [taskId];
  for (const row of successorRows) {
    const nested = await propagateDateShift(row.successorId, deltaDays, visited);
    shifted.push(...nested);
  }
  revalidatePath("/dashboard/tasks");
  return shifted;
}

// Called from the Gantt: the dragged task's dates are already updated by updateTask;
// this propagates the delta to its FS successors only, without re-touching the root.
export async function propagateSuccessors(taskId: string, deltaDays: number): Promise<number> {
  await requireWriteAccess();
  const successorRows = await db
    .select({ successorId: taskDependencies.successorId })
    .from(taskDependencies)
    .where(and(eq(taskDependencies.predecessorId, taskId), eq(taskDependencies.type, "FS")));

  const visited = new Set([taskId]); // root already updated — don't revisit
  let count = 0;
  for (const row of successorRows) {
    const nested = await propagateDateShift(row.successorId, deltaDays, visited);
    count += nested.length;
  }
  return count;
}

export async function getAllTasksForGantt() {
  return await db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
      startDate: tasks.startDate,
      dueDate: tasks.dueDate,
      progressPct: tasks.progressPct,
      parentId: tasks.parentId,
      depth: tasks.depth,
      assigneeId: tasks.assigneeId,
      assigneeName: users.name,
    })
    .from(tasks)
    .leftJoin(users, eq(tasks.assigneeId, users.id))
    .orderBy(tasks.createdAt);
}
