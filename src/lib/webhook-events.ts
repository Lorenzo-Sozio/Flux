/**
 * Every event Flux sends to a webhook, once (§13.11).
 *
 * ⚠️⚠️ **The code and the settings screen read the same list.** The screen used to offer ten
 * events while the code sent at least fifteen, so an integrator could not subscribe to a
 * company, an order or a quote without knowing to tick "all" — and could subscribe to
 * nothing about tickets or invoices, which sent nothing at all. \`dispatchWebhook\` now takes
 * only a name from this list, so an event the screen does not offer cannot be sent, and one
 * it offers cannot be forgotten by the code without the compiler noticing nothing — which is
 * why \`webhook-events.test.ts\` also checks every name here is emitted somewhere.
 *
 * Events a workspace's own rules emit (\`emit_event\`) are not here: their names are the
 * rule author's, and they reach subscribers through \`dispatchRuleEvent\`.
 *
 * Pure: imported by the dispatcher, the screen and the documentation.
 */

export const WEBHOOK_EVENTS = [
  { name: "contact.created", entity: "contact" },
  { name: "contact.updated", entity: "contact" },
  { name: "contact.deleted", entity: "contact" },
  { name: "company.created", entity: "company" },
  { name: "company.updated", entity: "company" },
  // Somebody asked to stop being contacted: from an email's link, the opt-out API or their record.
  { name: "consent.withdrawn", entity: "consent" },
  { name: "lead.created", entity: "lead" },
  { name: "lead.updated", entity: "lead" },
  { name: "lead.converted", entity: "lead" },
  { name: "deal.created", entity: "deal" },
  { name: "deal.stage_changed", entity: "deal" },
  { name: "deal.won", entity: "deal" },
  { name: "deal.lost", entity: "deal" },
  { name: "activity.created", entity: "activity" },
  { name: "task.completed", entity: "task" },
  { name: "quote.sent", entity: "quote" },
  { name: "quote.accepted", entity: "quote" },
  { name: "quote.declined", entity: "quote" },
  { name: "order.created", entity: "order" },
  { name: "order.draft", entity: "order" },
  { name: "order.processing", entity: "order" },
  { name: "order.completed", entity: "order" },
  { name: "order.cancelled", entity: "order" },
  { name: "invoice.issued", entity: "invoice" },
  { name: "invoice.paid", entity: "invoice" },
  { name: "ticket.created", entity: "ticket" },
  { name: "ticket.resolved", entity: "ticket" },
  { name: "ticket.rated", entity: "ticket" },
] as const;

export type WebhookEventName = (typeof WEBHOOK_EVENTS)[number]["name"];
export type WebhookEntity = (typeof WEBHOOK_EVENTS)[number]["entity"];

/** Subscribing to this receives everything, rule events included. */
export const ALL_EVENTS = "*";

export const isWebhookEvent = (v: unknown): v is WebhookEventName =>
  typeof v === "string" && WEBHOOK_EVENTS.some((e) => e.name === v);

/** The message key of an event's label: a dot is a namespace separator to next-intl. */
export const eventLabelKey = (name: string) => name.replace(/\./g, "_");

/** A rule's own event name: dotted and lower-case, like the built-in ones (automation/types.ts). */
export const RULE_EVENT = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

/** What a subscription may list: catalogue names, rule event names, or everything. */
export function cleanSubscription(events: unknown): string[] {
  if (!Array.isArray(events)) return [];
  const kept = events.filter(
    (e): e is string => typeof e === "string" && (e === ALL_EVENTS || isWebhookEvent(e) || RULE_EVENT.test(e)),
  );
  return [...new Set(kept)];
}
