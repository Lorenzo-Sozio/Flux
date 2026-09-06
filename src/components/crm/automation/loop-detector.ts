/**
 * Loop Detection Engine
 *
 * Previene cicli infiniti tracciando:
 * - The chain of rules that set each other off
 * - The maximum execution depth
 * - The entity ids already processed within the same chain
 *
 * Esempio ciclo infinito:
 *   Rule A (Deal) → Update Field X
 *   Rule B (Deal) → Triggered by change to X → Update Field Y
 *   Rule C (Deal) → Triggered by change to Y → Update Field X (LOOP!)
 */

import { and, desc, eq } from "drizzle-orm";

import { automationLogs } from "@/db/schema";
import { getDb } from "@/lib/tenant-context";

const MAX_RULE_DEPTH = 5;
const LOOP_DETECTION_WINDOW_MS = 5000; // 5 secondi per rilevare cicli rapidi

/**
 * The execution context that tracks the chain of automations.
 * It is passed through the whole run.
 */
export interface ExecutionContext {
  // The chain of rules that have fired
  ruleChain: {
    ruleId: string;
    timestamp: number;
  }[];

  // The entities (type + id) already processed
  processedEntities: Set<string>;

  // Current depth
  depth: number;

  // The user whose action set the first automation off
  originalUserId?: string;
}

/**
 * Starts a context for a new chain of automations.
 */
export function createExecutionContext(userId?: string): ExecutionContext {
  return {
    ruleChain: [],
    processedEntities: new Set(),
    depth: 0,
    originalUserId: userId,
  };
}

/**
 * Whether it is safe to run a rule, given the chain so far.
 */
export async function checkLoopDetection(
  ruleId: string,
  entityType: string,
  entityId: string,
  context: ExecutionContext,
): Promise<{ allowed: boolean; reason?: string }> {
  // 1. Maximum depth
  if (context.depth >= MAX_RULE_DEPTH) {
    return {
      allowed: false,
      reason: `Max rule chain depth (${MAX_RULE_DEPTH}) exceeded. Rule chain: ${context.ruleChain.map((r) => r.ruleId).join(" → ")}`,
    };
  }

  // 2. Entity already processed — the same one should not be touched twice in a chain
  const entityKey = `${entityType}:${entityId}`;
  if (context.processedEntities.has(entityKey)) {
    return {
      allowed: false,
      reason: `Entity ${entityKey} already processed in this chain. Potential loop detected.`,
    };
  }

  // 3. Check per cicli veloci (es. rule A → B → A in 5 secondi)
  const now = Date.now();
  const recentRuleIds = context.ruleChain
    .filter((r) => now - r.timestamp < LOOP_DETECTION_WINDOW_MS)
    .map((r) => r.ruleId);

  if (recentRuleIds.includes(ruleId)) {
    return {
      allowed: false,
      reason: `Rule ${ruleId} executed recently in this chain. Rapid loop detected.`,
    };
  }

  // 4. Slow loops, read from the recent log
  // If the same rule has run 3+ times on the same entity in the last 10 seconds
  const db = await getDb();
  const recentLogs = await db
    .select({ ruleId: automationLogs.ruleId, entityId: automationLogs.entityId, createdAt: automationLogs.createdAt })
    .from(automationLogs)
    .where(and(eq(automationLogs.ruleId, ruleId), eq(automationLogs.entityId, entityId)))
    .orderBy(desc(automationLogs.createdAt))
    .limit(3);

  if (recentLogs.length >= 3) {
    const timeSpan = recentLogs[0].createdAt.getTime() - recentLogs[2].createdAt.getTime();
    if (timeSpan < 10000) {
      return {
        allowed: false,
        reason: `Rule ${ruleId} executed 3 times on entity ${entityId} in 10 seconds. Slow loop detected.`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Records the rule that has just run in the context.
 */
export function recordRuleExecution(
  ruleId: string,
  entityType: string,
  entityId: string,
  context: ExecutionContext,
): ExecutionContext {
  return {
    ...context,
    ruleChain: [...context.ruleChain, { ruleId, timestamp: Date.now() }],
    processedEntities: new Set([...context.processedEntities, `${entityType}:${entityId}`]),
    depth: context.depth + 1,
  };
}

/**
 * Estrae la catena di rule come stringa leggibile
 */
export function formatRuleChain(context: ExecutionContext): string {
  return context.ruleChain.map((r) => r.ruleId).join(" → ") || "No chain";
}
