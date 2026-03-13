"use server";

import { db } from "@/db";
import { activities, users } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export async function createActivity(data: {
  type: string;
  content?: string;
  date?: Date;
  ownerId?: string;
  leadId?: string;
  contactId?: string;
  companyId?: string;
  dealId?: string;
}) {
  const result = await db.insert(activities).values(data).returning();
  if (data.leadId) revalidatePath(`/dashboard/leads/${data.leadId}`);
  if (data.contactId) revalidatePath(`/dashboard/contacts/${data.contactId}`);
  if (data.companyId) revalidatePath(`/dashboard/companies/${data.companyId}`);
  if (data.dealId) revalidatePath(`/dashboard/pipeline`);
  return result[0];
}

export async function getActivitiesByLead(leadId: string) {
  return await db
    .select({
      id: activities.id,
      type: activities.type,
      content: activities.content,
      date: activities.date,
      createdAt: activities.createdAt,
      ownerName: users.name,
    })
    .from(activities)
    .leftJoin(users, eq(activities.ownerId, users.id))
    .where(eq(activities.leadId, leadId))
    .orderBy(desc(activities.createdAt));
}

export async function getActivitiesByContact(contactId: string) {
  return await db
    .select({
      id: activities.id,
      type: activities.type,
      content: activities.content,
      date: activities.date,
      createdAt: activities.createdAt,
      ownerName: users.name,
    })
    .from(activities)
    .leftJoin(users, eq(activities.ownerId, users.id))
    .where(eq(activities.contactId, contactId))
    .orderBy(desc(activities.createdAt));
}

export async function getActivitiesByCompany(companyId: string) {
  return await db
    .select({
      id: activities.id,
      type: activities.type,
      content: activities.content,
      date: activities.date,
      createdAt: activities.createdAt,
      ownerName: users.name,
    })
    .from(activities)
    .leftJoin(users, eq(activities.ownerId, users.id))
    .where(eq(activities.companyId, companyId))
    .orderBy(desc(activities.createdAt));
}

export async function updateActivity(id: string, data: Partial<typeof activities.$inferInsert>, revalidatePathStr?: string) {
  const result = await db.update(activities).set(data).where(eq(activities.id, id)).returning();
  if (revalidatePathStr) revalidatePath(revalidatePathStr);
  return result[0];
}

export async function deleteActivity(id: string, revalidatePathStr?: string) {
  await db.delete(activities).where(eq(activities.id, id));
  if (revalidatePathStr) revalidatePath(revalidatePathStr);
}
