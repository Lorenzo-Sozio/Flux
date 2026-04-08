/**
 * Loop Detection Engine
 *
 * Previene cicli infiniti tracciando:
 * - La catena di rule che si innescan l'una l'altra
 * - La profondità massima di esecuzione
 * - Gli entity ID già processati nella stessa catena
 *
 * Esempio ciclo infinito:
 *   Rule A (Deal) → Update Field X
 *   Rule B (Deal) → Triggered by change to X → Update Field Y
 *   Rule C (Deal) → Triggered by change to Y → Update Field X (LOOP!)
 */

import { db } from "@/db"
import { automationLogs } from "@/db/schema"
import { eq, and, desc } from "drizzle-orm"

const MAX_RULE_DEPTH = 5
const LOOP_DETECTION_WINDOW_MS = 5000 // 5 secondi per rilevare cicli rapidi

/**
 * Execution context che traccia la catena di automazioni
 * Viene passato attraverso tutta l'esecuzione
 */
export interface ExecutionContext {
  // Catena di rule che si sono innescate
  ruleChain: {
    ruleId: string
    timestamp: number
  }[]
  
  // Entity (type + id) che sono stati processati
  processedEntities: Set<string>
  
  // Profondità corrente
  depth: number
  
  // User ID che ha triggerato la prima automazione
  originalUserId?: string
}

/**
 * Inizializza il context per una nuova catena di automazioni
 */
export function createExecutionContext(userId?: string): ExecutionContext {
  return {
    ruleChain: [],
    processedEntities: new Set(),
    depth: 0,
    originalUserId: userId,
  }
}

/**
 * Verifica se è sicuro eseguire una rule data la catena attuale
 */
export async function checkLoopDetection(
  ruleId: string,
  entityType: string,
  entityId: string,
  context: ExecutionContext,
): Promise<{ allowed: boolean; reason?: string }> {
  // 1. Check profondità massima
  if (context.depth >= MAX_RULE_DEPTH) {
    return {
      allowed: false,
      reason: `Max rule chain depth (${MAX_RULE_DEPTH}) exceeded. Rule chain: ${context.ruleChain.map((r) => r.ruleId).join(" → ")}`,
    }
  }

  // 2. Check entity già processato (stesso entity non dovrebbe essere toccato 2x nella stessa catena)
  const entityKey = `${entityType}:${entityId}`
  if (context.processedEntities.has(entityKey)) {
    return {
      allowed: false,
      reason: `Entity ${entityKey} already processed in this chain. Potential loop detected.`,
    }
  }

  // 3. Check per cicli veloci (es. rule A → B → A in 5 secondi)
  const now = Date.now()
  const recentRuleIds = context.ruleChain
    .filter((r) => now - r.timestamp < LOOP_DETECTION_WINDOW_MS)
    .map((r) => r.ruleId)

  if (recentRuleIds.includes(ruleId)) {
    return {
      allowed: false,
      reason: `Rule ${ruleId} executed recently in this chain. Rapid loop detected.`,
    }
  }

  // 4. Check per cicli lenti (query gli ultimi log)
  // Se la stessa rule è stata eseguita 3+ volte sullo stesso entity negli ultimi 10 secondi
  const recentLogs = await db
    .select({ ruleId: automationLogs.ruleId, entityId: automationLogs.entityId, createdAt: automationLogs.createdAt })
    .from(automationLogs)
    .where(
      and(
        eq(automationLogs.ruleId, ruleId),
        eq(automationLogs.entityId, entityId),
      )
    )
    .orderBy(desc(automationLogs.createdAt))
    .limit(3)

  if (recentLogs.length >= 3) {
    const timeSpan = recentLogs[0].createdAt.getTime() - recentLogs[2].createdAt.getTime()
    if (timeSpan < 10000) {
      return {
        allowed: false,
        reason: `Rule ${ruleId} executed 3 times on entity ${entityId} in 10 seconds. Slow loop detected.`,
      }
    }
  }

  return { allowed: true }
}

/**
 * Aggiorna il context con la nuova rule eseguita
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
  }
}

/**
 * Estrae la catena di rule come stringa leggibile
 */
export function formatRuleChain(context: ExecutionContext): string {
  return context.ruleChain.map((r) => r.ruleId).join(" → ") || "No chain"
}
