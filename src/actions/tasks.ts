"use server";

import { db } from "@/db";
import { tasks } from "@/db/schema";
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
  revalidatePath("/dashboard/leads/[id]", "page");
  return result[0];
}

export async function getTasksByLead(leadId: string) {
  return await db.select().from(tasks).where(eq(tasks.leadId, leadId)).orderBy(desc(tasks.createdAt));
}

export async function updateTaskStatus(id: string, status: string) {
  await db.update(tasks).set({ status }).where(eq(tasks.id, id));
  revalidatePath("/dashboard/leads/[id]", "page");
}

export async function deleteTask(id: string) {
  await db.delete(tasks).where(eq(tasks.id, id));
  revalidatePath("/dashboard/leads/[id]", "page");
}
