/**
 * automation-recipes.ts — rules worth having, written out in advance.
 *
 * The engine has been able to run rules for a long time and the builder can write
 * any of them, which is exactly the problem: a screen that asks for an entity, a
 * trigger, a condition and an action, on an empty list, is a screen most people
 * close (audit rilievo S-04). Nobody's first thought is a condition tree; it is
 * "tell me when a big deal comes in".
 *
 * So the catalogue is data, and installing one writes an ordinary rule that the
 * builder can then open and change. Nothing here is a special kind of rule.
 *
 * ⚠️ Every recipe fires on an event, never on a schedule. Scheduled triggers are
 * driven by node-cron from `src/instrumentation.ts`, which does not start on
 * Cloudflare Workers because there is no long-lived process there — a recipe that
 * silently does nothing on half the deployments is worse than no recipe.
 */

import type { AutomationRuleFormData } from "@/components/crm/automation/types";

export interface AutomationRecipe {
  id: string;
  /** One line, in the words someone would use to ask for it. */
  summary: string;
  /** Why it is worth having, which is the part a catalogue usually leaves out. */
  why: string;
  rule: AutomationRuleFormData;
}

/**
 * Operators that ask about a change rather than a state.
 *
 * A rule built on these cannot be counted against the records that exist now:
 * "changed to won" is not a property of a deal, it is something that happens to
 * one. The preview says so instead of showing a zero that means nothing.
 */
const CHANGE_OPERATORS = new Set(["changed", "changed_to", "changed_from"]);

export function isPreviewable(recipe: AutomationRecipe): boolean {
  return recipe.rule.conditions.every((c) => !CHANGE_OPERATORS.has(c.operator));
}

export const AUTOMATION_RECIPES: AutomationRecipe[] = [
  {
    id: "hot-lead-call",
    summary: "When a lead scores 80 or more, put a call on somebody's list for tomorrow",
    why: "A hot lead that nobody rings within a day is a hot lead cooling down.",
    rule: {
      name: "Hot lead — call tomorrow",
      description: "A lead scoring 80 or more gets a call task, assigned to whoever owns it.",
      isActive: true,
      targetEntity: "lead",
      triggerOn: ["onCreate", "onUpdate"],
      conditionLogic: "AND",
      conditions: [{ field: "leadScore", operator: "greater_than_or_equal", value: "80", logic: "AND" }],
      actions: [
        {
          type: "create_task",
          params: {
            title: "Call this lead",
            description: "Scored 80 or more. Ring before the interest goes cold.",
            priority: "high",
            dueDateDays: 1,
            assigneeId: "entity_owner",
          },
        },
      ],
    },
  },
  {
    id: "big-deal-notify",
    summary: "When a deal over 10.000 appears, tell the person who owns it",
    why: "The largest deals are the ones worth knowing about the day they arrive, not at the review.",
    rule: {
      name: "Large deal — tell the owner",
      description: "A deal worth more than 10.000 notifies its owner as soon as it exists.",
      isActive: true,
      targetEntity: "deal",
      triggerOn: ["onCreate"],
      conditionLogic: "AND",
      conditions: [{ field: "amount", operator: "greater_than", value: "10000", logic: "AND" }],
      actions: [
        {
          type: "send_notification",
          params: { userId: "entity_owner", title: "A large deal has arrived", message: "Worth more than 10.000." },
        },
      ],
    },
  },
  {
    id: "deal-won-followup",
    summary: "When a deal is won, schedule the thank-you and the handover",
    why: "The moment a deal closes is the moment the customer is most willing to hear from you.",
    rule: {
      name: "Deal won — thank and hand over",
      description: "A deal moving to won creates the follow-up task nobody remembers to write.",
      isActive: true,
      targetEntity: "deal",
      triggerOn: ["onUpdate"],
      conditionLogic: "AND",
      conditions: [{ field: "status", operator: "changed_to", value: "won", logic: "AND" }],
      actions: [
        {
          type: "create_task",
          params: {
            title: "Thank the customer and confirm what happens next",
            priority: "normal",
            dueDateDays: 1,
            assigneeId: "entity_owner",
          },
        },
      ],
    },
  },
  {
    id: "urgent-ticket-notify",
    summary: "When an urgent ticket arrives, tell somebody rather than waiting for the SLA",
    why: "The SLA warns at half the window. Urgent means the window was already short.",
    rule: {
      name: "Urgent ticket — tell somebody now",
      description: "A ticket that comes in at urgent priority notifies its owner immediately.",
      isActive: true,
      targetEntity: "ticket",
      triggerOn: ["onCreate"],
      conditionLogic: "AND",
      conditions: [{ field: "priority", operator: "equals", value: "urgent", logic: "AND" }],
      actions: [
        {
          type: "send_notification",
          params: { userId: "entity_owner", title: "An urgent ticket has arrived", message: "Priority: urgent." },
        },
      ],
    },
  },
  {
    id: "ticket-resolved-check",
    summary: "Three days after a ticket is resolved, check it really was",
    why: "A resolved ticket that comes back is a customer who had to ask twice.",
    rule: {
      name: "Resolved ticket — check back in three days",
      description: "Creates a task three days out, so a fix that did not hold is found by you and not by the customer.",
      isActive: true,
      targetEntity: "ticket",
      triggerOn: ["onUpdate"],
      conditionLogic: "AND",
      conditions: [{ field: "status", operator: "changed_to", value: "resolved", logic: "AND" }],
      actions: [
        {
          type: "create_task",
          params: {
            title: "Check the fix held",
            priority: "low",
            dueDateDays: 3,
            assigneeId: "entity_owner",
          },
        },
      ],
    },
  },
  {
    id: "order-completed-feedback",
    summary: "When an order is completed, ask the customer how it went",
    why: "Feedback asked for on the day is answered; asked for a month later it is not.",
    rule: {
      name: "Order completed — ask how it went",
      description: "A completed order creates the task to ask for feedback while the work is still fresh.",
      isActive: true,
      targetEntity: "order",
      triggerOn: ["onUpdate"],
      conditionLogic: "AND",
      conditions: [{ field: "status", operator: "changed_to", value: "completed", logic: "AND" }],
      actions: [
        {
          type: "create_task",
          params: { title: "Ask the customer how it went", priority: "normal", dueDateDays: 2 },
        },
      ],
    },
  },
  {
    id: "new-contact-welcome",
    summary: "Every new contact gets a first-contact task",
    why: "A contact added and never spoken to is a row, not a relationship.",
    rule: {
      name: "New contact — say hello",
      description: "Creates a short task to make first contact, assigned to whoever added them.",
      isActive: true,
      targetEntity: "contact",
      triggerOn: ["onCreate"],
      conditionLogic: "AND",
      conditions: [{ field: "firstName", operator: "is_not_empty", value: "", logic: "AND" }],
      actions: [
        {
          type: "create_task",
          params: {
            title: "Say hello to this contact",
            priority: "low",
            dueDateDays: 2,
            assigneeId: "entity_owner",
          },
        },
      ],
    },
  },
  {
    id: "large-order-notify",
    summary: "When an order over 5.000 is written, tell the owner",
    why: "The orders worth checking before they are prepared are the large ones.",
    rule: {
      name: "Large order — tell the owner",
      description: "An order above 5.000 notifies its owner as soon as it is written.",
      isActive: true,
      targetEntity: "order",
      triggerOn: ["onCreate"],
      conditionLogic: "AND",
      conditions: [{ field: "totalAmount", operator: "greater_than", value: "5000", logic: "AND" }],
      actions: [
        {
          type: "send_notification",
          params: { userId: "entity_owner", title: "A large order has been written", message: "Above 5.000." },
        },
      ],
    },
  },
];

export function findRecipe(id: string): AutomationRecipe | undefined {
  return AUTOMATION_RECIPES.find((r) => r.id === id);
}
