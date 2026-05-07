// NOT "use server" — this is a plain server-side lib callable from both
// server actions (with auth) and API routes (cron, no session).

import { and, eq, inArray, lte } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import {
  campaignLogs, contacts, emailJobs, emailSuppressions,
  emailTemplates, leads, marketingCampaigns,
} from "@/db/schema";
import { generateUnsubscribeToken } from "@/lib/unsubscribe-token";

const APP_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

type Recipient = { id: string; email: string | null; firstName: string; lastName: string };

function wrapLinksForTracking(html: string, logId: string): string {
  return html.replace(/href="(https?:\/\/[^"]+)"/gi, (match, url: string) => {
    if (url.includes("/api/track/") || url.includes("/api/unsubscribe")) return match;
    const tracked = `${APP_URL}/api/track/click?log=${encodeURIComponent(logId)}&url=${encodeURIComponent(url)}`;
    return `href="${tracked}"`;
  });
}

export async function executeCampaignSend(data: {
  campaignId: string;
  recipientType: "contacts" | "leads";
  recipientIds?: string[];
}): Promise<{ success: true; queued: number; skipped: number; total: number } | { error: string }> {
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

  const suppressions = await db.select({ email: emailSuppressions.email }).from(emailSuppressions);
  const suppressedEmails = new Set(suppressions.map((s) => s.email.toLowerCase()));

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

    const [log] = await db
      .insert(campaignLogs)
      .values({
        campaignId,
        [recipientType === "contacts" ? "contactId" : "leadId"]: recipient.id,
        status: "queued",
        sentAt: new Date(),
      })
      .returning();

    let html = template.body
      .replace(/\{\{nome\}\}/gi, recipient.firstName ?? "")
      .replace(/\{\{cognome\}\}/gi, recipient.lastName ?? "")
      .replace(/\{\{email\}\}/gi, recipient.email)
      .replace(/\{\{contatto\.nome\}\}/gi, recipient.firstName ?? "")
      .replace(/\{\{contatto\.cognome\}\}/gi, recipient.lastName ?? "");

    const unsubToken = generateUnsubscribeToken(recipient.email, log.id);
    html = html.replace(/\{\{link_unsubscribe\}\}/gi, `${APP_URL}/api/unsubscribe?token=${unsubToken}`);
    html = wrapLinksForTracking(html, log.id);
    html = `${html}\n<img src="${APP_URL}/api/track/open?log=${encodeURIComponent(log.id)}" width="1" height="1" alt="" style="display:none" />`;

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

/** Queries due campaigns, marks them as "sending" to prevent re-dispatch, then sends each. */
export async function dispatchDueCampaigns(): Promise<Array<{ id: string; name: string; result: unknown }>> {
  const due = await db
    .select()
    .from(marketingCampaigns)
    .where(and(eq(marketingCampaigns.status, "scheduled"), lte(marketingCampaigns.scheduledAt, new Date())));

  if (due.length === 0) return [];

  // Mark all as "sending" before dispatch — prevents re-dispatch if one fails mid-loop.
  await db
    .update(marketingCampaigns)
    .set({ status: "sending", updatedAt: new Date() })
    .where(inArray(marketingCampaigns.id, due.map((c) => c.id)));

  const results: Array<{ id: string; name: string; result: unknown }> = [];
  for (const campaign of due) {
    const recipientType = (campaign.recipientType as "contacts" | "leads") ?? "contacts";
    const result = await executeCampaignSend({ campaignId: campaign.id, recipientType });
    results.push({ id: campaign.id, name: campaign.name, result });
  }
  return results;
}
