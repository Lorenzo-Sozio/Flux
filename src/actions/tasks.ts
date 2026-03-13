"use server";

import { db } from "@/db";
import { tasks, users } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export async function createTask(data: {
  title: string;
  description?: string;
  dueDate?: Date;
  status?: string;
  priority?: string;
  ownerId?: string;
  leadId?: string;
  contactId?: string;
  companyId?: string;
  dealId?: string;
}) {
  const result = await db.insert(tasks).values(data).returning();
  if (data.leadId) revalidatePath(`/dashboard/leads/${data.leadId}`);
  return result[0];
}

export async function getTasksByLead(leadId: string) {
  return await db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      dueDate: tasks.dueDate,
      status: tasks.status,
      priority: tasks.priority,
      createdAt: tasks.createdAt,
      ownerName: users.name,
    })
    .from(tasks)
    .leftJoin(users, eq(tasks.ownerId, users.id))
    .where(eq(tasks.leadId, leadId))
    .orderBy(desc(tasks.createdAt));
}

export async function updateTaskStatus(id: string, status: string, leadId?: string) {
  await db.update(tasks).set({ status }).where(eq(tasks.id, id));
  if (leadId) revalidatePath(`/dashboard/leads/${leadId}`);
}

export async function deleteTask(id: string, leadId?: string) {
  await db.delete(tasks).where(eq(tasks.id, id));
  if (leadId) revalidatePath(`/dashboard/leads/${leadId}`);
}
