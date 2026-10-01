import "server-only";

import { notifications } from "@/db/schema";
import { composeNotification, type NotificationKey, type NotificationParams } from "@/lib/notification-text";
import { announce } from "@/lib/push-send";
import { getDb } from "@/lib/tenant-context";

/**
 * Writing a notification, and ringing the doorbell for it.
 *
 * ⚠️ **This is not a server action, and that is the point.** It used to live in
 * `src/actions/auth.ts` behind `"use server"`, which registers every exported
 * function as an endpoint the browser can call. It had no authorisation check of
 * any kind and took the recipient's id from its caller, so anything able to
 * reach it could have written a notification into any colleague's bell — and,
 * once web push was wired to the same rows, onto their phone.
 *
 * It was never reachable in practice: no client component imported it, so its
 * action id never reached a bundle. But "not currently exported to the browser"
 * is a property of who happens to import it today, and this codebase's rule is
 * that an action guards. The alternative to guarding was impossible here — every
 * caller is a scheduled job or another server action, and half of them run with
 * no session at all — so the answer is that it should never have been an action.
 *
 * A plain server module has no endpoint. `server-only` makes importing it from a
 * client component a build error rather than a leak.
 */

interface Addressed {
  userId: string;
  type: string;
  link?: string;
}

/**
 * Either text a person wrote — an automation's own "send a notification" — or a
 * `notificationTexts` key and its values, which is how everything the product says itself
 * is written, so the bell can say it in the reader's language (src/lib/notification-text.ts).
 */
export type NotificationInput = Addressed &
  (
    | { title: string; message?: string; key?: never; params?: never }
    | { key: NotificationKey; params?: NotificationParams; title?: never; message?: never }
  );

async function toRow(n: NotificationInput) {
  const base = { userId: n.userId, type: n.type, link: n.link };
  if (n.key) {
    const params = n.params ?? {};
    const text = await composeNotification(n.key, params);
    return { ...base, ...text, titleKey: n.key, params };
  }
  return { ...base, title: n.title, message: n.message };
}

/** Writes one notification and, if the person asked for it, pushes it. */
export async function notify(data: NotificationInput): Promise<void> {
  const db = await getDb();
  const row = await toRow(data);
  await db.insert(notifications).values(row);
  // The row is the record; this is the doorbell. It happens after the response
  // and cannot fail this call — see src/lib/push-send.ts.
  announce(db, [row]);
}

/**
 * Writes several at once.
 *
 * One insert rather than one per row: the Neon HTTP driver has no session, so
 * every statement is its own round trip, and a job that notifies a group of
 * fifteen people should not make fifteen of them.
 */
export async function notifyMany(rows: NotificationInput[]): Promise<void> {
  if (rows.length === 0) return;
  await notifyManyIn(await getDb(), rows);
}

/**
 * The same, into a database the caller hands over: an API route, a webhook or a job has no
 * session, and `getDb()` throws there — a notification it wrote through `notify` was lost unseen.
 */
// biome-ignore lint/suspicious/noExplicitAny: the tenant db handle is built per request
export async function notifyManyIn(db: any, rows: NotificationInput[]): Promise<void> {
  if (rows.length === 0) return;
  const written = await Promise.all(rows.map(toRow));
  await db.insert(notifications).values(written);
  announce(db, written);
}
