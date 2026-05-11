/**
 * Email Service
 *
 * Sends emails via Resend API with merge field support
 *
 * Merge Fields Supportati:
 * - {{contact.email}}, {{contact.name}}, {{contact.firstName}}, {{contact.lastName}}
 * - {{lead.email}}, {{lead.name}}, {{lead.firstName}}, {{lead.lastName}}
 * - {{deal.name}}, {{deal.amount}}, {{deal.probability}}, {{deal.status}}
 * - {{company.name}}, {{company.type}}, {{company.industry}}
 * - {{owner.name}}, {{owner.email}}
 * - {{createdAt}}, {{updatedAt}} (date ISO)
 */

import { getDb } from "@/lib/tenant-context";
import { campaignLogs, deals, leads, contacts, companies, users } from "@/db/schema"
import { eq } from "drizzle-orm"
import { executeWithRetryTracked } from "../../crm/automation/retry-engine"
import type { RuleContext } from "../../crm/automation/types"

const APP_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000"

/** Wraps external links for click tracking (same helper as marketing.ts). */
function wrapLinksForTracking(html: string, logId: string): string {
  return html.replace(/href="(https?:\/\/[^"]+)"/gi, (match, url: string) => {
    if (url.includes("/api/track/") || url.includes("/api/unsubscribe")) return match
    const tracked = `${APP_URL}/api/track/click?log=${encodeURIComponent(logId)}&url=${encodeURIComponent(url)}`
    return `href="${tracked}"`
  })
}

const RESEND_API_KEY = process.env.RESEND_API_KEY
const RESEND_API_URL = "https://api.resend.com/emails"
const AUTOMATION_FROM_EMAIL =
  process.env.AUTOMATION_FROM_EMAIL ?? "automation@fluxcrm.app"

/**
 * Merge fields helper
 * Sostituisce {{key}} con i valori dal contesto
 */
export function replaceMergeFields(
  template: string,
  data: Record<string, any>,
): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const keys = key.split(".")
    let value: any = data

    for (const k of keys) {
      value = value?.[k]
    }

    return value !== undefined ? String(value) : match
  })
}

/**
 * Carica i dati dell'entity per il merge
 */
async function loadEntityData(
  entityType: string,
  entityId: string,
): Promise<Record<string, any>> {
  let table: any
  switch (entityType) {
    case "deal":
      table = deals
      break
    case "lead":
      table = leads
      break
    case "contact":
      table = contacts
      break
    case "company":
      table = companies
      break
    default:
      return {}
  }

  const db = await getDb();
  const [entity] = await db.select().from(table).where(eq(table.id, entityId))
  return entity ?? {}
}

/**
 * Carica i dati dell'owner
 */
async function loadOwnerData(ownerId: string | null): Promise<Record<string, any>> {
  const db = await getDb();
  if (!ownerId) return {}
  const [owner] = await db.select().from(users).where(eq(users.id, ownerId))
  return owner ? { owner } : {}
}

/**
 * Invia un'email via Resend
 */
export async function sendAutomationEmail(
  to: string,
  cc: string | undefined,
  bcc: string | undefined,
  subject: string,
  body: string,
): Promise<{ success: boolean; messageId?: string; error?: string; retryCount: number }> {
  if (!RESEND_API_KEY) {
    return { success: false, error: "RESEND_API_KEY not configured", retryCount: 0 }
  }

  try {
    const { result, attempts } = await executeWithRetryTracked(
      async () => {
        const response = await fetch(RESEND_API_URL, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: AUTOMATION_FROM_EMAIL,
            to,
            cc: cc ? cc.split(",").map((e) => e.trim()) : undefined,
            bcc: bcc ? bcc.split(",").map((e) => e.trim()) : undefined,
            subject,
            html: body,
            tags: [{ name: "source", value: "automation" }],
          }),
        })

        if (!response.ok) {
          const errData = await response.json()
          throw new Error(
            `Resend API error: ${response.status} - ${errData.message || response.statusText}`,
          )
        }

        return response.json()
      },
      { maxRetries: 3, initialDelayMs: 1000, maxDelayMs: 10000, strategy: "exponential" },
    )

    return { success: true, messageId: result.id, retryCount: attempts }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      retryCount: 0,
    }
  }
}

/**
 * Prepara e invia un'email nell'ambito di un'automazione
 */
/** Resolves merge fields, sends the email, and returns the number of retries consumed. */
export async function sendAutomationEmailWithContext(
  to: string,
  cc: string | undefined,
  bcc: string | undefined,
  subject: string,
  body: string,
  trackOpens: boolean,
  trackClicks: boolean,
  context: RuleContext,
): Promise<number> {
  // Load entity data for merge fields
  const entityData = await loadEntityData(context.entityType, context.entityId)
  const ownerData = await loadOwnerData((entityData as any).ownerId)

  const mergeData = {
    ...entityData,
    ...ownerData,
    createdAt: entityData.createdAt?.toISOString(),
    updatedAt: entityData.updatedAt?.toISOString(),
  }

  // Resolve merge fields
  const finalTo      = replaceMergeFields(to, mergeData)
  const finalCc      = cc      ? replaceMergeFields(cc,      mergeData) : undefined
  const finalBcc     = bcc     ? replaceMergeFields(bcc,     mergeData) : undefined
  const finalSubject = replaceMergeFields(subject, mergeData)
  let   finalBody    = replaceMergeFields(body,    mergeData)

  if (!finalTo.includes("@")) {
    throw new Error(`Invalid recipient email after merge: ${finalTo} (original: ${to})`)
  }

  // Create a campaign_log record (campaignId = null → automation email)
  // This allows the same /api/track/* endpoints to record opens/clicks.
  const db = await getDb();
  const [log] = await db
    .insert(campaignLogs)
    .values({
      campaignId: null,
      contactId:  context.entityType === "contact" ? context.entityId : null,
      leadId:     context.entityType === "lead"    ? context.entityId : null,
      status:     "sent",
      sentAt:     new Date(),
    })
    .returning()

  // Self-host tracking: inject pixel and wrap links before sending
  if (trackClicks) {
    finalBody = wrapLinksForTracking(finalBody, log.id)
  }
  if (trackOpens) {
    finalBody = `${finalBody}\n<img src="${APP_URL}/api/track/open?log=${encodeURIComponent(log.id)}" width="1" height="1" alt="" style="display:none" />`
  }

  const result = await sendAutomationEmail(finalTo, finalCc, finalBcc, finalSubject, finalBody)

  if (!result.success) {
    // Mark the log as failed
    await db
      .update(campaignLogs)
      .set({ status: "failed", errorMessage: result.error ?? "Unknown error" })
      .where(eq(campaignLogs.id, log.id))
    throw new Error(`Failed to send email: ${result.error}`)
  }

  // Store the provider message ID for future webhook correlation
  if (result.messageId) {
    await db
      .update(campaignLogs)
      .set({ messageId: result.messageId })
      .where(eq(campaignLogs.id, log.id))
  }

  return result.retryCount
}
