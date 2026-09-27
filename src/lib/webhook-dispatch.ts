/**
 * Sending an event to the workspace's webhooks: signed, logged, retried by the job.
 *
 * ⚠️⚠️ **Not a server action, on purpose.** This used to live in `src/actions/webhooks.ts`,
 * a `"use server"` file — and every export of such a file is an endpoint any signed-in
 * browser can call. So a read-only member could send any event, with any payload, **signed
 * with the workspace's secret**, to every integration listening: an `invoice.issued` the
 * accounting system would book, a `deal.won` a commission system would pay. Here it is only
 * a function the server's own code can call.
 */
import crypto from "node:crypto";

import { eq } from "drizzle-orm";

import type { createTenantDb } from "@/db";
import { webhookLogs, webhooks } from "@/db/schema";
import { getDb } from "@/lib/tenant-context";
// ⚠️ The envelope lives in a library with **no dependencies**: whoever uses it to retry
// should not have to import authentication in order to read a constant.
import { type EventEnvelope, type Origin, UNSIGNABLE_PREFIX } from "@/lib/webhook-envelope";
import { RULE_EVENT, type WebhookEventName } from "@/lib/webhook-events";
import { readWebhookResponse } from "@/lib/webhook-response";
import { validateWebhookUrl } from "@/lib/webhook-validator";

/** A tenant database handle, for callers that resolve the workspace themselves. */
export type WebhookDispatchDb = ReturnType<typeof createTenantDb>;

// ─── Dispatch ────────────────────────────────────────────────────────────────

/**
 * Fire webhooks for a given event.
 * Call this from server actions after data mutations.
 *
 * @example
 * await dispatchWebhook("contact.created", { id: contact.id, ... });
 */
export async function dispatchWebhook(
  /** A name from src/lib/webhook-events.ts: the list the settings screen offers. */
  event: WebhookEventName,
  payload: Record<string, unknown>,
  origin: Origin = { via: "user" },
  explicitDb?: WebhookDispatchDb,
) {
  return deliver(event, payload, origin, explicitDb);
}

/**
 * An event a workspace's own rule emits (`emit_event`): its name is the rule author's, not
 * the catalogue's, so it has its own door — and is checked for the same dotted shape.
 */
export async function dispatchRuleEvent(
  event: string,
  payload: Record<string, unknown>,
  origin: Origin = { via: "user" },
  explicitDb?: WebhookDispatchDb,
) {
  if (!RULE_EVENT.test(event)) throw new Error(`Not an event name: ${event}`);
  return deliver(event, payload, origin, explicitDb);
}

async function deliver(
  event: string,
  payload: Record<string, unknown>,
  origin: Origin,
  /**
   * The workspace to dispatch for. Server actions omit it and the active tenant
   * is resolved from the request. Callers with no request context — the public
   * quote page, inbound email, the retry job — must pass one, because `getDb()`
   * has nothing to read the tenant from there (audit rilievo B-01).
   */
  explicitDb?: WebhookDispatchDb,
) {
  const db = explicitDb ?? (await getDb());
  const activeWebhooks = await db.select().from(webhooks).where(eq(webhooks.isActive, true));

  const eligible = activeWebhooks.filter((wh) => wh.events.includes(event) || wh.events.includes("*"));

  const envelope: EventEnvelope = {
    id: crypto.randomUUID(),
    event,
    payload,
    timestamp: new Date().toISOString(),
    origin,
  };
  const body = JSON.stringify(envelope);

  await Promise.allSettled(
    eligible.map(async (wh) => {
      // Runtime SSRF guard: skip webhooks whose URLs became invalid after save
      // (e.g. an internal address that slipped through an older version of the validator).
      const urlError = validateWebhookUrl(wh.url);
      if (urlError) {
        console.error("[dispatchWebhook] Skipping webhook with invalid URL", {
          id: wh.id,
          url: wh.url,
          reason: urlError,
        });
        return;
      }

      // ⚠️⚠️ **No secret, no delivery.** An unsigned event is one the receiver cannot tell
      // apart from anything else that can reach its URL, so acting on it means acting on
      // whatever a stranger sends. Delivering it anyway and letting the receiver decide
      // would put the choice in the place with the least context.
      //
      // Refusing is recorded, not silent: the log row is how the owner finds out that a
      // webhook they configured is not delivering, and why.
      if (!wh.secret) {
        await db.insert(webhookLogs).values({
          webhookId: wh.id,
          event,
          payload: body,
          statusCode: null,
          response:
            `${UNSIGNABLE_PREFIX}, so the event could not be signed. ` +
            "Add one — an unsigned event is indistinguishable from one sent by anybody.",
          success: false,
        });
        return;
      }
      const signature = `sha256=${crypto.createHmac("sha256", wh.secret).update(body).digest("hex")}`;

      try {
        const res = await fetch(wh.url, {
          method: "POST",
          // The URL was validated; a redirect would take the event somewhere that was not.
          redirect: "manual",
          headers: {
            "Content-Type": "application/json",
            "X-Webhook-Signature": signature,
            // The id travels in a header too, so a receiver that dedupes before parsing
            // does not have to parse the body to do it.
            "X-Webhook-Id": envelope.id,
          },
          body,
          signal: AbortSignal.timeout(10_000),
        });

        await db.insert(webhookLogs).values({
          webhookId: wh.id,
          event,
          payload: body,
          statusCode: res.status,
          response: await readWebhookResponse(res),
          success: res.ok,
        });
      } catch (err) {
        await db.insert(webhookLogs).values({
          webhookId: wh.id,
          event,
          payload: body,
          statusCode: null,
          response: String(err),
          success: false,
        });
      }
    }),
  );
}

/**
 * Whether this workspace has any active webhook at all.
 *
 * ⚠️ For loops. `dispatchWebhook` reads the webhook table on every call, which is
 * one round trip per row in a bulk import — five hundred of them for a full
 * batch, on a driver where every statement is its own request, against a
 * Cloudflare subrequest budget of a thousand per request. Asking once before the
 * loop and skipping the calls entirely when the answer is no costs one statement
 * instead of five hundred, and no workspace notices a webhook it never
 * configured not being dispatched.
 *
 * It does not make the loop cheap when webhooks *are* configured. That cost is
 * inherent to one event per record and belongs to whoever configured them.
 */
export async function hasActiveWebhook(db: WebhookDispatchDb): Promise<boolean> {
  const [row] = await db.select({ id: webhooks.id }).from(webhooks).where(eq(webhooks.isActive, true)).limit(1);
  return Boolean(row);
}
