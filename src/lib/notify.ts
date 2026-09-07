import "server-only";

import { notifications } from "@/db/schema";
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

export interface NotificationInput {
  userId: string;
  type: string;
  title: string;
  message?: string;
  link?: string;
}

/** Writes one notification and, if the person asked for it, pushes it. */
export async function notify(data: NotificationInput): Promise<void> {
  const db = await getDb();
  await db.insert(notifications).values(data);
  // The row is the record; this is the doorbell. It happens after the response
  // and cannot fail this call — see src/lib/push-send.ts.
  announce(db, [data]);
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
  const db = await getDb();
  await db.insert(notifications).values(rows);
  announce(db, rows);
}
