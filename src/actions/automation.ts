"use server";

import { revalidatePath } from "next/cache";

import { desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { ConditionEvaluator } from "@/components/crm/automation/condition-evaluator";
import { explainConditions, ruleConditionsHold } from "@/components/crm/automation/rule-engine";
import {
  type AutomationRuleFormData,
  AutomationRuleFormSchema,
  type Condition,
  ConditionSchema,
} from "@/components/crm/automation/types";
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
import { requireCapability, requirePlanModule, requireWriteAccess } from "@/lib/auth-guard";
import { AUTOMATION_RECIPES, findRecipe, isPreviewable } from "@/lib/automation-recipes";
import { dealSignals, lastActivityByDeal } from "@/lib/deal-signals";
import { serverT } from "@/lib/i18n-server";
import { getDb } from "@/lib/tenant-context";

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getAutomationRules() {
  await requireCapability("record:read");
  await requirePlanModule("automation");
  const db = await getDb();
  return db.select().from(automationRules).orderBy(desc(automationRules.createdAt));
}

export async function getAutomationRuleById(id: string) {
  await requireCapability("automation:manage");
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
  await requireCapability("record:read");
  await requirePlanModule("automation");
  const db = await getDb();
  return db.select().from(automationLogs).orderBy(desc(automationLogs.createdAt)).limit(limit);
}

/**
 * Automation email send log (campaignId IS NULL = sent by automation, not a campaign).
 */
export async function getAutomationEmailLogs(limit = 100) {
  await requireCapability("record:read");
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
  const actor = await requireCapability("automation:manage");
  await requirePlanModule("automation");
  const db = await getDb();

  // Server-side Zod validation (also validates nested JSON structures)
  const parsed = AutomationRuleFormSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? (await serverT())("automation.invalidRule") };
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
    ownerId: actor.userId,
  });

  revalidatePath("/dashboard/automation");
  return { success: true };
}

// ─── Update ───────────────────────────────────────────────────────────────────

export async function updateAutomationRule(id: string, data: AutomationRuleFormData) {
  await requireCapability("automation:manage");
  await requirePlanModule("automation");
  const db = await getDb();

  const parsed = AutomationRuleFormSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? (await serverT())("automation.invalidRule") };
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
  await requireCapability("automation:manage");
  await requirePlanModule("automation");
  const db = await getDb();
  await db.update(automationRules).set({ isActive, updatedAt: new Date() }).where(eq(automationRules.id, id));
  revalidatePath("/dashboard/automation");
  return { success: true };
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function deleteAutomationRule(id: string) {
  await requireCapability("automation:manage");
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
export async function getRecipeMatchCounts(): Promise<{
  counts: Record<string, number | null>;
  installed: string[];
}> {
  // The same bar as installing one: whoever is shown the dialog can ask it.
  await requireCapability("automation:manage");
  await requirePlanModule("automation");
  const db = await getDb();

  // Which are already here. Installing the same recipe twice writes two identical
  // rules and both of them fire, so the dialog has to know before it offers.
  const existing = await db.select({ name: automationRules.name }).from(automationRules);
  const names = new Set(existing.map((r) => r.name));
  const installed = AUTOMATION_RECIPES.filter((r) => names.has(r.rule.name)).map((r) => r.id);

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

  return { counts, installed };
}

/**
 * Writes one recipe as a rule of its own. Nothing marks it as having come from
 * here, which is the point: it is an ordinary rule afterwards.
 *
 * Refused when a rule of that name is already there. Two copies of the same rule
 * both fire, so a second click would quietly double every task it creates — and
 * the dialog's memory of what it installed does not survive a reload, so the
 * second click is easy to make.
 */
export async function installAutomationRecipe(recipeId: string) {
  const recipe = findRecipe(recipeId);
  if (!recipe) return { success: false, error: (await serverT())("automation.noSuchRecipe") };

  await requireCapability("automation:manage");
  const db = await getDb();
  const [already] = await db
    .select({ id: automationRules.id })
    .from(automationRules)
    .where(eq(automationRules.name, recipe.rule.name))
    .limit(1);
  if (already) return { success: false, error: "already-installed" };

  return createAutomationRule(recipe.rule);
}

// ── Test a rule on a record (§8.2) ────────────────────────────────────────────

const TESTABLE: Record<
  string,
  {
    table: typeof deals | typeof leads | typeof contacts | typeof companies | typeof tickets | typeof orders;
    label: (r: Record<string, unknown>) => string;
  }
> = {
  deal: { table: deals, label: (r) => String(r.name ?? r.id) },
  lead: { table: leads, label: (r) => `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim() || String(r.id) },
  contact: { table: contacts, label: (r) => `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim() || String(r.id) },
  company: { table: companies, label: (r) => String(r.name ?? r.id) },
  ticket: { table: tickets, label: (r) => `${r.ticketNumber ?? ""} ${r.subject ?? ""}`.trim() },
  order: { table: orders, label: (r) => String(r.orderNumber ?? r.id) },
};

/** The newest records of a kind, for picking one to test a rule on. */
export async function recordsForRuleTest(entity: string): Promise<{ id: string; label: string }[]> {
  await requireCapability("automation:manage");
  const spec = TESTABLE[entity];
  if (!spec) return [];
  const db = await getDb();
  const rows = (await db.select().from(spec.table).orderBy(desc(spec.table.createdAt)).limit(25)) as Record<
    string,
    unknown
  >[];
  return rows.map((r) => ({ id: String(r.id), label: spec.label(r) }));
}

/**
 * Condition by condition, whether a rule would run on this record — without running it.
 *
 * ⚠️ "Why did my rule not fire?" had no answer: a rule that did not apply writes nothing
 * (rightly), and there was no way to ask. The data is the record as the engine sees it,
 * with the days without activity the daily run works out for a deal.
 */
export async function testRuleAction(input: {
  entity: string;
  recordId: string;
  conditions: Condition[];
  logic: "AND" | "OR";
  expression?: string;
}): Promise<{ holds: boolean; details: { condition: Condition; holds: boolean; actual: unknown }[] } | null> {
  await requireCapability("automation:manage");
  const spec = TESTABLE[input.entity];
  if (!spec) return null;
  const db = await getDb();
  const [row] = (await db.select().from(spec.table).where(eq(spec.table.id, input.recordId))) as Record<
    string,
    unknown
  >[];
  if (!row) return null;
  let data: Record<string, unknown> = row;
  if (input.entity === "deal") {
    const last = lastActivityByDeal(db, new Date());
    const [a] = await db.select({ at: last.at }).from(last).where(eq(last.dealId, input.recordId));
    data = {
      ...row,
      idleDays: dealSignals({
        createdAt: row.createdAt as Date,
        lastActivityAt: a?.at ?? null,
        hasNextStep: false,
        nextStepAt: null,
      }).idleDays,
    };
  }
  const conditions = z.array(ConditionSchema).parse(input.conditions);
  return {
    holds: ruleConditionsHold(
      {
        conditions: JSON.stringify(conditions),
        conditionLogic: input.logic,
        conditionExpression: input.expression ?? "",
      },
      data,
      data,
    ),
    details: explainConditions(conditions, data, data),
  };
}
