import { and, eq, gte } from "drizzle-orm";
import { z } from "zod";

import { automationLogs, automationRules } from "@/db/schema";
import { assertLimit, EntitlementError } from "@/lib/billing/licensing";
import { getUsage, incrementUsage } from "@/lib/billing/usage";
import { notifyMany } from "@/lib/notify";
import { evaluateCondition, getNestedFieldValue } from "@/lib/rule-conditions";
import { getCurrentTenantId, getDb } from "@/lib/tenant-context";
import { membersWith } from "@/lib/workspace-members";

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
 * Fetches all active rules for the given entity + event, evaluates conditions,
 * and dispatches matching actions. Errors are caught per-rule — one bad rule
 * never blocks the rest.
 *
 * Designed to run inside `after()` so it never delays the HTTP response.
 */
export async function runAutomations(context: RuleContext, executionCtx?: ExecutionContext): Promise<void> {
  const execCtx = executionCtx || createExecutionContext(context.currentUserId);

  // Resolve the tenant to track and enforce automation quota.
  let tenantId: string | null = null;
  try {
    tenantId = await getCurrentTenantId();
  } catch {
    // Outside request context — skip quota enforcement
  }

  const db = await getDb();
  let matching: (typeof automationRules.$inferSelect)[] = [];
  try {
    const rules = await db
      .select()
      .from(automationRules)
      .where(and(eq(automationRules.targetEntity, context.entityType), eq(automationRules.isActive, true)));

    // Filter by triggerOn client-side (array contains check is cleaner in TS); the daily run
    // names the rules it has already decided on.
    matching = rules.filter((r) => {
      const triggers = r.triggerOn as string[] | null;
      if (!Array.isArray(triggers) || !triggers.includes(context.event)) return false;
      return !context.ruleIds || context.ruleIds.includes(r.id);
    });
  } catch (err) {
    console.error("[RuleEngine] Failed to fetch rules:", err);
    return;
  }
  if (matching.length === 0) return;

  if (tenantId) {
    try {
      const { current } = await getUsage(tenantId, "automationRunsPerMonth");
      await assertLimit(tenantId, "automationRunsPerMonth", current);
    } catch (err) {
      if (err instanceof EntitlementError) {
        // ⚠️⚠️ Said where somebody will look (§8.2): the rules were skipped with one
        // `console.warn` nobody reads, so a workspace over its quota simply had automations
        // that stopped, with nothing in the log and nothing on anybody's screen.
        await recordQuotaExhausted(db, tenantId, matching, context);
        return;
      }
      // DB/network errors: log and continue rather than silently blocking automations
      console.error("[RuleEngine] Failed to check automation quota:", err);
    }
  }

  // Process rules in parallel — each rule is independent
  await Promise.allSettled(matching.map((rule) => executeRule(rule, context, execCtx, tenantId)));
}

const QUOTA_MESSAGE = "Skipped: the workspace has used its automation runs for this month.";

/** One log line per rule per day, and one notice per day to whoever manages automations. */
async function recordQuotaExhausted(
  db: Awaited<ReturnType<typeof getDb>>,
  tenantId: string,
  rules: (typeof automationRules.$inferSelect)[],
  context: RuleContext,
): Promise<void> {
  try {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const already = await db
      .select({ ruleId: automationLogs.ruleId })
      .from(automationLogs)
      .where(and(eq(automationLogs.errorMessage, QUOTA_MESSAGE), gte(automationLogs.createdAt, midnight)));
    const logged = new Set(already.map((r) => r.ruleId));
    const fresh = rules.filter((r) => !logged.has(r.id));
    if (fresh.length === 0) return;
    await db.insert(automationLogs).values(
      fresh.map((rule) => ({
        ruleId: rule.id,
        entityType: context.entityType,
        entityId: context.entityId,
        event: context.event,
        success: false,
        actionsExecuted: 0,
        errorMessage: QUOTA_MESSAGE,
      })),
    );
    // The first line of the day is also the moment to tell a person.
    if (logged.size === 0) {
      const managers = await membersWith(tenantId, "automation:manage");
      await notifyMany(
        managers.map((userId) => ({
          userId,
          type: "system",
          key: "automationQuota" as const,
          params: { rules: fresh.length },
          link: "/dashboard/automation",
        })),
      );
    }
  } catch (err) {
    console.error("[RuleEngine] quota exhausted, and it could not be recorded:", err);
  }
}

/** Whether a stored rule's conditions hold for this data — for the daily run and the dry run. */
export function ruleConditionsHold(
  rule: Pick<typeof automationRules.$inferSelect, "conditions" | "conditionLogic" | "conditionExpression">,
  newData: Record<string, unknown>,
  oldData?: Record<string, unknown>,
): boolean {
  const conditions = z.array(ConditionSchema).parse(JSON.parse(rule.conditions));
  const logic = (rule.conditionLogic ?? "AND") as "AND" | "OR";
  return evaluateConditions(conditions, logic, rule.conditionExpression ?? "", oldData, newData);
}

/** Each condition of a rule, with whether it holds for this data: what "test on this record" shows. */
export function explainConditions(
  conditions: Condition[],
  newData: Record<string, unknown>,
  oldData?: Record<string, unknown>,
): { condition: Condition; holds: boolean; actual: unknown }[] {
  return conditions.map((condition) => ({
    condition,
    holds: evaluateCondition(condition, newData, oldData),
    actual: getNestedFieldValue(newData, condition.field),
  }));
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
