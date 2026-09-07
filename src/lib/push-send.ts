import "server-only";

import { after } from "next/server";

import { eq, inArray } from "drizzle-orm";

import { notificationPreferences, pushSubscriptions } from "@/db/schema";
import { getAppUrlOrNull } from "@/lib/app-url";
import { type PushPreferences, parseOverrides, shouldPush } from "@/lib/push-types";
import type { getDb } from "@/lib/tenant-context";
import { sendPush, type VapidKeys } from "@/lib/web-push";

/**
 * Delivering a notification to a device that is not looking at Flux.
 *
 * ⚠️ Everything here is best-effort by design, and nothing in it may fail the
 * work that caused it. Somebody assigning a task cares that the task was
 * assigned; whether a phone lit up is not their problem, and an exception thrown
 * on this path would surface to them as a failed save of something that in fact
 * saved. Every entry point returns rather than throws.
 *
 * The notification row in the database stays the source of truth. A push is an
 * announcement of a row that already exists, which is why a lost one costs
 * nothing permanent: the bell still shows it on the next visit.
 */

/** The shape a notification takes on the wire, read by the service worker. */
export interface PushMessage {
  title: string;
  body?: string;
  /** Where a tap should land, relative to the app's own origin. */
  link?: string;
  /** So two notifications about the same thing collapse instead of stacking. */
  tag?: string;
}

/**
 * The configured keys, or null when the feature has not been set up.
 *
 * ⚠️ Absent configuration is not an error. Web push is optional: a deployment
 * without VAPID keys works in every other respect, and the notification bell
 * behaves exactly as it did before. What must not happen is a stack trace on
 * every notification, in every workspace, forever.
 */
export function vapidKeys(): VapidKeys | null {
  const publicKey = process.env.PUSH_VAPID_PUBLIC_KEY;
  const privateKey = process.env.PUSH_VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;

  // A push service is entitled to a way of reaching whoever operates the sender.
  // Falling back to the application's own address is better than a placeholder
  // nobody reads, and better than refusing to send.
  const subject = process.env.PUSH_VAPID_SUBJECT ?? getAppUrlOrNull() ?? "https://localhost";
  return { publicKey, privateKey, subject };
}

/** True when this deployment can send at all. Cheap enough to call per request. */
export function isPushConfigured(): boolean {
  return vapidKeys() !== null;
}

/**
 * Runs work after the response has been sent, wherever that is possible.
 *
 * `after()` is the right tool — on Workers it becomes `waitUntil`, which keeps
 * the isolate alive without keeping the caller waiting. It needs a request
 * context, and a few callers (a script, a test) have none, so the fallback is a
 * floating promise whose failure is swallowed rather than left unhandled.
 */
function afterResponse(work: () => Promise<void>): void {
  try {
    after(work);
  } catch {
    void work().catch((error) => {
      console.error("[push] Delivery failed outside a request context:", error);
    });
  }
}

/** A handle on one customer's database, as every caller here already holds. */
type TenantDb = Awaited<ReturnType<typeof getDb>>;

/** What one person chose, defaults filled in for anyone who never chose. */
async function preferencesFor(db: TenantDb, userIds: string[]): Promise<Map<string, PushPreferences>> {
  const rows = await db
    .select({
      userId: notificationPreferences.userId,
      pushEnabled: notificationPreferences.pushEnabled,
      overrides: notificationPreferences.overrides,
    })
    .from(notificationPreferences)
    .where(inArray(notificationPreferences.userId, userIds));

  const out = new Map<string, PushPreferences>();
  for (const row of rows) {
    out.set(row.userId, { enabled: row.pushEnabled, overrides: parseOverrides(row.overrides) });
  }
  return out;
}

/**
 * Announces notifications that have already been written.
 *
 * Takes the rows rather than creating them: the database is the record, this is
 * the doorbell. Deduplicates the work per user, asks the preference table once,
 * and drops anything the person switched off before encrypting a single byte.
 */
export function announce(
  db: TenantDb,
  rows: { userId: string; type: string; title: string; message?: string | null; link?: string | null }[],
): void {
  if (rows.length === 0) return;
  const keys = vapidKeys();
  if (!keys) return;

  afterResponse(async () => {
    try {
      await deliver(db, rows, keys);
    } catch (error) {
      // Logged and dropped. There is nobody to report this to and nothing that
      // should change because of it.
      console.error("[push] Could not deliver a notification:", error);
    }
  });
}

/** The part that actually talks to push services. Exported for the cron path. */
export async function deliver(
  db: TenantDb,
  rows: { userId: string; type: string; title: string; message?: string | null; link?: string | null }[],
  keys: VapidKeys,
): Promise<{ sent: number; gone: number; failed: number }> {
  const userIds = [...new Set(rows.map((r) => r.userId))];
  const prefs = await preferencesFor(db, userIds);

  const wanted = rows.filter((row) => shouldPush(row.type, prefs.get(row.userId) ?? { enabled: true, overrides: {} }));
  if (wanted.length === 0) return { sent: 0, gone: 0, failed: 0 };

  const recipients = [...new Set(wanted.map((r) => r.userId))];
  const devices = await db
    .select({
      id: pushSubscriptions.id,
      userId: pushSubscriptions.userId,
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, recipients));

  if (devices.length === 0) return { sent: 0, gone: 0, failed: 0 };

  const byUser = new Map<string, typeof devices>();
  for (const device of devices) {
    const list = byUser.get(device.userId) ?? [];
    list.push(device);
    byUser.set(device.userId, list);
  }

  const dead: string[] = [];
  const alive: string[] = [];
  let sent = 0;
  let failed = 0;

  // One fetch per device per notification, all at once. A person has one or two
  // devices, and a batch from a cron job is tens of notifications, so this is
  // tens of parallel requests rather than a queue worth building.
  await Promise.all(
    wanted.flatMap((row) =>
      (byUser.get(row.userId) ?? []).map(async (device) => {
        const message: PushMessage = {
          title: row.title,
          body: row.message ?? undefined,
          link: row.link ?? undefined,
          // Two reminders about the same task replace each other rather than
          // filling the tray.
          tag: row.link ?? row.type,
        };
        const outcome = await sendPush(device, JSON.stringify(message), keys);
        if (outcome.status === "sent") {
          sent++;
          alive.push(device.id);
        } else if (outcome.status === "gone") dead.push(device.id);
        else failed++;
      }),
    ),
  );

  // ⚠️ A subscription that answers 410 answers 410 forever: the browser was
  // reinstalled, or permission was revoked, and it will never come back. Left in
  // place it turns every future notification for that person into a guaranteed
  // failed request, and the table only grows.
  if (dead.length > 0) {
    try {
      await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, [...new Set(dead)]));
    } catch (error) {
      console.error("[push] Could not remove dead subscriptions:", error);
    }
  }

  await touch(db, alive);

  return { sent, gone: new Set(dead).size, failed };
}

/**
 * Marks the devices a push service just accepted something for.
 *
 * ⚠️ The only signal there is. A device that quietly stopped working — permission
 * revoked in the browser's settings, a phone that was wiped and restored — keeps
 * a row that looks exactly like a working one, and the person is left with
 * "I don't get notifications any more" and nowhere to look. A date on the
 * settings screen turns that into something visible.
 *
 * Accepted by a push service is not delivered to a screen, and the wording on
 * that screen has to say so.
 */
export async function touch(db: TenantDb, subscriptionIds: string[]): Promise<void> {
  const ids = [...new Set(subscriptionIds)];
  if (ids.length === 0) return;
  try {
    await db.update(pushSubscriptions).set({ lastSuccessAt: new Date() }).where(inArray(pushSubscriptions.id, ids));
  } catch (error) {
    // Bookkeeping. The notification went out, which is the part that mattered.
    console.error("[push] Could not record a successful delivery:", error);
  }
}

/**
 * One person's devices with the keys needed to write to them.
 *
 * ⚠️ Separate from `devicesOf` on purpose. Those keys are what encrypt a message
 * for a specific browser, and anyone holding them plus the endpoint can push to
 * that device. They belong on the send path and nowhere near a page's props.
 */
export async function subscriptionsFor(db: TenantDb, userId: string) {
  return db
    .select({
      id: pushSubscriptions.id,
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
}

/** Used by the settings screen to show a person their own devices. */
export async function devicesOf(db: TenantDb, userId: string) {
  return db
    .select({
      id: pushSubscriptions.id,
      endpoint: pushSubscriptions.endpoint,
      userAgent: pushSubscriptions.userAgent,
      createdAt: pushSubscriptions.createdAt,
      lastSuccessAt: pushSubscriptions.lastSuccessAt,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
}
