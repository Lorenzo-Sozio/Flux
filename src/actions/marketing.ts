"use server";

import { revalidatePath } from "next/cache";
import { requireWriteAccess } from "@/lib/auth-guard";
import { getDb } from "@/lib/tenant-context";
import {
  campaignLogs,
  contacts,
  emailSuppressions,
  emailTemplates,
  leads,
  marketingCampaigns,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { executeCampaignSend } from "@/lib/campaign-send";

// ─── Email Templates ──────────────────────────────────────────────────────────

export async function getEmailTemplates() {
  const db = await getDb();
  return db.select().from(emailTemplates).orderBy(emailTemplates.createdAt);
}

export async function createEmailTemplate(data: any) {
  await requireWriteAccess();
  const db = await getDb();
  const [t] = await db.insert(emailTemplates).values(data).returning();
  revalidatePath("/dashboard/marketing/templates");
  return t;
}

export async function updateEmailTemplate(id: string, data: any) {
  await requireWriteAccess();
  const db = await getDb();
  const [t] = await db
    .update(emailTemplates)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(emailTemplates.id, id))
    .returning();
  revalidatePath("/dashboard/marketing/templates");
  return t;
}

export async function deleteEmailTemplate(id: string) {
  await requireWriteAccess();
  const db = await getDb();
  await db.delete(emailTemplates).where(eq(emailTemplates.id, id));
  revalidatePath("/dashboard/marketing/templates");
}

// ─── Marketing Campaigns ──────────────────────────────────────────────────────

export async function getMarketingCampaigns() {
  const db = await getDb();
  return db.select().from(marketingCampaigns).orderBy(marketingCampaigns.createdAt);
}

export async function createMarketingCampaign(data: any) {
  await requireWriteAccess();
  const db = await getDb();
  const [c] = await db.insert(marketingCampaigns).values(data).returning();
  revalidatePath("/dashboard/marketing/campaigns");
  return c;
}

export async function updateMarketingCampaign(id: string, data: any) {
  await requireWriteAccess();
  const db = await getDb();
  const [c] = await db
    .update(marketingCampaigns)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(marketingCampaigns.id, id))
    .returning();
  revalidatePath("/dashboard/marketing/campaigns");
  return c;
}

export async function deleteMarketingCampaign(id: string) {
  await requireWriteAccess();
  const db = await getDb();
  await db.delete(marketingCampaigns).where(eq(marketingCampaigns.id, id));
  revalidatePath("/dashboard/marketing/campaigns");
}

// ─── Campaign Send ────────────────────────────────────────────────────────────

export async function sendCampaignAction(data: {
  campaignId: string;
  recipientType: "contacts" | "leads";
  recipientIds?: string[];
}) {
  await requireWriteAccess();
  const db = await getDb();
  return executeCampaignSend(data);
}

// ─── Campaign Report ──────────────────────────────────────────────────────────

export async function getCampaignReport(campaignId: string) {
  const db = await getDb();
  const [campaign] = await db.select().from(marketingCampaigns).where(eq(marketingCampaigns.id, campaignId));
  if (!campaign) return null;

  // Join with contacts and leads to get recipient names/emails
  const rawLogs = await db
    .select({
      id:               campaignLogs.id,
      status:           campaignLogs.status,
      sentAt:           campaignLogs.sentAt,
      openedAt:         campaignLogs.openedAt,
      clickedAt:        campaignLogs.clickedAt,
      errorMessage:     campaignLogs.errorMessage,
      contactId:        campaignLogs.contactId,
      leadId:           campaignLogs.leadId,
      contactFirstName: contacts.firstName,
      contactLastName:  contacts.lastName,
      contactEmail:     contacts.email,
      leadFirstName:    leads.firstName,
      leadLastName:     leads.lastName,
      leadEmail:        leads.email,
    })
    .from(campaignLogs)
    .leftJoin(contacts, eq(campaignLogs.contactId, contacts.id))
    .leftJoin(leads,    eq(campaignLogs.leadId,    leads.id))
    .where(eq(campaignLogs.campaignId, campaignId));

  const logs = rawLogs.map((r) => ({
    id:            r.id,
    status:        r.status,
    sentAt:        r.sentAt,
    openedAt:      r.openedAt,
    clickedAt:     r.clickedAt,
    errorMessage:  r.errorMessage,
    contactId:     r.contactId,
    leadId:        r.leadId,
    recipientName: [r.contactFirstName ?? r.leadFirstName, r.contactLastName ?? r.leadLastName]
      .filter(Boolean).join(" ") || "—",
    recipientEmail: r.contactEmail ?? r.leadEmail ?? "—",
    recipientType:  r.contactId ? ("contact" as const) : r.leadId ? ("lead" as const) : null,
  }));

  const total       = logs.length;
  const queued      = logs.filter((l) => l.status === "queued").length;
  const sent        = logs.filter((l) => !["failed", "queued"].includes(l.status)).length;
  const opened      = logs.filter((l) => ["opened", "clicked"].includes(l.status)).length;
  const clicked     = logs.filter((l) => l.status === "clicked").length;
  const bounced     = logs.filter((l) => l.status === "bounced").length;
  const complained  = logs.filter((l) => l.status === "complained").length;
  const unsubscribed = logs.filter((l) => l.status === "unsubscribed").length;
  const failed      = logs.filter((l) => l.status === "failed").length;

  return {
    campaign,
    logs,
    stats: {
      total, queued, sent, opened, clicked, bounced, complained, unsubscribed, failed,
      openRate:  sent > 0 ? ((opened  / sent) * 100).toFixed(1) : "0",
      clickRate: sent > 0 ? ((clicked / sent) * 100).toFixed(1) : "0",
    },
  };
}

// ─── Batch stats for campaign list ───────────────────────────────────────────

export async function getCampaignsWithStats() {
  const db = await getDb();
  const campaigns = await db
    .select()
    .from(marketingCampaigns)
    .orderBy(marketingCampaigns.createdAt);

  const allLogs = await db.select().from(campaignLogs);

  return campaigns.map((c) => {
    const logs = allLogs.filter((l) => l.campaignId === c.id);
    const sent = logs.filter((l) => !["failed", "queued"].includes(l.status)).length;
    const opened = logs.filter((l) => ["opened", "clicked"].includes(l.status)).length;
    const clicked = logs.filter((l) => l.status === "clicked").length;
    return {
      ...c,
      scheduledAt: c.scheduledAt ?? null,
      recipientType: c.recipientType ?? null,
      stats: {
        total: logs.length,
        sent,
        opened,
        clicked,
        openRate: sent > 0 ? ((opened / sent) * 100).toFixed(1) : "0",
        clickRate: sent > 0 ? ((clicked / sent) * 100).toFixed(1) : "0",
      },
    };
  });
}

// ─── Eligible recipient counts ────────────────────────────────────────────────

export async function getEligibleRecipientCounts() {
  const db = await getDb();
  const suppressions = await db.select({ email: emailSuppressions.email }).from(emailSuppressions);
  const suppressedEmails = new Set(suppressions.map((s) => s.email.toLowerCase()));

  const allContacts = await db
    .select({ email: contacts.email })
    .from(contacts)
    .where(eq(contacts.marketingConsent, true));

  const allLeads = await db
    .select({ email: leads.email })
    .from(leads)
    .where(and(eq(leads.marketingConsent, true), eq(leads.isConverted, false)));

  const eligibleContacts = allContacts.filter(
    (c) => c.email && !suppressedEmails.has(c.email.toLowerCase()),
  ).length;

  const eligibleLeads = allLeads.filter(
    (l) => l.email && !suppressedEmails.has(l.email.toLowerCase()),
  ).length;

  return { contacts: eligibleContacts, leads: eligibleLeads };
}

// ─── Schedule / Cancel schedule ──────────────────────────────────────────────

export async function scheduleCampaignAction(data: {
  campaignId: string;
  recipientType: "contacts" | "leads";
  scheduledAt: Date;
}) {
  await requireWriteAccess();
  const db = await getDb();
  const { campaignId, recipientType, scheduledAt } = data;
  if (scheduledAt <= new Date()) throw new Error("Scheduled time must be in the future");
  await db
    .update(marketingCampaigns)
    .set({ status: "scheduled", scheduledAt, recipientType, updatedAt: new Date() })
    .where(eq(marketingCampaigns.id, campaignId));
  revalidatePath("/dashboard/marketing/campaigns");
}

export async function cancelScheduledCampaignAction(campaignId: string) {
  await requireWriteAccess();
  const db = await getDb();
  await db
    .update(marketingCampaigns)
    .set({ status: "draft", scheduledAt: null, recipientType: null, updatedAt: new Date() })
    .where(eq(marketingCampaigns.id, campaignId));
  revalidatePath("/dashboard/marketing/campaigns");
}

// ─── Duplicate a campaign ─────────────────────────────────────────────────────

export async function duplicateCampaignAction(id: string) {
  await requireWriteAccess();
  const db = await getDb();
  const [original] = await db.select().from(marketingCampaigns).where(eq(marketingCampaigns.id, id));
  if (!original) throw new Error("Campaign not found");

  const [copy] = await db
    .insert(marketingCampaigns)
    .values({ name: `${original.name} (Copy)`, description: original.description, templateId: original.templateId, status: "draft" })
    .returning();

  revalidatePath("/dashboard/marketing/campaigns");
  return copy;
}
