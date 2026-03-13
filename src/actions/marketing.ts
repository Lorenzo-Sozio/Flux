"use server";

import { db } from "@/db";
import { emailTemplates, marketingCampaigns } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";

// --- EMAIL TEMPLATES ---

export async function getEmailTemplates() {
  return await db.select().from(emailTemplates).orderBy(desc(emailTemplates.createdAt));
}

export async function createEmailTemplate(data: { name: string; subject: string; body: string; ownerId?: string }) {
  const [newTemplate] = await db.insert(emailTemplates).values(data).returning();
  revalidatePath("/dashboard/marketing/templates");
  return newTemplate;
}

export async function updateEmailTemplate(id: string, data: Partial<typeof emailTemplates.$inferInsert>) {
  const [updated] = await db.update(emailTemplates).set(data).where(eq(emailTemplates.id, id)).returning();
  revalidatePath("/dashboard/marketing/templates");
  return updated;
}

export async function deleteEmailTemplate(id: string) {
  await db.delete(emailTemplates).where(eq(emailTemplates.id, id));
  revalidatePath("/dashboard/marketing/templates");
}

// --- MARKETING CAMPAIGNS ---

export async function getMarketingCampaigns() {
  return await db.select().from(marketingCampaigns).orderBy(desc(marketingCampaigns.createdAt));
}

export async function createMarketingCampaign(data: { name: string; description?: string; templateId?: string; ownerId?: string }) {
  const [newCampaign] = await db.insert(marketingCampaigns).values(data).returning();
  revalidatePath("/dashboard/marketing/campaigns");
  return newCampaign;
}

export async function updateMarketingCampaign(id: string, data: Partial<typeof marketingCampaigns.$inferInsert>) {
  const [updated] = await db.update(marketingCampaigns).set(data).where(eq(marketingCampaigns.id, id)).returning();
  revalidatePath("/dashboard/marketing/campaigns");
  return updated;
}

export async function deleteMarketingCampaign(id: string) {
  await db.delete(marketingCampaigns).where(eq(marketingCampaigns.id, id));
  revalidatePath("/dashboard/marketing/campaigns");
}
