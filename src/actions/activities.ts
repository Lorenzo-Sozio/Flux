"use server";

import { db } from "@/db";
import { activities } from "@/db/schema";
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
  revalidatePath("/dashboard/leads/[id]", "page");
  return result[0];
}

export async function getActivitiesByLead(leadId: string) {
  return await db.select().from(activities).where(eq(activities.leadId, leadId)).orderBy(desc(activities.createdAt));
}

export async function deleteActivity(id: string) {
  await db.delete(activities).where(eq(activities.id, id));
  revalidatePath("/dashboard/leads/[id]", "page");
}
