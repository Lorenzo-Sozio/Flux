"use server"

import { db } from "@/db"
import { automationRules, automationLogs } from "@/db/schema"
import { eq, desc } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { requireAdminAccess, requireWriteAccess } from "@/lib/auth-guard"
import { AutomationRuleFormSchema, type AutomationRuleFormData } from "@/components/crm/automation/types"

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getAutomationRules() {
  return db.select().from(automationRules).orderBy(desc(automationRules.createdAt))
}

export async function getAutomationRuleById(id: string) {
  const [rule] = await db.select().from(automationRules).where(eq(automationRules.id, id))
  return rule ?? null
}

export async function getAutomationLogs(ruleId: string, limit = 50) {
  return db
    .select()
    .from(automationLogs)
    .where(eq(automationLogs.ruleId, ruleId))
    .orderBy(desc(automationLogs.createdAt))
    .limit(limit)
}

/**
 * Fetch recent logs across all rules (for dashboard overview)
 */
export async function getRecentAutomationLogs(limit = 50) {
  return db
    .select()
    .from(automationLogs)
    .orderBy(desc(automationLogs.createdAt))
    .limit(limit)
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createAutomationRule(data: AutomationRuleFormData) {
  const session = await requireWriteAccess()

  // Server-side Zod validation (also validates nested JSON structures)
  const parsed = AutomationRuleFormSchema.safeParse(data)
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? "Invalid rule data" }
  }

  const { name, description, isActive, targetEntity, triggerOn, conditionLogic, conditions, actions } = parsed.data

  await db.insert(automationRules).values({
    name,
    description:    description ?? null,
    isActive,
    targetEntity,
    triggerOn,
    conditionLogic,
    conditions:     JSON.stringify(conditions),
    actions:        JSON.stringify(actions),
    ownerId:        session.user.id,
  })

  revalidatePath("/dashboard/automation")
  return { success: true }
}

// ─── Update ───────────────────────────────────────────────────────────────────

export async function updateAutomationRule(id: string, data: AutomationRuleFormData) {
  await requireWriteAccess()

  const parsed = AutomationRuleFormSchema.safeParse(data)
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? "Invalid rule data" }
  }

  const { name, description, isActive, targetEntity, triggerOn, conditionLogic, conditions, actions } = parsed.data

  await db
    .update(automationRules)
    .set({
      name,
      description:    description ?? null,
      isActive,
      targetEntity,
      triggerOn,
      conditionLogic,
      conditions:     JSON.stringify(conditions),
      actions:        JSON.stringify(actions),
      updatedAt:      new Date(),
    })
    .where(eq(automationRules.id, id))

  revalidatePath("/dashboard/automation")
  return { success: true }
}

// ─── Toggle active ────────────────────────────────────────────────────────────

export async function toggleAutomationRuleActive(id: string, isActive: boolean) {
  await requireWriteAccess()
  await db
    .update(automationRules)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(automationRules.id, id))
  revalidatePath("/dashboard/automation")
  return { success: true }
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function deleteAutomationRule(id: string) {
  await requireAdminAccess()
  await db.delete(automationRules).where(eq(automationRules.id, id))
  revalidatePath("/dashboard/automation")
  return { success: true }
}
