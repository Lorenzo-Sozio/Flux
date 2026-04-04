"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  campaignLogs,
  contacts,
  emailTemplates,
  leads,
  marketingCampaigns,
} from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { sendCampaignEmail } from "@/lib/email";

const APP_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

// ─── Email Templates ──────────────────────────────────────────────────────────

export async function getEmailTemplates() {
  return await db.select().from(emailTemplates).orderBy(emailTemplates.createdAt);
}

export async function createEmailTemplate(data: any) {
  const [t] = await db.insert(emailTemplates).values(data).returning();
  revalidatePath("/dashboard/marketing/templates");
  return t;
}

export async function updateEmailTemplate(id: string, data: any) {
  const [t] = await db
    .update(emailTemplates)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(emailTemplates.id, id))
    .returning();
  revalidatePath("/dashboard/marketing/templates");
  return t;
}

export async function deleteEmailTemplate(id: string) {
  await db.delete(emailTemplates).where(eq(emailTemplates.id, id));
  revalidatePath("/dashboard/marketing/templates");
}

// ─── Marketing Campaigns ──────────────────────────────────────────────────────

export async function getMarketingCampaigns() {
  return await db.select().from(marketingCampaigns).orderBy(marketingCampaigns.createdAt);
}

export async function createMarketingCampaign(data: any) {
  const [c] = await db.insert(marketingCampaigns).values(data).returning();
  revalidatePath("/dashboard/marketing/campaigns");
  return c;
}

export async function updateMarketingCampaign(id: string, data: any) {
  const [c] = await db
    .update(marketingCampaigns)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(marketingCampaigns.id, id))
    .returning();
  revalidatePath("/dashboard/marketing/campaigns");
  return c;
}

export async function deleteMarketingCampaign(id: string) {
  await db.delete(marketingCampaigns).where(eq(marketingCampaigns.id, id));
  revalidatePath("/dashboard/marketing/campaigns");
}

// ─── Campaign Send ────────────────────────────────────────────────────────────

/**
 * Send a marketing campaign to contacts/leads with marketing consent.
 * Tracking: open pixel + click redirect via /api/track/*.
 */
export async function sendCampaignAction(data: {
  campaignId: string;
  recipientType: "contacts" | "leads";
  recipientIds?: string[];
}) {
  const { campaignId, recipientType, recipientIds } = data;

  const [campaign] = await db
    .select()
    .from(marketingCampaigns)
    .where(eq(marketingCampaigns.id, campaignId));

  if (!campaign?.templateId) return { error: "Campaign or template not found." };

  const [template] = await db
    .select()
    .from(emailTemplates)
    .where(eq(emailTemplates.id, campaign.templateId));

  if (!template) return { error: "Email template not found." };

  // Fetch recipients (only those who gave marketing consent)
  let recipients: { id: string; email: string | null; firstName: string; lastName: string }[] = [];

  if (recipientType === "contacts") {
    if (recipientIds?.length) {
      recipients = await db
        .select({ id: contacts.id, email: contacts.email, firstName: contacts.firstName, lastName: contacts.lastName })
        .from(contacts)
        .where(and(eq(contacts.marketingConsent, true), inArray(contacts.id, recipientIds)));
    } else {
      recipients = await db
        .select({ id: contacts.id, email: contacts.email, firstName: contacts.firstName, lastName: contacts.lastName })
        .from(contacts)
        .where(eq(contacts.marketingConsent, true));
    }
  } else {
    if (recipientIds?.length) {
      recipients = await db
        .select({ id: leads.id, email: leads.email, firstName: leads.firstName, lastName: leads.lastName })
        .from(leads)
        .where(and(eq(leads.marketingConsent, true), eq(leads.isConverted, false), inArray(leads.id, recipientIds)));
    } else {
      recipients = await db
        .select({ id: leads.id, email: leads.email, firstName: leads.firstName, lastName: leads.lastName })
        .from(leads)
        .where(and(eq(leads.marketingConsent, true), eq(leads.isConverted, false)));
    }
  }

  await db.update(marketingCampaigns).set({ status: "active", updatedAt: new Date() }).where(eq(marketingCampaigns.id, campaignId));

  let sent = 0;
  let failed = 0;

  for (const recipient of recipients) {
    if (!recipient.email) { failed++; continue; }

    const [log] = await db
      .insert(campaignLogs)
      .values({
        campaignId,
        [recipientType === "contacts" ? "contactId" : "leadId"]: recipient.id,
        status: "sent",
        sentAt: new Date(),
      })
      .returning();

    // Personalise template variables
    const body = template.body
      .replace(/\{\{nome\}\}/gi, recipient.firstName)
      .replace(/\{\{cognome\}\}/gi, recipient.lastName)
      .replace(/\{\{email\}\}/gi, recipient.email)
      .replace(/\{\{contatto\.nome\}\}/gi, recipient.firstName)
      .replace(/\{\{contatto\.cognome\}\}/gi, recipient.lastName);

    const trackingPixelUrl = `${APP_URL}/api/track/open?log=${log.id}`;

    const result = await sendCampaignEmail(recipient.email, template.subject, body, trackingPixelUrl);

    if (!result.success) {
      await db.update(campaignLogs).set({ status: "failed" }).where(eq(campaignLogs.id, log.id));
      failed++;
    } else {
      sent++;
    }
  }

  await db.update(marketingCampaigns).set({ status: "completed", updatedAt: new Date() }).where(eq(marketingCampaigns.id, campaignId));
  revalidatePath("/dashboard/marketing/campaigns");
  return { success: true, sent, failed, total: recipients.length };
}

// ─── Campaign Report ──────────────────────────────────────────────────────────

export async function getCampaignReport(campaignId: string) {
  const [campaign] = await db.select().from(marketingCampaigns).where(eq(marketingCampaigns.id, campaignId));
  if (!campaign) return null;

  const logs = await db.select().from(campaignLogs).where(eq(campaignLogs.campaignId, campaignId));
  const total = logs.length;
  const sent = logs.filter((l) => l.status !== "failed").length;
  const opened = logs.filter((l) => l.status === "opened" || l.status === "clicked").length;
  const clicked = logs.filter((l) => l.status === "clicked").length;
  const failed = logs.filter((l) => l.status === "failed").length;

  return {
    campaign,
    stats: {
      total,
      sent,
      opened,
      clicked,
      failed,
      openRate: sent > 0 ? ((opened / sent) * 100).toFixed(1) : "0",
      clickRate: sent > 0 ? ((clicked / sent) * 100).toFixed(1) : "0",
    },
  };
}
