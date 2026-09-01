"use server";

import { revalidatePath } from "next/cache";

import crypto from "node:crypto";

import { eq } from "drizzle-orm";

import { webhookLogs, webhooks } from "@/db/schema";
import { ForbiddenError, requireAdminAccess } from "@/lib/auth-guard";
import { getDb } from "@/lib/tenant-context";
import { validateWebhookUrl } from "@/lib/webhook-validator";

// ─── CRUD ────────────────────────────────────────────────────────────────────

/**
 * Returns webhook configurations without the HMAC secret.
 * Use getWebhookSecret() to retrieve the secret for a specific webhook (admin only).
 */
export async function getWebhooks() {
  await requireAdminAccess();
  const db = await getDb();
  const rows = await db.select().from(webhooks).orderBy(webhooks.createdAt);
  return rows.map(({ secret: _secret, ...rest }) => rest);
}

/**
 * Returns the HMAC signing secret for a specific webhook (admin only).
 * Kept separate so the secret is never included in bulk list responses.
 */
export async function getWebhookSecret(id: string): Promise<string | null> {
  await requireAdminAccess();
  const db = await getDb();
  const [wh] = await db.select({ secret: webhooks.secret }).from(webhooks).where(eq(webhooks.id, id));
  return wh?.secret ?? null;
}

export async function createWebhook(data: { name: string; url: string; events: string[]; ownerId: string }) {
  await requireAdminAccess();

  const urlError = validateWebhookUrl(data.url);
  if (urlError) throw new ForbiddenError(urlError);

  const db = await getDb();
  const secret = crypto.randomBytes(32).toString("hex");
  const [wh] = await db
    .insert(webhooks)
    .values({ ...data, secret })
    .returning();
  revalidatePath("/dashboard/settings/webhooks");
  const { secret: _secret, ...rest } = wh;
  return rest;
}

export async function updateWebhook(
  id: string,
  data: Partial<{ name: string; url: string; events: string[]; isActive: boolean }>,
) {
  await requireAdminAccess();

  if (data.url !== undefined) {
    const urlError = validateWebhookUrl(data.url);
    if (urlError) throw new ForbiddenError(urlError);
  }

  const db = await getDb();
  const [wh] = await db
    .update(webhooks)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(webhooks.id, id))
    .returning();
  revalidatePath("/dashboard/settings/webhooks");
  const { secret: _secret, ...rest } = wh;
  return rest;
}

export async function deleteWebhook(id: string) {
  await requireAdminAccess();
  const db = await getDb();
  await db.delete(webhooks).where(eq(webhooks.id, id));
  revalidatePath("/dashboard/settings/webhooks");
}

export async function getWebhookLogs(webhookId: string) {
  const db = await getDb();
  return await db.select().from(webhookLogs).where(eq(webhookLogs.webhookId, webhookId)).limit(50);
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

/**
 * Fire webhooks for a given event.
 * Call this from server actions after data mutations.
 *
 * @example
 * await dispatchWebhook("contact.created", { id: contact.id, ... });
 */
/** Who caused the change that produced this event. */
export interface Origin {
  /** `api` = a machine wrote through the API; `user` = somebody in the interface. */
  via: "api" | "user" | "system";
  /** The user id, when there is one. Machines do not have one. */
  actor?: string | null;
}

/**
 * The envelope every event travels in.
 *
 * ⚠️ **`id` exists so a receiver can tell a retry from a second event.** Without it, an
 * integration that receives the same delivery twice — which any at-least-once transport
 * eventually does — has no way to know, and acts twice. It is generated once per event
 * occurrence and stays the same across every attempt.
 *
 * ⚠️ **`origin` exists so nobody chases their own tail.** An integration writes a lead
 * through the API, this CRM emits `lead.created`, and the integration receives it: if it
 * cannot tell the change was its own, it reacts to itself, forever. Saying who caused the
 * change is the only thing that breaks that loop at the source.
 */
export interface BustaEvento {
  id: string;
  event: string;
  payload: Record<string, unknown>;
  timestamp: string;
  origin: Origin;
}

export async function dispatchWebhook(
  event: string,
  payload: Record<string, unknown>,
  origin: Origin = { via: "user" },
) {
  const db = await getDb();
  const activeWebhooks = await db.select().from(webhooks).where(eq(webhooks.isActive, true));

  const eligible = activeWebhooks.filter((wh) => wh.events.includes(event) || wh.events.includes("*"));

  const busta: BustaEvento = {
    id: crypto.randomUUID(),
    event,
    payload,
    timestamp: new Date().toISOString(),
    origin,
  };
  const body = JSON.stringify(busta);

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
            "not delivered: this webhook has no secret, so the event could not be signed. " +
            "Add one — an unsigned event is indistinguishable from one sent by anybody.",
          success: false,
        });
        return;
      }
      const signature = `sha256=${crypto.createHmac("sha256", wh.secret).update(body).digest("hex")}`;

      try {
        const res = await fetch(wh.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Webhook-Signature": signature,
            // The id travels in a header too, so a receiver that dedupes before parsing
            // does not have to parse the body to do it.
            "X-Webhook-Id": busta.id,
          },
          body,
          signal: AbortSignal.timeout(10_000),
        });

        await db.insert(webhookLogs).values({
          webhookId: wh.id,
          event,
          payload: body,
          statusCode: res.status,
          response: await res.text().catch(() => ""),
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
