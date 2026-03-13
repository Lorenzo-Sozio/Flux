"use server";

import { db } from "@/db";
import { tasks, users, leads } from "@/db/schema";
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
  revalidatePath("/dashboard/calendar");
  return result[0];
}

export async function getTasksByLead(leadId: string) {
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
      createdAt: tasks.createdAt,
      completedAt: tasks.completedAt,
      ownerName: creator.name,
      assigneeName: assignee.name,
    })
    .from(tasks)
    .leftJoin(creator, eq(tasks.ownerId, creator.id))
    .leftJoin(assignee, eq(tasks.assigneeId, assignee.id))
    .where(eq(tasks.leadId, leadId))
    .orderBy(desc(tasks.createdAt));
}

export async function updateTaskStatus(id: string, status: string, leadId?: string) {
  const completedAt = status === "done" ? new Date() : null;
  await db.update(tasks).set({ status, completedAt }).where(eq(tasks.id, id));
  if (leadId) revalidatePath(`/dashboard/leads/${leadId}`);
  revalidatePath("/dashboard/calendar");
}

export async function deleteTask(id: string, leadId?: string) {
  await db.delete(tasks).where(eq(tasks.id, id));
  if (leadId) revalidatePath(`/dashboard/leads/${leadId}`);
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
    })
    .from(tasks)
    .where(isNotNull(tasks.dueDate))
    .orderBy(tasks.dueDate);
}
