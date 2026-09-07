"use server";

import { revalidatePath } from "next/cache";

import { and, eq, inArray } from "drizzle-orm";

import { auth } from "@/auth";
import { notificationPreferences, pushSubscriptions } from "@/db/schema";
import { devicesOf, subscriptionsFor, vapidKeys } from "@/lib/push-send";
import { isPushType, type PushType, parseOverrides, resolveAll, serialiseOverrides } from "@/lib/push-types";
import { getDb } from "@/lib/tenant-context";
import { sendPush } from "@/lib/web-push";

/**
 * Signing a device up to be notified, and choosing what for.
 *
 * ⚠️ Everything here is scoped to the session's own user and nothing takes a
 * user id from the caller. These are personal settings, so there is no
 * capability that gates them — a `viewer` is as entitled to be told about a task
 * assigned to them as an owner is — but that makes the session the only thing
 * standing between one person's devices and another's. A `userId` parameter here
 * would be a way to read somebody else's subscription keys and then send to
 * their phone.
 */

const SETTINGS_PATH = "/dashboard/settings/notifications";

async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated.");
  return session.user.id;
}

export interface PushSettings {
  /** The key a browser needs to subscribe, or null when push is not configured. */
  publicKey: string | null;
  enabled: boolean;
  types: Record<PushType, boolean>;
  devices: { id: string; endpoint: string; userAgent: string | null; createdAt: Date; lastSuccessAt: Date | null }[];
}

/**
 * Everything the settings screen needs, in one call.
 *
 * ⚠️ The VAPID public key is served from here rather than through a
 * `NEXT_PUBLIC_` variable on purpose. Next inlines those at build time, and this
 * product's Cloudflare deployment builds in a place where the runtime variables
 * are not present — a public key compiled in as an empty string would make
 * `pushManager.subscribe` fail on every device with an error about the
 * applicationServerKey, long after anyone was looking at the build.
 */
export async function getPushSettings(): Promise<PushSettings> {
  const userId = await requireUser();
  const db = await getDb();

  const [[prefs], devices] = await Promise.all([
    db
      .select({ pushEnabled: notificationPreferences.pushEnabled, overrides: notificationPreferences.overrides })
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId)),
    devicesOf(db, userId),
  ]);

  const resolved = {
    enabled: prefs?.pushEnabled ?? true,
    overrides: parseOverrides(prefs?.overrides),
  };

  return {
    publicKey: vapidKeys()?.publicKey ?? null,
    enabled: resolved.enabled,
    types: resolveAll(resolved),
    devices,
  };
}

/**
 * Records a browser's subscription, or refreshes the one it already had.
 *
 * ⚠️ The endpoint is unique across the workspace, and a browser that re-subscribes
 * presents the same endpoint with fresh keys. Inserting blindly would fail on the
 * constraint; ignoring the conflict would leave stale keys that encrypt to
 * nothing. So it updates — including the owner, because a shared computer where
 * one person logs out and another logs in produces exactly that: the same
 * endpoint, a different user.
 */
export async function savePushSubscription(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
}) {
  const userId = await requireUser();
  const db = await getDb();

  if (!/^https:\/\//.test(input.endpoint) || !input.p256dh || !input.auth) {
    return { error: "Invalid subscription." };
  }

  await db
    .insert(pushSubscriptions)
    .values({
      userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId,
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent?.slice(0, 300) ?? null,
      },
    });

  revalidatePath(SETTINGS_PATH);
  return { success: true };
}

/**
 * Removes one device.
 *
 * Scoped to the session's own subscriptions: an endpoint is a long opaque string
 * but it is not a secret, and deleting by endpoint alone would let anyone who
 * learned one silence somebody else's phone.
 */
export async function removePushSubscription(endpoint: string) {
  const userId = await requireUser();
  const db = await getDb();

  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));

  revalidatePath(SETTINGS_PATH);
  return { success: true };
}

/**
 * Saves the switches.
 *
 * Only types the catalogue knows are stored, and only the ones actually chosen —
 * see `src/lib/push-types.ts` for why the complete list is deliberately not
 * written down here.
 */
export async function updatePushPreferences(input: { enabled?: boolean; types?: Record<string, boolean> }) {
  const userId = await requireUser();
  const db = await getDb();

  const [existing] = await db
    .select({ pushEnabled: notificationPreferences.pushEnabled, overrides: notificationPreferences.overrides })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId));

  const overrides = parseOverrides(existing?.overrides);
  for (const [type, on] of Object.entries(input.types ?? {})) {
    if (isPushType(type) && typeof on === "boolean") overrides[type] = on;
  }

  const values = {
    userId,
    pushEnabled: input.enabled ?? existing?.pushEnabled ?? true,
    overrides: serialiseOverrides(overrides),
    updatedAt: new Date(),
  };

  await db
    .insert(notificationPreferences)
    .values(values)
    .onConflictDoUpdate({
      target: notificationPreferences.userId,
      set: { pushEnabled: values.pushEnabled, overrides: values.overrides, updatedAt: values.updatedAt },
    });

  revalidatePath(SETTINGS_PATH);
  return { success: true };
}

/**
 * Sends one notification to the caller's own devices, right now, and reports
 * what each push service said.
 *
 * ⚠️ This is the only way anybody ever finds out that push is broken. Every
 * other path is fire-and-forget behind `after()`: a wrong VAPID key, a payload
 * a browser cannot decrypt, a blocked outbound request — all of them look
 * exactly like "nothing happened", on somebody else's phone, hours later. This
 * button turns that into an answer on screen.
 *
 * It deliberately ignores the type switches. A person pressing "send me a test"
 * is asking whether the plumbing works, not whether they want to hear about
 * quotes.
 */
export async function sendTestPush() {
  const userId = await requireUser();
  const keys = vapidKeys();
  if (!keys) return { error: "notConfigured" as const };

  const db = await getDb();
  const devices = await subscriptionsFor(db, userId);
  if (devices.length === 0) return { error: "noDevices" as const };

  const payload = JSON.stringify({
    title: "Flux",
    body: "Le notifiche funzionano su questo dispositivo.",
    link: SETTINGS_PATH,
    tag: "flux-test",
  });

  const results = await Promise.all(
    devices.map(async (device) => ({ device, outcome: await sendPush(device, payload, keys) })),
  );

  // A device that answers 410 during a test is dead in exactly the way the send
  // path deletes on, so do the same here rather than leaving it to be found.
  const dead = results.filter((r) => r.outcome.status === "gone").map((r) => r.device.id);
  if (dead.length > 0) {
    await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, dead));
    revalidatePath(SETTINGS_PATH);
  }

  const sent = results.filter((r) => r.outcome.status === "sent").length;
  const failures = results
    .filter((r) => r.outcome.status === "failed" || r.outcome.status === "retry")
    .map((r) => ("detail" in r.outcome ? r.outcome.detail : "unknown"));

  return { sent, removed: dead.length, failures };
}
