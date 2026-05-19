"use server";

import { revalidatePath } from "next/cache";

import crypto from "crypto";
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
export async function dispatchWebhook(event: string, payload: Record<string, unknown>) {
  const db = await getDb();
  const activeWebhooks = await db.select().from(webhooks).where(eq(webhooks.isActive, true));

  const eligible = activeWebhooks.filter((wh) => wh.events.includes(event) || wh.events.includes("*"));

  const body = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });

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

      const signature = wh.secret
        ? `sha256=${crypto.createHmac("sha256", wh.secret).update(body).digest("hex")}`
        : undefined;

      try {
        const res = await fetch(wh.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(signature ? { "X-Webhook-Signature": signature } : {}),
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
