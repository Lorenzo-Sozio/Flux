"use server";

import { revalidatePath } from "next/cache";

import crypto from "node:crypto";

import { eq } from "drizzle-orm";

import { webhookLogs, webhooks } from "@/db/schema";
import { ForbiddenError, requireAdminAccess, requireCapability } from "@/lib/auth-guard";
import { getDb } from "@/lib/tenant-context";
import { cleanSubscription } from "@/lib/webhook-events";
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

export async function createWebhook(data: { name: string; url: string; events: string[]; ownerId?: string }) {
  const admin = await requireAdminAccess();

  const urlError = validateWebhookUrl(data.url);
  if (urlError) throw new ForbiddenError(urlError);

  const db = await getDb();
  const secret = crypto.randomBytes(32).toString("hex");
  const [wh] = await db
    .insert(webhooks)
    // Only events that exist (src/lib/webhook-events.ts): a misspelt one is a subscription
    // that never fires, and nobody finds out. The owner is whoever is saving, not a field.
    .values({ name: data.name, url: data.url, events: cleanSubscription(data.events), ownerId: admin.user.id, secret })
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
    .set({
      ...data,
      ...(data.events !== undefined ? { events: cleanSubscription(data.events) } : {}),
      updatedAt: new Date(),
    })
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
  await requireCapability("webhook:manage");
  const db = await getDb();
  return await db.select().from(webhookLogs).where(eq(webhookLogs.webhookId, webhookId)).limit(50);
}

// Sending events is not an action: it lives in src/lib/webhook-dispatch.ts, where no
// browser can call it.
