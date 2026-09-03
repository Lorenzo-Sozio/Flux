"use server";

import { revalidatePath } from "next/cache";

import { desc, eq, isNull } from "drizzle-orm";

import { type AutomationRuleFormData, AutomationRuleFormSchema } from "@/components/crm/automation/types";
import { automationLogs, automationRules, campaignLogs, contacts, leads } from "@/db/schema";
import { requireAdminAccess, requirePlanModule, requireWriteAccess } from "@/lib/auth-guard";
import { getDb } from "@/lib/tenant-context";

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getAutomationRules() {
  await requireWriteAccess();
  await requirePlanModule("automation");
  const db = await getDb();
  return db.select().from(automationRules).orderBy(desc(automationRules.createdAt));
}

export async function getAutomationRuleById(id: string) {
  await requireWriteAccess();
  await requirePlanModule("automation");
  const db = await getDb();
  const [rule] = await db.select().from(automationRules).where(eq(automationRules.id, id));
  return rule ?? null;
}

export async function getAutomationLogs(ruleId: string, limit = 50) {
  await requireWriteAccess();
  await requirePlanModule("automation");
  const db = await getDb();
  return db
    .select()
    .from(automationLogs)
    .where(eq(automationLogs.ruleId, ruleId))
    .orderBy(desc(automationLogs.createdAt))
    .limit(limit);
}

/**
 * Fetch recent logs across all rules (for dashboard overview)
 */
export async function getRecentAutomationLogs(limit = 50) {
  await requireWriteAccess();
  await requirePlanModule("automation");
  const db = await getDb();
  return db.select().from(automationLogs).orderBy(desc(automationLogs.createdAt)).limit(limit);
}

/**
 * Automation email send log (campaignId IS NULL = sent by automation, not a campaign).
 */
export async function getAutomationEmailLogs(limit = 100) {
  await requireWriteAccess();
  await requirePlanModule("automation");
  const db = await getDb();
  const rows = await db
    .select({
      id: campaignLogs.id,
      status: campaignLogs.status,
      sentAt: campaignLogs.sentAt,
      openedAt: campaignLogs.openedAt,
      clickedAt: campaignLogs.clickedAt,
      errorMessage: campaignLogs.errorMessage,
      contactId: campaignLogs.contactId,
      leadId: campaignLogs.leadId,
      contactName: contacts.firstName,
      contactEmail: contacts.email,
      leadFirstName: leads.firstName,
      leadEmail: leads.email,
    })
    .from(campaignLogs)
    .leftJoin(contacts, eq(campaignLogs.contactId, contacts.id))
    .leftJoin(leads, eq(campaignLogs.leadId, leads.id))
    .where(isNull(campaignLogs.campaignId))
    .orderBy(desc(campaignLogs.sentAt))
    .limit(limit);

  return rows.map((r) => ({
    ...r,
    recipientName: r.contactName ?? r.leadFirstName ?? "—",
    recipientEmail: r.contactEmail ?? r.leadEmail ?? "—",
    recipientType: r.contactId ? "contact" : r.leadId ? "lead" : null,
  }));
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createAutomationRule(data: AutomationRuleFormData) {
  const session = await requireWriteAccess();
  await requirePlanModule("automation");
  const db = await getDb();

  // Server-side Zod validation (also validates nested JSON structures)
  const parsed = AutomationRuleFormSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? "Invalid rule data" };
  }

  const { name, description, isActive, targetEntity, triggerOn, conditionLogic, conditions, actions } = parsed.data;

  await db.insert(automationRules).values({
    name,
    description: description ?? null,
    isActive,
    targetEntity,
    triggerOn,
    conditionLogic,
    conditions: JSON.stringify(conditions),
    actions: JSON.stringify(actions),
    ownerId: session.user.id,
  });

  revalidatePath("/dashboard/automation");
  return { success: true };
}

// ─── Update ───────────────────────────────────────────────────────────────────

export async function updateAutomationRule(id: string, data: AutomationRuleFormData) {
  await requireWriteAccess();
  await requirePlanModule("automation");
  const db = await getDb();

  const parsed = AutomationRuleFormSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? "Invalid rule data" };
  }

  const { name, description, isActive, targetEntity, triggerOn, conditionLogic, conditions, actions } = parsed.data;

  await db
    .update(automationRules)
    .set({
      name,
      description: description ?? null,
      isActive,
      targetEntity,
      triggerOn,
      conditionLogic,
      conditions: JSON.stringify(conditions),
      actions: JSON.stringify(actions),
      updatedAt: new Date(),
    })
    .where(eq(automationRules.id, id));

  revalidatePath("/dashboard/automation");
  return { success: true };
}

// ─── Toggle active ────────────────────────────────────────────────────────────

export async function toggleAutomationRuleActive(id: string, isActive: boolean) {
  await requireWriteAccess();
  await requirePlanModule("automation");
  const db = await getDb();
  await db.update(automationRules).set({ isActive, updatedAt: new Date() }).where(eq(automationRules.id, id));
  revalidatePath("/dashboard/automation");
  return { success: true };
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function deleteAutomationRule(id: string) {
  await requireAdminAccess();
  await requirePlanModule("automation");
  const db = await getDb();
  await db.delete(automationRules).where(eq(automationRules.id, id));
  revalidatePath("/dashboard/automation");
  return { success: true };
}
