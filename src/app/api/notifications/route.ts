import { NextResponse } from "next/server";

import { desc, eq } from "drizzle-orm";

import { auth } from "@/auth";
import { notifications } from "@/db/schema";
import { getDb } from "@/lib/tenant-context";

/** Lightweight polling endpoint used by NotificationCenter every 60s. */
export async function GET() {
  const db = await getDb();
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const items = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, session.user.id))
    .orderBy(desc(notifications.createdAt))
    .limit(50);

  return NextResponse.json({ notifications: items });
}
