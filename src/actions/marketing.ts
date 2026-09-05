"use server";

import { revalidatePath } from "next/cache";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { campaignLogs, contacts, emailSuppressions, emailTemplates, leads, marketingCampaigns } from "@/db/schema";
import { requireCapability, requirePlanModule, requireWriteAccess } from "@/lib/auth-guard";
import { listSegments, resolveSegmentIds } from "@/lib/campaign-segment";
import { executeCampaignSend } from "@/lib/campaign-send";
import { getDb } from "@/lib/tenant-context";

// ─── Schemas ──────────────────────────────────────────────────────────────────

/**
 * Whitelist-based schemas: only the listed columns reach the DB.
 * Unknown keys from callers are stripped (Zod default: strip mode).
 * Actions accept `unknown` input so TypeScript callers are not constrained
 * by the strict output type — validation happens entirely server-side.
 */
const EmailTemplateCreateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  subject: z.string().min(1).max(998),
  body: z.string().min(1),
  isHtml: z.boolean().default(true),
  // Accept any string; the DB column has no constraint, so we keep validation loose.
  category: z.string().max(64).default("general"),
  previewText: z.string().max(255).optional(),
  ownerId: z.string().optional(),
  isPublic: z.boolean().default(false),
  tags: z.array(z.string().max(64)).max(20).default([]),
});

const EmailTemplateUpdateSchema = EmailTemplateCreateSchema.partial().omit({ ownerId: true });

const MarketingCampaignCreateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  status: z.string().max(32).optional(),
  templateId: z.string().optional().nullable(),
  ownerId: z.string().optional().nullable(),
  scheduledAt: z
    .union([z.string().datetime(), z.date()])
    .optional()
    .nullable()
    .transform((v) => (v ? new Date(v) : null))
    .pipe(z.date().optional().nullable()),
  recipientType: z.enum(["contacts", "leads"]).optional().nullable(),
});

const MarketingCampaignUpdateSchema = MarketingCampaignCreateSchema.partial();

// ─── Email Templates ──────────────────────────────────────────────────────────

export async function getEmailTemplates() {
  await requireCapability("record:read");
  const db = await getDb();
  return db.select().from(emailTemplates).orderBy(emailTemplates.createdAt);
}

export async function createEmailTemplate(data: unknown) {
  await requireWriteAccess();
  await requirePlanModule("marketing");
  const validated = EmailTemplateCreateSchema.parse(data);
  const db = await getDb();
  const [t] = await db.insert(emailTemplates).values(validated).returning();
  revalidatePath("/dashboard/marketing/templates");
  return t;
}

export async function updateEmailTemplate(id: string, data: unknown) {
  await requireWriteAccess();
  await requirePlanModule("marketing");
  const validated = EmailTemplateUpdateSchema.parse(data);
  const db = await getDb();
  const [t] = await db
    .update(emailTemplates)
    .set({ ...validated, updatedAt: new Date() })
    .where(eq(emailTemplates.id, id))
    .returning();
  revalidatePath("/dashboard/marketing/templates");
  return t;
}

export async function deleteEmailTemplate(id: string) {
  await requireWriteAccess();
  await requirePlanModule("marketing");
  const db = await getDb();
  await db.delete(emailTemplates).where(eq(emailTemplates.id, id));
  revalidatePath("/dashboard/marketing/templates");
}

// ─── Marketing Campaigns ──────────────────────────────────────────────────────

export async function getMarketingCampaigns() {
  await requireCapability("record:read");
  const db = await getDb();
  return db.select().from(marketingCampaigns).orderBy(marketingCampaigns.createdAt);
}

export async function createMarketingCampaign(data: unknown) {
  await requireWriteAccess();
  await requirePlanModule("marketing");
  const validated = MarketingCampaignCreateSchema.parse(data);
  const db = await getDb();
  const [c] = await db.insert(marketingCampaigns).values(validated).returning();
  revalidatePath("/dashboard/marketing/campaigns");
  return c;
}

export async function updateMarketingCampaign(id: string, data: unknown) {
  await requireWriteAccess();
  await requirePlanModule("marketing");
  const validated = MarketingCampaignUpdateSchema.parse(data);
  const db = await getDb();
  const [c] = await db
    .update(marketingCampaigns)
    .set({ ...validated, updatedAt: new Date() })
    .where(eq(marketingCampaigns.id, id))
    .returning();
  revalidatePath("/dashboard/marketing/campaigns");
  return c;
}

export async function deleteMarketingCampaign(id: string) {
  await requireWriteAccess();
  await requirePlanModule("marketing");
  const db = await getDb();
  await db.delete(marketingCampaigns).where(eq(marketingCampaigns.id, id));
  revalidatePath("/dashboard/marketing/campaigns");
}

// ─── Campaign Send ────────────────────────────────────────────────────────────

export async function sendCampaignAction(data: {
  campaignId: string;
  recipientType: "contacts" | "leads";
  recipientIds?: string[];
  /** A saved filter to aim at, instead of everybody eligible. */
  filterId?: string | null;
}) {
  await requireWriteAccess();
  await requirePlanModule("marketing");
  // The database handle opened here was never used: the send resolves its own.
  return executeCampaignSend(data);
}

/**
 * The saved views a campaign can be aimed at, and how many people each reaches.
 *
 * Counted here rather than guessed in the dialog, because the number that
 * matters is the one the send will actually use: same filter, same consent rule,
 * same suppression list.
 */
export async function getSegments() {
  await requireCapability("record:read");
  await requirePlanModule("marketing");
  const segments = await listSegments();
  return segments.map((s) => ({
    id: s.id,
    name: s.name,
    recipientType: s.entityType === "contacts" ? ("contacts" as const) : ("leads" as const),
  }));
}

/** How many people a segment reaches, or everybody eligible when none is chosen. */
export async function getSegmentCount(recipientType: "contacts" | "leads", filterId: string | null) {
  await requireCapability("record:read");
  await requirePlanModule("marketing");
  if (!filterId) {
    const counts = await getEligibleRecipientCounts();
    return counts[recipientType];
  }
  const ids = await resolveSegmentIds(recipientType, filterId);
  return ids?.length ?? 0;
}

// ─── Campaign Report ──────────────────────────────────────────────────────────

export async function getCampaignReport(campaignId: string) {
  await requireCapability("report:read");
  const db = await getDb();
  const [campaign] = await db.select().from(marketingCampaigns).where(eq(marketingCampaigns.id, campaignId));
  if (!campaign) return null;

  // Join with contacts and leads to get recipient names/emails
  const rawLogs = await db
    .select({
      id: campaignLogs.id,
      status: campaignLogs.status,
      sentAt: campaignLogs.sentAt,
      openedAt: campaignLogs.openedAt,
      clickedAt: campaignLogs.clickedAt,
      errorMessage: campaignLogs.errorMessage,
      contactId: campaignLogs.contactId,
      leadId: campaignLogs.leadId,
      contactFirstName: contacts.firstName,
      contactLastName: contacts.lastName,
      contactEmail: contacts.email,
      leadFirstName: leads.firstName,
      leadLastName: leads.lastName,
      leadEmail: leads.email,
    })
    .from(campaignLogs)
    .leftJoin(contacts, eq(campaignLogs.contactId, contacts.id))
    .leftJoin(leads, eq(campaignLogs.leadId, leads.id))
    .where(eq(campaignLogs.campaignId, campaignId));

  const logs = rawLogs.map((r) => ({
    id: r.id,
    status: r.status,
    sentAt: r.sentAt,
    openedAt: r.openedAt,
    clickedAt: r.clickedAt,
    errorMessage: r.errorMessage,
    contactId: r.contactId,
    leadId: r.leadId,
    recipientName:
      [r.contactFirstName ?? r.leadFirstName, r.contactLastName ?? r.leadLastName].filter(Boolean).join(" ") || "—",
    recipientEmail: r.contactEmail ?? r.leadEmail ?? "—",
    recipientType: r.contactId ? ("contact" as const) : r.leadId ? ("lead" as const) : null,
  }));

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
    logs,
    stats: {
      total,
      queued,
      sent,
      opened,
      clicked,
      bounced,
      complained,
      unsubscribed,
      failed,
      openRate: sent > 0 ? ((opened / sent) * 100).toFixed(1) : "0",
      clickRate: sent > 0 ? ((clicked / sent) * 100).toFixed(1) : "0",
    },
  };
}

// ─── Batch stats for campaign list ───────────────────────────────────────────

export async function getCampaignsWithStats() {
  await requireCapability("report:read");
  const db = await getDb();
  const campaigns = await db.select().from(marketingCampaigns).orderBy(marketingCampaigns.createdAt);

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
  await requireCapability("record:read");
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

  const eligibleContacts = allContacts.filter((c) => c.email && !suppressedEmails.has(c.email.toLowerCase())).length;

  const eligibleLeads = allLeads.filter((l) => l.email && !suppressedEmails.has(l.email.toLowerCase())).length;

  return { contacts: eligibleContacts, leads: eligibleLeads };
}

// ─── Schedule / Cancel schedule ──────────────────────────────────────────────

export async function scheduleCampaignAction(data: {
  campaignId: string;
  recipientType: "contacts" | "leads";
  scheduledAt: Date;
  /** Kept on the campaign: the send happens later, when this dialog is gone. */
  filterId?: string | null;
}) {
  await requireWriteAccess();
  await requirePlanModule("marketing");
  const db = await getDb();
  const { campaignId, recipientType, scheduledAt } = data;
  if (scheduledAt <= new Date()) throw new Error("Scheduled time must be in the future");
  await db
    .update(marketingCampaigns)
    .set({
      status: "scheduled",
      scheduledAt,
      recipientType,
      recipientFilterId: data.filterId ?? null,
      updatedAt: new Date(),
    })
    .where(eq(marketingCampaigns.id, campaignId));
  revalidatePath("/dashboard/marketing/campaigns");
}

export async function cancelScheduledCampaignAction(campaignId: string) {
  await requireWriteAccess();
  await requirePlanModule("marketing");
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
  await requirePlanModule("marketing");
  const db = await getDb();
  const [original] = await db.select().from(marketingCampaigns).where(eq(marketingCampaigns.id, id));
  if (!original) throw new Error("Campaign not found");

  const [copy] = await db
    .insert(marketingCampaigns)
    .values({
      name: `${original.name} (Copy)`,
      description: original.description,
      templateId: original.templateId,
      status: "draft",
    })
    .returning();

  revalidatePath("/dashboard/marketing/campaigns");
  return copy;
}
