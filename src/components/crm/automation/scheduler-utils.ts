/**
 * Pure scheduler utilities — safe to import in both client and server code.
 * Keep this file free of any Node.js-only imports (no node-cron, no db, etc.)
 */

export const SCHEDULED_TRIGGER_PREFIX = "scheduled:"

export function parseScheduledTrigger(triggerStr: string): string | null {
  if (triggerStr.startsWith(SCHEDULED_TRIGGER_PREFIX)) {
    return triggerStr.substring(SCHEDULED_TRIGGER_PREFIX.length)
  }
  return null
}

export function encodeScheduledTrigger(cronExpression: string): string {
  return `${SCHEDULED_TRIGGER_PREFIX}${cronExpression}`
}
