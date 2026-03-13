"use server";

import { db } from "@/db";
import { emailTemplates, marketingCampaigns } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";

// --- EMAIL TEMPLATES ---

export async function getEmailTemplates() {
  return await db.select().from(emailTemplates).orderBy(desc(emailTemplates.createdAt));
}

export async function createEmailTemplate(data: {
  name: string;
  description?: string;
  subject: string;
  body: string;
  isHtml?: boolean;
  category?: string;
  previewText?: string;
  tags?: string[];
}) {
  const session = await auth();
  const ownerId = session?.user?.id;

  const [newTemplate] = await db
    .insert(emailTemplates)
    .values({
      name: data.name,
      description: data.description,
      subject: data.subject,
      body: data.body,
      isHtml: data.isHtml !== false,
      category: data.category || "general",
      previewText: data.previewText,
      tags: data.tags || [],
      ownerId,
    })
    .returning();
  revalidatePath("/dashboard/marketing/templates");
  return newTemplate;
}

export async function updateEmailTemplate(
  id: string,
  data: {
    name?: string;
    description?: string;
    subject?: string;
    body?: string;
    isHtml?: boolean;
    category?: string;
    previewText?: string;
    tags?: string[];
  }
) {
  const updateData: Record<string, any> = {};
  if (data.name) updateData.name = data.name;
  if (data.description) updateData.description = data.description;
  if (data.subject) updateData.subject = data.subject;
  if (data.body) updateData.body = data.body;
  if (data.isHtml !== undefined) updateData.isHtml = data.isHtml;
  if (data.category) updateData.category = data.category;
  if (data.previewText !== undefined) updateData.previewText = data.previewText;
  if (data.tags) updateData.tags = data.tags;
  updateData.updatedAt = new Date();

  const [updated] = await db
    .update(emailTemplates)
    .set(updateData)
    .where(eq(emailTemplates.id, id))
    .returning();
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

export async function createMarketingCampaign(data: {
  name: string;
  description?: string;
  status?: string;
  templateId?: string;
}) {
  const session = await auth();
  const ownerId = session?.user?.id;

  const [newCampaign] = await db
    .insert(marketingCampaigns)
    .values({
      name: data.name,
      description: data.description,
      status: data.status || "draft",
      templateId: data.templateId || null,
      ownerId,
    })
    .returning();
  revalidatePath("/dashboard/marketing/campaigns");
  return newCampaign;
}

export async function updateMarketingCampaign(
  id: string,
  data: {
    name?: string;
    description?: string;
    status?: string;
    templateId?: string;
  }
) {
  const [updated] = await db
    .update(marketingCampaigns)
    .set(data)
    .where(eq(marketingCampaigns.id, id))
    .returning();
  revalidatePath("/dashboard/marketing/campaigns");
  return updated;
}

export async function deleteMarketingCampaign(id: string) {
  await db.delete(marketingCampaigns).where(eq(marketingCampaigns.id, id));
  revalidatePath("/dashboard/marketing/campaigns");
}
