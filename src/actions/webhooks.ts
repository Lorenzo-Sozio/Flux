"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/tenant-context";
import { webhookLogs, webhooks } from "@/db/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import { requireAdminAccess } from "@/lib/auth-guard";

// ─── CRUD ────────────────────────────────────────────────────────────────────

export async function getWebhooks() {
  const db = await getDb();
  return await db.select().from(webhooks).orderBy(webhooks.createdAt);
}

export async function createWebhook(data: {
  name: string;
  url: string;
  events: string[];
  ownerId: string;
}) {
  await requireAdminAccess();
  const db = await getDb();
  const secret = crypto.randomBytes(32).toString("hex");
  const [wh] = await db.insert(webhooks).values({ ...data, secret }).returning();
  revalidatePath("/dashboard/settings/webhooks");
  return wh;
}

export async function updateWebhook(id: string, data: Partial<{ name: string; url: string; events: string[]; isActive: boolean }>) {
  await requireAdminAccess();
  const db = await getDb();
  const [wh] = await db.update(webhooks).set({ ...data, updatedAt: new Date() }).where(eq(webhooks.id, id)).returning();
  revalidatePath("/dashboard/settings/webhooks");
  return wh;
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
  const activeWebhooks = await db
    .select()
    .from(webhooks)
    .where(eq(webhooks.isActive, true));

  const eligible = activeWebhooks.filter((wh) => wh.events.includes(event) || wh.events.includes("*"));

  const body = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });

  await Promise.allSettled(
    eligible.map(async (wh) => {
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
    })
  );
}
