import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { automationLogs, automationRules } from "@/db/schema";
import { assertLimit, EntitlementError } from "@/lib/billing/licensing";
import { getUsage, incrementUsage } from "@/lib/billing/usage";
import { getCurrentTenantId, getDb } from "@/lib/tenant-context";

import type { Condition, RuleContext } from "../../crm/automation/types";
import { ActionSchema, ConditionSchema } from "../../crm/automation/types";
import { ActionDispatcher } from "./action-dispatcher";
import { compileExpression, validateExpression } from "./condition-parser";
import {
  checkLoopDetection,
  createExecutionContext,
  type ExecutionContext,
  formatRuleChain,
  recordRuleExecution,
} from "./loop-detector";

const dispatcher = new ActionDispatcher();

// ─── Condition Evaluation Helper ───────────────────────────────────────────────

/**
 * Evaluates the conditions, supporting both simple logic and full expressions.
 */
function evaluateConditions(
  conditions: Condition[],
  simpleLogic: "AND" | "OR",
  advancedExpression: string,
  oldData: Record<string, unknown> | undefined,
  newData: Record<string, unknown>,
): boolean {
  // Use the advanced expression when there is one and it is not empty
  if (advancedExpression?.trim()) {
    try {
      // Valida l'espressione
      const validation = validateExpression(advancedExpression, conditions.length);

      if (!validation.valid || !validation.tree) {
        console.warn(`[RuleEngine] Invalid condition expression: ${advancedExpression}`, validation.errors);
        // Fallback a logica semplice
        return evaluateSimpleConditions(conditions, simpleLogic, oldData, newData);
      }

      // Evaluate each condition
      const evaluatedConditions = conditions.map((cond) => evaluateCondition(cond, newData, oldData));

      // Compila e esegui l'espressione
      const evaluator_compiled = compileExpression(validation.tree);
      return evaluator_compiled(evaluatedConditions);
    } catch (error) {
      console.warn(`[RuleEngine] Error evaluating expression: ${error}`);
      // Fallback
      return evaluateSimpleConditions(conditions, simpleLogic, oldData, newData);
    }
  }

  // Usa logica semplice
  return evaluateSimpleConditions(conditions, simpleLogic, oldData, newData);
}

/**
 * Valuta le condizioni usando logica semplice (AND/OR globale)
 */
function evaluateSimpleConditions(
  conditions: Condition[],
  logic: "AND" | "OR",
  oldData: Record<string, unknown> | undefined,
  newData: Record<string, unknown>,
): boolean {
  const evaluated = conditions.map((cond) => evaluateCondition(cond, newData, oldData));

  if (logic === "OR") {
    return evaluated.some((c) => c);
  }
  return evaluated.every((c) => c);
}

/**
 * Evaluates a single condition.
 */
function evaluateCondition(
  condition: Condition,
  entityData: Record<string, unknown>,
  oldData?: Record<string, unknown>,
): boolean {
  const fieldValue = getNestedFieldValue(entityData, condition.field);
  const oldValue = oldData ? getNestedFieldValue(oldData, condition.field) : undefined;
  const conditionValue = condition.value;

  switch (condition.operator) {
    case "equals":
      return fieldValue === conditionValue;

    case "not_equals":
      return fieldValue !== conditionValue;

    case "greater_than":
      return Number(fieldValue) > Number(conditionValue);

    case "less_than":
      return Number(fieldValue) < Number(conditionValue);

    case "greater_than_or_equal":
      return Number(fieldValue) >= Number(conditionValue);

    case "less_than_or_equal":
      return Number(fieldValue) <= Number(conditionValue);

    case "contains":
      return String(fieldValue).includes(String(conditionValue));

    case "not_contains":
      return !String(fieldValue).includes(String(conditionValue));

    case "is_empty":
      return !fieldValue || fieldValue === "" || (Array.isArray(fieldValue) && fieldValue.length === 0);

    case "is_not_empty":
      return !!fieldValue && fieldValue !== "" && (!Array.isArray(fieldValue) || fieldValue.length > 0);

    case "changed":
      return oldValue !== fieldValue;

    case "changed_to":
      return fieldValue === conditionValue && oldValue !== fieldValue;

    case "changed_from":
      return oldValue === conditionValue && fieldValue !== oldValue;

    default:
      console.warn(`[RuleEngine] Unknown operator: ${condition.operator}`);
      return false;
  }
}

/**
 * Helper per leggere valori nested (es: "company.name")
 */
function getNestedFieldValue(data: Record<string, unknown>, fieldPath: string): unknown {
  const parts = fieldPath.split(".");
  let value: unknown = data;

  for (const part of parts) {
    if (value == null || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[part];
  }

  return value;
}

/**
 * Fetches all active rules for the given entity + event, evaluates conditions,
 * and dispatches matching actions. Errors are caught per-rule — one bad rule
 * never blocks the rest.
 *
 * Designed to run inside `after()` so it never delays the HTTP response.
 */
export async function runAutomations(context: RuleContext, executionCtx?: ExecutionContext): Promise<void> {
  const execCtx = executionCtx || createExecutionContext(context.currentUserId);

  // Resolve the tenant to track and enforce automation quota.
  // getCurrentTenantId() may return null when called from cron jobs or the
  // scheduler — in those cases we skip quota tracking rather than blocking.
  let tenantId: string | null = null;
  try {
    tenantId = await getCurrentTenantId();
  } catch {
    // Outside request context (e.g. scheduled jobs) — skip quota enforcement
  }

  if (tenantId) {
    try {
      const { current } = await getUsage(tenantId, "automationRunsPerMonth");
      await assertLimit(tenantId, "automationRunsPerMonth", current);
    } catch (err) {
      if (err instanceof EntitlementError) {
        console.warn(`[RuleEngine] automationRunsPerMonth limit reached for tenant ${tenantId} — skipping rules`);
        return;
      }
      // DB/network errors: log and continue rather than silently blocking automations
      console.error("[RuleEngine] Failed to check automation quota:", err);
    }
  }

  const db = await getDb();
  try {
    const rules = await db
      .select()
      .from(automationRules)
      .where(and(eq(automationRules.targetEntity, context.entityType), eq(automationRules.isActive, true)));

    // Filter by triggerOn client-side (array contains check is cleaner in TS)
    const matching = rules.filter((r) => {
      const triggers = r.triggerOn as string[] | null;
      return Array.isArray(triggers) && triggers.includes(context.event);
    });

    // Process rules in parallel — each rule is independent
    await Promise.allSettled(matching.map((rule) => executeRule(rule, context, execCtx, tenantId)));
  } catch (err) {
    console.error("[RuleEngine] Failed to fetch rules:", err);
  }
}

// ─── Per-rule execution ───────────────────────────────────────────────────────

async function executeRule(
  rule: typeof automationRules.$inferSelect,
  context: RuleContext,
  executionCtx: ExecutionContext,
  tenantId: string | null,
): Promise<void> {
  let success = false;
  let actionsExecuted = 0;
  let totalRetries = 0;
  let errorMessage: string | undefined;
  // A rule whose conditions simply did not match has not failed, and writing a
  // row for it turned the log into one line per rule per record change — growing
  // without bound and burying the failures somebody is actually looking for
  // (audit rilievo D-09).
  let didNotApply = false;
  const db = await getDb();

  try {
    // 1. Loop detection — is it safe to run this rule
    const loopCheck = await checkLoopDetection(rule.id, context.entityType, context.entityId, executionCtx);
    if (!loopCheck.allowed) {
      errorMessage = loopCheck.reason;
      console.warn(`[RuleEngine] Rule "${rule.name}" blocked - ${loopCheck.reason}`);
      // Do not run it, but record the blocked attempt
      await db
        .insert(automationLogs)
        .values({
          ruleId: rule.id,
          entityType: context.entityType,
          entityId: context.entityId,
          event: context.event,
          success: false,
          actionsExecuted: 0,
          errorMessage: errorMessage,
          loopDetected: true,
          retryCount: 0,
        })
        .catch((logErr) => {
          console.error("[RuleEngine] Failed to write automation log:", logErr);
        });
      return;
    }

    // 2. Record this rule in the execution context
    const nextExecCtx = recordRuleExecution(rule.id, context.entityType, context.entityId, executionCtx);

    // 3. Parse + validate conditions from stored JSON (defense-in-depth)
    const conditions = z.array(ConditionSchema).parse(JSON.parse(rule.conditions));
    const logic = (rule.conditionLogic ?? "AND") as "AND" | "OR";

    // Evaluate the conditions (simple logic and full expressions alike)
    const conditionsMet = evaluateConditions(
      conditions,
      logic,
      rule.conditionExpression ?? "",
      context.oldData,
      context.newData,
    );
    if (!conditionsMet) {
      didNotApply = true;
      return; // the happy-path fast exit: nothing happened, so nothing is recorded
    }

    // 4. Parse + validate actions from stored JSON
    //    Zod discriminated union rejects any unknown action type here.
    const actions = z.array(ActionSchema).parse(JSON.parse(rule.actions));

    // 5. Dispatch con execution context per propagare la catena
    const dispatched = await dispatcher.dispatchAll(actions, context, nextExecCtx);
    actionsExecuted = dispatched.actionsExecuted;
    totalRetries = dispatched.totalRetries;
    if (dispatched.lastError) errorMessage = dispatched.lastError;
    success = actionsExecuted > 0 || actions.length === 0;

    // Count each rule that actually dispatched actions against the monthly quota
    if (actionsExecuted > 0 && tenantId) {
      // biome-ignore lint/suspicious/noEmptyBlockStatements: fire-and-forget
      incrementUsage(tenantId, "automationRunsPerMonth", 1).catch(() => {});
    }

    console.log(
      `[RuleEngine] Rule "${rule.name}" executed ${actionsExecuted} action(s) on ${context.entityType}:${context.entityId}. Chain: ${formatRuleChain(nextExecCtx)}`,
    );
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[RuleEngine] Rule "${rule.name}" failed:`, err);
  } finally {
    // A log entry for everything that ran. "Did not apply" is the overwhelming
    // majority of evaluations and is not worth a row.
    if (!didNotApply) {
      await db
        .insert(automationLogs)
        .values({
          ruleId: rule.id,
          entityType: context.entityType,
          entityId: context.entityId,
          event: context.event,
          success,
          actionsExecuted,
          errorMessage: errorMessage ?? null,
          retryCount: totalRetries,
          retryInfo:
            totalRetries > 0
              ? JSON.stringify({
                  attempts: totalRetries,
                  maxAttempts: actionsExecuted * 3,
                  exponentialBackoff: true,
                  lastError: errorMessage ?? null,
                })
              : null,
        })
        .catch((logErr) => {
          // Never let a logging failure propagate — the action already ran
          console.error("[RuleEngine] Failed to write automation log:", logErr);
        });
    }
  }
}
