"use server";

import { revalidatePath } from "next/cache";
import { generateUnsubscribeToken } from "@/lib/unsubscribe-token";
import { db } from "@/db";
import {
  campaignLogs,
  contacts,
  emailJobs,
  emailSuppressions,
  emailTemplates,
  leads,
  marketingCampaigns,
} from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";

const APP_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Wrap every external link in the HTML with the click-tracking redirect. */
function wrapLinksForTracking(html: string, logId: string): string {
  return html.replace(/href="(https?:\/\/[^"]+)"/gi, (match, url: string) => {
    if (url.includes("/api/track/") || url.includes("/api/unsubscribe")) return match;
    const tracked = `${APP_URL}/api/track/click?log=${encodeURIComponent(logId)}&url=${encodeURIComponent(url)}`;
    return `href="${tracked}"`;
  });
}

// ─── Email Templates ──────────────────────────────────────────────────────────

export async function getEmailTemplates() {
  return db.select().from(emailTemplates).orderBy(emailTemplates.createdAt);
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
  return db.select().from(marketingCampaigns).orderBy(marketingCampaigns.createdAt);
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

// ─── Campaign Send (queue-based) ──────────────────────────────────────────────

/**
 * Enqueues all eligible recipients into the email_job table.
 * Actual sending is done asynchronously by /api/cron/email-worker.
 *
 * Per-recipient pipeline:
 *   1. Create campaign_log (status: queued)
 *   2. Personalise HTML variables
 *   3. Inject signed unsubscribe link
 *   4. Wrap external links with click-tracking redirect
 *   5. Append open-tracking pixel
 *   6. Insert email_job (fully rendered HTML)
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

  // Load suppression list
  const suppressions = await db.select({ email: emailSuppressions.email }).from(emailSuppressions);
  const suppressedEmails = new Set(suppressions.map((s) => s.email.toLowerCase()));

  // Fetch eligible recipients
  type Recipient = { id: string; email: string | null; firstName: string; lastName: string };
  let recipients: Recipient[] = [];

  if (recipientType === "contacts") {
    const filter = recipientIds?.length
      ? and(eq(contacts.marketingConsent, true), inArray(contacts.id, recipientIds))
      : eq(contacts.marketingConsent, true);
    recipients = await db
      .select({ id: contacts.id, email: contacts.email, firstName: contacts.firstName, lastName: contacts.lastName })
      .from(contacts)
      .where(filter);
  } else {
    const filter = recipientIds?.length
      ? and(eq(leads.marketingConsent, true), eq(leads.isConverted, false), inArray(leads.id, recipientIds))
      : and(eq(leads.marketingConsent, true), eq(leads.isConverted, false));
    recipients = await db
      .select({ id: leads.id, email: leads.email, firstName: leads.firstName, lastName: leads.lastName })
      .from(leads)
      .where(filter);
  }

  let queued = 0;
  let skipped = 0;

  for (const recipient of recipients) {
    if (!recipient.email) { skipped++; continue; }
    if (suppressedEmails.has(recipient.email.toLowerCase())) { skipped++; continue; }

    // 1. Create campaign log with status "queued"
    const [log] = await db
      .insert(campaignLogs)
      .values({
        campaignId,
        [recipientType === "contacts" ? "contactId" : "leadId"]: recipient.id,
        status: "queued",
        sentAt: new Date(),
      })
      .returning();

    // 2. Personalise
    let html = template.body
      .replace(/\{\{nome\}\}/gi, recipient.firstName ?? "")
      .replace(/\{\{cognome\}\}/gi, recipient.lastName ?? "")
      .replace(/\{\{email\}\}/gi, recipient.email)
      .replace(/\{\{contatto\.nome\}\}/gi, recipient.firstName ?? "")
      .replace(/\{\{contatto\.cognome\}\}/gi, recipient.lastName ?? "");

    // 3. Signed unsubscribe link
    const unsubToken = generateUnsubscribeToken(recipient.email, log.id);
    html = html.replace(/\{\{link_unsubscribe\}\}/gi, `${APP_URL}/api/unsubscribe?token=${unsubToken}`);

    // 4. Wrap external links for click tracking
    html = wrapLinksForTracking(html, log.id);

    // 5. Open-tracking pixel
    html = `${html}\n<img src="${APP_URL}/api/track/open?log=${encodeURIComponent(log.id)}" width="1" height="1" alt="" style="display:none" />`;

    // 6. Enqueue
    await db.insert(emailJobs).values({
      campaignId,
      campaignLogId: log.id,
      toEmail: recipient.email,
      subject: template.subject,
      htmlBody: html,
      status: "pending",
      scheduledAt: new Date(),
    });

    queued++;
  }

  await db
    .update(marketingCampaigns)
    .set({ status: "active", updatedAt: new Date() })
    .where(eq(marketingCampaigns.id, campaignId));

  revalidatePath("/dashboard/marketing/campaigns");
  return { success: true, queued, skipped, total: recipients.length };
}

// ─── Campaign Report ──────────────────────────────────────────────────────────

export async function getCampaignReport(campaignId: string) {
  const [campaign] = await db.select().from(marketingCampaigns).where(eq(marketingCampaigns.id, campaignId));
  if (!campaign) return null;

  const logs = await db.select().from(campaignLogs).where(eq(campaignLogs.campaignId, campaignId));

  const total = logs.length;
  const queued = logs.filter((l) => l.status === "queued").length;
  const sent = logs.filter((l) => !["failed", "queued"].includes(l.status)).length;
  const opened = logs.filter((l) => ["opened", "clicked"].includes(l.status)).length;
  const clicked = logs.filter((l) => l.status === "clicked").length;
  const bounced = logs.filter((l) => l.status === "bounced").length;
  const complained = logs.filter((l) => l.status === "complained").length;
  const unsubscribed = logs.filter((l) => l.status === "unsubscribed").length;
  const failed = logs.filter((l) => l.status === "failed").length;

  return {
    campaign,
    stats: {
      total, queued, sent, opened, clicked, bounced, complained, unsubscribed, failed,
      openRate: sent > 0 ? ((opened / sent) * 100).toFixed(1) : "0",
      clickRate: sent > 0 ? ((clicked / sent) * 100).toFixed(1) : "0",
    },
  };
}
