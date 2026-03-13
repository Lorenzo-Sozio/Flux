"use server";

import { db } from "@/db";
import { tasks, users } from "@/db/schema";
import { eq, desc, isNotNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { revalidatePath } from "next/cache";

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
  await db.update(tasks).set({ status, completedAt }).where(eq(tasks.id, id));
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
