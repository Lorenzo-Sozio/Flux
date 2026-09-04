import { NextResponse } from "next/server";

import { and, count, desc, eq, gt } from "drizzle-orm";

import { auth } from "@/auth";
import { notifications } from "@/db/schema";
import { getDb } from "@/lib/tenant-context";

/** Nobody is served a whole notification history to render a bell. */
const MAX_ROWS = 50;

/**
 * What the notification bell asks for.
 *
 * It used to return fifty complete rows every sixty seconds regardless of whether
 * anything had changed (audit rilievo U-11). Pass `since` — the newest timestamp
 * the client already holds — and it returns only what arrived after that, plus the
 * unread count, which is the only number the bell actually draws.
 *
 * Without `since` it returns the first page, as before, so a fresh mount still
 * works in one call.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const userId = session.user.id;

  const sinceParam = new URL(req.url).searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : null;
  const validSince = since && !Number.isNaN(since.getTime()) ? since : null;

  const where = validSince
    ? and(eq(notifications.userId, userId), gt(notifications.createdAt, validSince))
    : eq(notifications.userId, userId);

  const [items, [unread]] = await Promise.all([
    db.select().from(notifications).where(where).orderBy(desc(notifications.createdAt)).limit(MAX_ROWS),
    // Counted rather than derived from the page: an unread notification older than
    // the fifty newest still has to be counted, or the badge quietly under-reports.
    db
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false))),
  ]);

  return NextResponse.json(
    {
      notifications: items,
      unreadCount: Number(unread?.n ?? 0),
      // Whether this was a delta or a full page, so the client knows to merge
      // rather than replace.
      incremental: validSince !== null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
