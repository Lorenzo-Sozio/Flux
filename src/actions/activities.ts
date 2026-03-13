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
  return result[0];
}

export async function getActivitiesByLead(leadId: string) {
  return await db
    .select({
      id: activities.id,
      type: activities.type,
      content: activities.content,
      createdAt: activities.createdAt,
      ownerName: users.name,
    })
    .from(activities)
    .leftJoin(users, eq(activities.ownerId, users.id))
    .where(eq(activities.leadId, leadId))
    .orderBy(desc(activities.createdAt));
}

export async function deleteActivity(id: string, leadId?: string) {
  await db.delete(activities).where(eq(activities.id, id));
  if (leadId) revalidatePath(`/dashboard/leads/${leadId}`);
}
