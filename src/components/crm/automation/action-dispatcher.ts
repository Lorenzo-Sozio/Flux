import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { dispatchWebhook } from "@/actions/webhooks";
import { platformDb } from "@/db";
import {
  companies,
  contacts,
  deals,
  emailTemplates,
  leads,
  notifications,
  orders,
  tasks,
  tenantMembers,
  territories,
  tickets,
} from "@/db/schema";
import { candidatesFor, routeScope } from "@/lib/assignment-routing";
import { nextInSequence } from "@/lib/document-counter";
import { notify } from "@/lib/notify";
import { eligibleInOrder, isOwnedEntity, pickInTurn } from "@/lib/round-robin";
import { tolerateUnmigrated } from "@/lib/schema-ready";
import { enroll } from "@/lib/sequence-runner";
import { getCurrentTenantId, getDb } from "@/lib/tenant-context";
import type { Located } from "@/lib/territory";
import { placeOfDeal } from "@/lib/territory-report";

import { sendAutomationEmailWithContext } from "../../crm/automation/email-service";
import type { ExecutionContext } from "../../crm/automation/loop-detector";
import { runAutomations } from "../../crm/automation/rule-engine";
import type { AutomationAction, RuleContext } from "../../crm/automation/types";
import { sendWebhook } from "../../crm/automation/webhook-service";

/**
 * Executes validated AutomationActions.
 *
 * Security: this class is only ever called with actions that have already
 * been validated by Zod's discriminated union (ActionSchema). Any action
 * type not in the union is structurally impossible to reach here.
 */
export class ActionDispatcher {
  /** Run all actions sequentially; returns execution stats. */
  async dispatchAll(
    actions: AutomationAction[],
    context: RuleContext,
    executionCtx: ExecutionContext,
  ): Promise<{ actionsExecuted: number; totalRetries: number; lastError?: string }> {
    let actionsExecuted = 0;
    let totalRetries = 0;
    let lastError: string | undefined;

    for (const action of actions) {
      try {
        const retries = await this.dispatch(action, context, executionCtx);
        actionsExecuted++;
        totalRetries += retries;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        console.error(`[ActionDispatcher] "${action.type}" failed for ${context.entityType}:${context.entityId}`, err);
      }
    }

    return { actionsExecuted, totalRetries, lastError };
  }

  // ─── Router ──────────────────────────────────────────────────────────────────

  // Returns the number of retries consumed by this action (0 for non-HTTP actions).
  private async dispatch(
    action: AutomationAction,
    context: RuleContext,
    executionCtx: ExecutionContext,
  ): Promise<number> {
    switch (action.type) {
      case "create_task":
        await this.createTask(action, context);
        return 0;
      case "send_notification":
        await this.sendNotification(action, context);
        return 0;
      case "send_email":
        return this.sendEmail(action, context);
      case "send_webhook":
        return this.sendWebhookAction(action, context);
      case "update_field":
        await this.updateField(action, context, executionCtx);
        return 0;
      case "emit_event":
        await this.emitEvent(action, context);
        return 0;
      case "assign_owner":
        await this.assignOwner(action, context, executionCtx);
        return 0;
      case "enroll_in_sequence":
        await this.enrollInSequence(action, context);
        return 0;
      // TypeScript exhaustiveness: no `default` — new action types require an explicit case.
    }
  }

  // ─── Action: assign_owner ─────────────────────────────────────────────────────

  /**
   * Gives the record to the next person in the rotation its routes choose.
   *
   * ⚠️⚠️ The turn comes from the atomic counter, not from reading the last owner.
   * Two leads created in the same instant would otherwise both see the same last
   * owner and both go to the same next person — and the imbalance compounds with
   * every burst of leads from a form or an import.
   *
   * ⚠️ The write is conditional on the record still having no owner (unless the rule
   * says overwrite), so a person assigning it by hand in the same instant wins.
   * A turn is taken only once it is certain to be used, so a record that already
   * has an owner, or that no route takes, does not skip somebody's turn.
   *
   * ⚠️ A route whose people have all left the workspace does not swallow the
   * record: the next matching route, then the general rotation, is tried.
   */
  private async assignOwner(
    action: Extract<AutomationAction, { type: "assign_owner" }>,
    context: RuleContext,
    executionCtx: ExecutionContext,
  ): Promise<void> {
    const { userIds, overwrite, routes } = action.params;
    if (!isOwnedEntity(context.entityType)) {
      throw new Error(`"assign_owner" does not apply to ${context.entityType}: it has no owner to set`);
    }
    const ruleId = executionCtx.ruleChain.at(-1)?.ruleId;
    if (!ruleId) throw new Error(`"assign_owner" ran outside a rule, so there is no rotation to take a turn from`);

    const tenantId = await getCurrentTenantId();
    if (!tenantId) throw new Error(`"assign_owner" needs a workspace, and none is active`);

    const table = this.entityTable(context.entityType);
    if (!table) throw new Error(`Unknown entity type: ${context.entityType}`);
    // biome-ignore lint/suspicious/noExplicitAny: owned tables all carry id and ownerId
    const t = table as any;

    const db = await getDb();
    const [before] = await db.select().from(t).where(eq(t.id, context.entityId));
    if (!before) return;
    const record = before as Record<string, unknown> & { ownerId?: string | null };
    if (record.ownerId && !overwrite) return;

    const territoryRows = routes.some((r) => r.territoryIds.length)
      ? await tolerateUnmigrated("territories", () => db.select().from(territories), [])
      : [];
    const place = context.entityType === "deal" ? await this.placeOfDeal(db, record) : (record as Located);
    const candidates = candidatesFor(
      { ...place, source: (record.source as string | null | undefined) ?? null },
      routes,
      territoryRows,
      userIds,
    );
    // No route takes it and the rule has no general rotation: this rule does not
    // assign records like this one, which is a configuration, not a failure.
    if (candidates.length === 0) return;

    // Membership is the workspace's own list, in the platform registry: a user row
    // in this database outlives the person's membership.
    const everyone = [...new Set(candidates.flatMap((c) => c.userIds))];
    const members = await platformDb
      .select({ userId: tenantMembers.userId })
      .from(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, tenantId), inArray(tenantMembers.userId, everyone)));
    const memberIds = new Set(members.map((m) => m.userId));

    let chosen: { routeId: string | null; eligible: string[] } | null = null;
    for (const candidate of candidates) {
      const eligible = eligibleInOrder(candidate.userIds, memberIds);
      if (eligible.length) {
        chosen = { routeId: candidate.routeId, eligible };
        break;
      }
    }
    if (!chosen) {
      throw new Error("None of the people this rule assigns to is still a member of the workspace");
    }

    const turn = await nextInSequence(db, routeScope(ruleId, chosen.routeId), sql`1`);
    const ownerId = pickInTurn(chosen.eligible, turn);

    const written = await db
      .update(t)
      .set({ ownerId, updatedAt: new Date() })
      .where(overwrite ? eq(t.id, context.entityId) : and(eq(t.id, context.entityId), isNull(t.ownerId)))
      .returning({ id: t.id });
    // Somebody assigned it by hand between the read and the write. Theirs stands.
    if (written.length === 0) return;

    if (context.entityType === "lead") {
      const lead = before as { firstName?: string | null; lastName?: string | null };
      await notify({
        userId: ownerId,
        type: "lead_assigned",
        title: "Lead assigned to you",
        message: `${[lead.firstName, lead.lastName].filter(Boolean).join(" ") || "A lead"} has been assigned to you.`,
        link: `/dashboard/leads/${context.entityId}`,
      });
    }

    const [after] = await db.select().from(t).where(eq(t.id, context.entityId));
    if (after) {
      // The change cascades like any other update, carrying the chain so a rule that
      // reassigns on update cannot loop.
      await runAutomations(
        {
          entityType: context.entityType,
          entityId: context.entityId,
          event: "onUpdate",
          oldData: before as Record<string, unknown>,
          newData: after as Record<string, unknown>,
          currentUserId: context.currentUserId,
        },
        executionCtx,
      );
    }
  }

  /** A deal has no address: its company's, or its contact's when the company has none. */
  // biome-ignore lint/suspicious/noExplicitAny: the tenant db handle is built per request
  private async placeOfDeal(db: any, deal: Record<string, unknown>): Promise<Located> {
    const columns = { country: companies.country, state: companies.state, zipCode: companies.zipCode };
    const [company] = deal.companyId
      ? await db
          .select(columns)
          .from(companies)
          .where(eq(companies.id, String(deal.companyId)))
      : [];
    const [contact] = deal.contactId
      ? await db
          .select({ country: contacts.country, state: contacts.state, zipCode: contacts.zipCode })
          .from(contacts)
          .where(eq(contacts.id, String(deal.contactId)))
      : [];
    return placeOfDeal(company ?? {}, contact ?? {});
  }

  // ─── Action: enroll_in_sequence ───────────────────────────────────────────────

  /** Only a sequence that cannot run at all is a failure; an ordinary refusal is a skip. */
  private async enrollInSequence(
    action: Extract<AutomationAction, { type: "enroll_in_sequence" }>,
    context: RuleContext,
  ): Promise<void> {
    if (context.entityType !== "lead" && context.entityType !== "contact") {
      throw new Error(`"enroll_in_sequence" applies to leads and contacts, not ${context.entityType}`);
    }
    const db = await getDb();
    const result = await enroll(db, {
      sequenceId: action.params.sequenceId,
      entity: context.entityType,
      recordId: context.entityId,
      enrolledBy: context.currentUserId ?? null,
    });
    if (!result.ok && (result.reason === "sequence_unavailable" || result.reason === "no_steps")) {
      throw new Error(`The sequence cannot enroll anyone: ${result.reason.replace("_", " ")}`);
    }
  }

  // ─── Action: emit_event ───────────────────────────────────────────────────────

  /**
   * Emit a named event through the normal webhook path.
   *
   * ⚠️ **Not `sendWebhookAction`.** That one posts a raw request typed by hand, which is
   * right for calling something with a fixed shape and wrong for an integration that
   * requires a signature: nobody computes an HMAC in a rule builder. Going through
   * `dispatchWebhook` gives the event a signature over the exact bytes, an id that survives
   * retries, and who caused it — and puts it in the retry worker's hands if delivery fails.
   *
   * ⚠️ The origin is **`user`**: a rule fires because a person did something in the CRM, so
   * the change is not machine-made. Marking it `api` would make an integration that filters
   * its own writes ignore it, and the rule would look like it never fired.
   */
  private async emitEvent(
    action: Extract<AutomationAction, { type: "emit_event" }>,
    context: RuleContext,
  ): Promise<void> {
    const { event, payload } = action.params;
    await dispatchWebhook(
      event,
      {
        // The entity as it is **after** the change: a rule reacts to the new state, and
        // sending the old one would make the receiver act on what is no longer true.
        [context.entityType]: context.newData,
        entityType: context.entityType,
        entityId: context.entityId,
        ...(payload ?? {}),
      },
      { via: "user", actor: context.currentUserId ?? null },
    );
  }

  // ─── Action: create_task ──────────────────────────────────────────────────────

  private async createTask(
    action: Extract<AutomationAction, { type: "create_task" }>,
    context: RuleContext,
  ): Promise<void> {
    const { title, description, priority, dueDateDays, assigneeId } = action.params;

    const dueDate = dueDateDays !== undefined ? new Date(Date.now() + dueDateDays * 24 * 60 * 60 * 1000) : undefined;

    // Map entity type to the correct FK column on the task table
    const entityFkMap: Record<string, string> = {
      deal: "dealId",
      lead: "leadId",
      contact: "contactId",
      company: "companyId",
      ticket: "ticketId",
    };
    // An order has no column of its own on the task table, so the task hangs off
    // the customer the order is for — which is where the person doing the work
    // would look for it anyway. An entity with neither gets an unlinked task
    // rather than a column named `undefined`.
    const link: Record<string, string> = {};
    const entityFk = entityFkMap[context.entityType];
    if (entityFk) {
      link[entityFk] = context.entityId;
    } else if (context.entityType === "order") {
      const order = context.newData as { dealId?: string | null; contactId?: string | null; companyId?: string | null };
      if (order.dealId) link.dealId = order.dealId;
      else if (order.contactId) link.contactId = order.contactId;
      else if (order.companyId) link.companyId = order.companyId;
    }

    const db = await getDb();
    await db.insert(tasks).values({
      title,
      description: description ?? null,
      priority: priority ?? "normal",
      dueDate: dueDate ?? null,
      status: "todo",
      assigneeId: assigneeId ?? null,
      ownerId: context.currentUserId ?? null,
      ...link,
    } as any);
  }

  // ─── Action: send_notification ────────────────────────────────────────────────

  private async sendNotification(
    action: Extract<AutomationAction, { type: "send_notification" }>,
    context: RuleContext,
  ): Promise<void> {
    const { title, message } = action.params;
    let { userId } = action.params;

    // Resolve the special sentinel to the entity's actual owner
    if (userId === "entity_owner") {
      const owner = await this.resolveEntityOwner(context);
      if (!owner) return; // nothing to notify — entity has no owner
      userId = owner;
    }

    const db = await getDb();
    await db.insert(notifications).values({
      userId,
      type: "automation",
      title,
      message,
      link: this.entityLink(context),
    });
  }

  // ─── Action: send_email ───────────────────────────────────────────────────────

  private async sendEmail(
    action: Extract<AutomationAction, { type: "send_email" }>,
    context: RuleContext,
  ): Promise<number> {
    const { to, cc, bcc, trackOpens, trackClicks, templateId } = action.params;
    let { subject, body } = action.params;

    // If a templateId is set, load the template from DB (always uses latest content)
    const db = await getDb();
    if (templateId) {
      const [tpl] = await db
        .select({ subject: emailTemplates.subject, body: emailTemplates.body })
        .from(emailTemplates)
        .where(eq(emailTemplates.id, templateId));

      if (tpl) {
        subject = tpl.subject;
        body = tpl.body;
      } else {
        console.warn(
          `[ActionDispatcher] send_email: templateId "${templateId}" not found — falling back to stored subject/body`,
        );
      }
    }

    if (!subject || !body) {
      throw new Error("send_email action is missing subject or body (and no valid template was found)");
    }

    return sendAutomationEmailWithContext(
      to,
      cc,
      bcc,
      subject,
      body,
      trackOpens ?? false,
      trackClicks ?? false,
      context,
    );
  }

  // ─── Action: send_webhook ─────────────────────────────────────────────────────

  private async sendWebhookAction(
    action: Extract<AutomationAction, { type: "send_webhook" }>,
    context: RuleContext,
  ): Promise<number> {
    const { url, method, headers, body, retryCount, timeoutMs } = action.params;

    const mergeContext: Record<string, unknown> = {
      [context.entityType]: context.newData,
      entityId: context.entityId,
      entityType: context.entityType,
    };

    const result = await sendWebhook(
      {
        url,
        method: (method as "GET" | "POST" | "PUT" | "DELETE" | "PATCH") ?? "POST",
        headers,
        body,
        retryCount: retryCount ?? 3,
        timeoutMs: timeoutMs ?? 10000,
      },
      mergeContext,
    );

    if (!result.success) {
      throw new Error(`Webhook failed: ${result.message}`);
    }

    console.log(`[ActionDispatcher] Webhook sent to ${url}:`, result.statusCode);
    return result.retryCount;
  }

  // ─── Action: update_field ─────────────────────────────────────────────────────

  private async updateField(
    action: Extract<AutomationAction, { type: "update_field" }>,
    context: RuleContext,
    executionCtx: ExecutionContext,
  ): Promise<void> {
    const { field, value } = action.params;
    const table = this.entityTable(context.entityType);
    if (!table) throw new Error(`Unknown entity type: ${context.entityType}`);

    const db = await getDb();
    // The row as it stands, before the write
    const [oldEntity] = await db
      .select()
      .from(table as any)
      .where(eq((table as any).id, context.entityId));

    // The write itself
    await (db.update(table as any) as any)
      .set({ [field]: value, updatedAt: new Date() })
      .where(eq((table as any).id, context.entityId));

    // And as it stands after it
    const [newEntity] = await db
      .select()
      .from(table as any)
      .where(eq((table as any).id, context.entityId));

    // Only a real change carries on: a write that changed nothing starts nothing
    if (oldEntity && newEntity && (oldEntity as any)[field] !== (newEntity as any)[field]) {
      // The change cascades, carrying the execution context so a loop is seen
      await runAutomations(
        {
          entityType: context.entityType,
          entityId: context.entityId,
          event: "onUpdate",
          oldData: oldEntity as Record<string, unknown>,
          newData: newEntity as Record<string, unknown>,
          currentUserId: context.currentUserId,
        },
        executionCtx, // so the chain can be traced back
      );
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  private async resolveEntityOwner(context: RuleContext): Promise<string | null> {
    const table = this.entityTable(context.entityType);
    if (!table) return null;
    const db = await getDb();
    const [row] = await db
      .select({ ownerId: (table as any).ownerId })
      .from(table as any)
      .where(eq((table as any).id, context.entityId));
    return (row as any)?.ownerId ?? null;
  }

  private entityTable(entityType: string) {
    switch (entityType) {
      case "deal":
        return deals;
      case "lead":
        return leads;
      case "contact":
        return contacts;
      case "company":
        return companies;
      case "ticket":
        return tickets;
      case "order":
        return orders;
      default:
        return null;
    }
  }

  private entityLink(context: RuleContext): string {
    switch (context.entityType) {
      case "deal":
        return `/dashboard/pipeline/${context.entityId}`;
      case "lead":
        return `/dashboard/leads/${context.entityId}`;
      case "contact":
        return `/dashboard/contacts/${context.entityId}`;
      case "company":
        return `/dashboard/companies/${context.entityId}`;
      case "ticket":
        return `/dashboard/support/tickets/${context.entityId}`;
      case "order":
        return `/dashboard/sales/orders/${context.entityId}`;
      default:
        return "/dashboard";
    }
  }
}
