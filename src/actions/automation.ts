"use server";

import { revalidatePath } from "next/cache";

import { desc, eq, isNull } from "drizzle-orm";

import { ConditionEvaluator } from "@/components/crm/automation/condition-evaluator";
import { type AutomationRuleFormData, AutomationRuleFormSchema } from "@/components/crm/automation/types";
import {
  automationLogs,
  automationRules,
  campaignLogs,
  companies,
  contacts,
  deals,
  leads,
  orders,
  tickets,
} from "@/db/schema";
import { requireAdminAccess, requirePlanModule, requireWriteAccess } from "@/lib/auth-guard";
import { AUTOMATION_RECIPES, findRecipe, isPreviewable } from "@/lib/automation-recipes";
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

// ─── Recipes ──────────────────────────────────────────────────────────────────
//
// A rule builder on an empty list asks for an entity, a trigger, a condition and
// an action, which is four decisions before anything useful happens. The recipes
// are ordinary rules written in advance: installing one writes exactly what the
// builder would have written, and the builder can then open and change it
// (audit rilievo S-04).

/**
 * How many records a recipe would match, today.
 *
 * Not "would have acted on in the last month": that needs the history of every
 * change, which nothing here keeps. What it can honestly answer is whether the
 * rule has anything to bite on at all — a recipe that matches nothing in the
 * whole workspace is one worth not installing yet.
 *
 * Recipes whose conditions ask about a change rather than a state get no count:
 * "moved to won" is not a property a deal has, so counting deals for it would be
 * a number that means nothing.
 */
export async function getRecipeMatchCounts(): Promise<Record<string, number | null>> {
  // The same bar as installing one: whoever is shown the dialog can ask it.
  await requireWriteAccess();
  await requirePlanModule("automation");
  const db = await getDb();

  const evaluator = new ConditionEvaluator();
  const tables = { lead: leads, contact: contacts, company: companies, deal: deals, ticket: tickets, order: orders };
  const counts: Record<string, number | null> = {};

  // One read per entity type, not one per recipe.
  const rowCache = new Map<string, Record<string, unknown>[]>();

  for (const recipe of AUTOMATION_RECIPES) {
    if (!isPreviewable(recipe)) {
      counts[recipe.id] = null;
      continue;
    }

    const entity = recipe.rule.targetEntity;
    const table = tables[entity as keyof typeof tables];
    if (!table) {
      counts[recipe.id] = null;
      continue;
    }

    let rows = rowCache.get(entity);
    if (!rows) {
      // Capped: this is a hint on a dialog, not a report, and a workspace with
      // fifty thousand contacts should not pay for one either way.
      rows = (await db.select().from(table).limit(1000)) as Record<string, unknown>[];
      rowCache.set(entity, rows);
    }

    counts[recipe.id] = rows.filter((row) =>
      evaluator.evaluate(recipe.rule.conditions, recipe.rule.conditionLogic ?? "AND", {}, row),
    ).length;
  }

  return counts;
}

/** Writes one recipe as a rule of its own. Nothing marks it as having come from here. */
export async function installAutomationRecipe(recipeId: string) {
  const recipe = findRecipe(recipeId);
  if (!recipe) return { success: false, error: "No such recipe" };
  return createAutomationRule(recipe.rule);
}
