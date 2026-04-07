"use server";

import { db } from "@/db";
import { activities, tasks, users } from "@/db/schema";
import { eq, desc, isNotNull, and, lte, gte } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { revalidatePath } from "next/cache";
import { createNotificationAction } from "@/actions/auth";
import { dispatchWebhook } from "@/actions/webhooks";

export async function createTask(data: {
  title: string;
  description?: string;
  dueDate?: Date;
  status?: string;
  priority?: string;
  ownerId?: string;
  assigneeId?: string;
  leadId?: string;
  contactId?: string;
  companyId?: string;
  dealId?: string;
}) {
  const result = await db.insert(tasks).values(data).returning();
  if (data.leadId) revalidatePath(`/dashboard/leads/${data.leadId}`);
  if (data.contactId) revalidatePath(`/dashboard/contacts/${data.contactId}`);
  if (data.companyId) revalidatePath(`/dashboard/companies/${data.companyId}`);
  revalidatePath("/dashboard/calendar");
  return result[0];
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

async function getTasksGeneric(where: { leadId?: string; contactId?: string; companyId?: string }) {
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
  }

  return await query.orderBy(desc(tasks.createdAt));
}

export async function updateTask(id: string, data: Partial<typeof tasks.$inferInsert>, revalidatePathStr?: string) {
  const result = await db.update(tasks).set(data).where(eq(tasks.id, id)).returning();
  if (revalidatePathStr) revalidatePath(revalidatePathStr);
  revalidatePath("/dashboard/calendar");
  return result[0];
}

export async function updateTaskStatus(id: string, status: string, revalidatePathStr?: string) {
  const completedAt = status === "done" ? new Date() : null;
  const [task] = await db.update(tasks).set({ status, completedAt }).where(eq(tasks.id, id)).returning();

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
    await db.insert(activities).values(activityPayload).catch(() => {});

    // Webhook dispatch
    dispatchWebhook("task.completed", { id: task.id, title: task.title, contactId: task.contactId ?? null, leadId: task.leadId ?? null, dealId: task.dealId ?? null }).catch(() => {});

    // In-app notification to assignee (if different from owner)
    const notifyUserId = task.assigneeId ?? task.ownerId;
    if (notifyUserId) {
      await createNotificationAction({
        userId: notifyUserId,
        type: "task_due",
        title: "Task completed",
        message: `"${task.title}" was marked as done.`,
        link: "/dashboard/calendar",
      }).catch(() => {});
    }
  }

  if (revalidatePathStr) revalidatePath(revalidatePathStr);
  revalidatePath("/dashboard/calendar");
}

export async function deleteTask(id: string, revalidatePathStr?: string) {
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
export async function getTasksDueToday() {
  const start = new Date(); start.setHours(0,0,0,0);
  const end   = new Date(); end.setHours(23,59,59,999);
  return await db
    .select({
      id: tasks.id, title: tasks.title, dueDate: tasks.dueDate,
      status: tasks.status, ownerId: tasks.ownerId, assigneeId: tasks.assigneeId,
      leadId: tasks.leadId, contactId: tasks.contactId, companyId: tasks.companyId,
    })
    .from(tasks)
    .where(and(eq(tasks.status, "todo"), gte(tasks.dueDate, start), lte(tasks.dueDate, end)));
}
