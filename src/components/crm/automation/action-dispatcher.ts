import { db } from "@/db"
import { tasks, notifications, deals, leads, contacts, companies } from "@/db/schema"
import { eq } from "drizzle-orm"
import { runAutomations } from "../../crm/automation/rule-engine"
import { sendAutomationEmailWithContext } from "../../crm/automation/email-service"
import { sendWebhook } from "../../crm/automation/webhook-service"
import type { AutomationAction, RuleContext } from "../../crm/automation/types"
import type { ExecutionContext } from "../../crm/automation/loop-detector"

/**
 * Executes validated AutomationActions.
 *
 * Security: this class is only ever called with actions that have already
 * been validated by Zod's discriminated union (ActionSchema). Any action
 * type not in the union is structurally impossible to reach here.
 */
export class ActionDispatcher {

  /** Run all actions sequentially; returns the count of successful ones. */
  async dispatchAll(actions: AutomationAction[], context: RuleContext, executionCtx: ExecutionContext): Promise<number> {
    let count = 0
    for (const action of actions) {
      try {
        await this.dispatch(action, context, executionCtx)
        count++
      } catch (err) {
        console.error(`[ActionDispatcher] "${action.type}" failed for ${context.entityType}:${context.entityId}`, err)
      }
    }
    return count
  }

  // ─── Router ──────────────────────────────────────────────────────────────────

  private async dispatch(action: AutomationAction, context: RuleContext, executionCtx: ExecutionContext): Promise<void> {
    switch (action.type) {
      case "create_task":        return this.createTask(action, context)
      case "send_notification":  return this.sendNotification(action, context)
      case "send_email":         return this.sendEmail(action, context)
      case "send_webhook":       return this.sendWebhookAction(action, context)
      case "update_field":       return this.updateField(action, context, executionCtx)
      // TypeScript exhaustiveness: no `default` — new action types require an explicit case.
    }
  }

  // ─── Action: create_task ──────────────────────────────────────────────────────

  private async createTask(
    action: Extract<AutomationAction, { type: "create_task" }>,
    context: RuleContext,
  ): Promise<void> {
    const { title, description, priority, dueDateDays, assigneeId } = action.params

    const dueDate = dueDateDays !== undefined
      ? new Date(Date.now() + dueDateDays * 24 * 60 * 60 * 1000)
      : undefined

    // Map entity type to the correct FK column on the task table
    const entityFkMap: Record<string, string> = {
      deal:    "dealId",
      lead:    "leadId",
      contact: "contactId",
      company: "companyId",
    }
    const entityFk = entityFkMap[context.entityType]

    await db.insert(tasks).values({
      title,
      description:  description ?? null,
      priority:     priority ?? "normal",
      dueDate:      dueDate ?? null,
      status:       "todo",
      assigneeId:   assigneeId ?? null,
      ownerId:      context.currentUserId ?? null,
      [entityFk]:   context.entityId,
    } as any)
  }

  // ─── Action: send_notification ────────────────────────────────────────────────

  private async sendNotification(
    action: Extract<AutomationAction, { type: "send_notification" }>,
    context: RuleContext,
  ): Promise<void> {
    const { title, message } = action.params
    let { userId } = action.params

    // Resolve the special sentinel to the entity's actual owner
    if (userId === "entity_owner") {
      const owner = await this.resolveEntityOwner(context)
      if (!owner) return   // nothing to notify — entity has no owner
      userId = owner
    }

    await db.insert(notifications).values({
      userId,
      type:    "automation",
      title,
      message,
      link:    this.entityLink(context),
    })
  }

  // ─── Action: send_email ───────────────────────────────────────────────────────

  private async sendEmail(
    action: Extract<AutomationAction, { type: "send_email" }>,
    context: RuleContext,
  ): Promise<void> {
    const { to, cc, bcc, subject, body, trackOpens, trackClicks } = action.params

    await sendAutomationEmailWithContext(
      to,
      cc,
      bcc,
      subject,
      body,
      trackOpens ?? false,
      trackClicks ?? false,
      context,
    )
  }

  // ─── Action: send_webhook ─────────────────────────────────────────────────────

  private async sendWebhookAction(
    action: Extract<AutomationAction, { type: "send_webhook" }>,
    context: RuleContext,
  ): Promise<void> {
    const { url, method, headers, body, retryCount, timeoutMs } = action.params

    // Prepara il contesto per merge fields
    const mergeContext: Record<string, any> = {
      [context.entityType]: context.newData,
      entityId: context.entityId,
      entityType: context.entityType,
    }

    // Esegui il webhook
    const result = await sendWebhook(
      {
        url,
        method: (method as any) || "POST",
        headers,
        body,
        retryCount: retryCount ?? 3,
        timeoutMs: timeoutMs ?? 10000,
      },
      mergeContext,
    )

    if (!result.success) {
      throw new Error(`Webhook failed: ${result.message}`)
    }

    console.log(`[ActionDispatcher] Webhook sent to ${url}:`, result.statusCode)
  }

  // ─── Action: update_field ─────────────────────────────────────────────────────

  private async updateField(
    action: Extract<AutomationAction, { type: "update_field" }>,
    context: RuleContext,
    executionCtx: ExecutionContext,
  ): Promise<void> {
    const { field, value } = action.params
    const table = this.entityTable(context.entityType)
    if (!table) throw new Error(`Unknown entity type: ${context.entityType}`)

    // Fetch old data prima dell'update
    const [oldEntity] = await db
      .select()
      .from(table as any)
      .where(eq((table as any).id, context.entityId))

    // Update il campo
    await (db.update(table as any) as any)
      .set({ [field]: value, updatedAt: new Date() })
      .where(eq((table as any).id, context.entityId))

    // Fetch new data dopo l'update
    const [newEntity] = await db
      .select()
      .from(table as any)
      .where(eq((table as any).id, context.entityId))

    // Se il campo è effettivamente cambiato, trigghera altre automazioni
    if (oldEntity && newEntity && (oldEntity as any)[field] !== (newEntity as any)[field]) {
      // Propagare il cambio a cascata (con execution context per loop detection)
      await runAutomations(
        {
          entityType:    context.entityType,
          entityId:      context.entityId,
          event:         "onUpdate",
          oldData:       oldEntity as Record<string, unknown>,
          newData:       newEntity as Record<string, unknown>,
          currentUserId: context.currentUserId,
        },
        executionCtx, // Passa il contesto per tracciare la catena
      )
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  private async resolveEntityOwner(context: RuleContext): Promise<string | null> {
    const table = this.entityTable(context.entityType)
    if (!table) return null
    const [row] = await db
      .select({ ownerId: (table as any).ownerId })
      .from(table as any)
      .where(eq((table as any).id, context.entityId))
    return (row as any)?.ownerId ?? null
  }

  private entityTable(entityType: string) {
    switch (entityType) {
      case "deal":    return deals
      case "lead":    return leads
      case "contact": return contacts
      case "company": return companies
      default:        return null
    }
  }

  private entityLink(context: RuleContext): string {
    switch (context.entityType) {
      case "deal":    return `/dashboard/pipeline/${context.entityId}`
      case "lead":    return `/dashboard/leads/${context.entityId}`
      case "contact": return `/dashboard/contacts/${context.entityId}`
      case "company": return `/dashboard/companies/${context.entityId}`
      default:        return "/dashboard"
    }
  }
}
