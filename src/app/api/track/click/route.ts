/**
 * Link click tracking redirect.
 * URL: /api/track/click?log=<campaignLogId>&url=<encodedUrl>
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/tenant-context";
import { campaignLogs } from "@/db/schema";
import { and, eq, isNull, notInArray, sql } from "drizzle-orm";

// Statuses that must never be downgraded by a click event
const PROTECTED_STATUSES = ["unsubscribed", "bounced", "complained"];

export async function GET(req: NextRequest) {
  const db = await getDb();
  const logId = req.nextUrl.searchParams.get("log");
  const url = req.nextUrl.searchParams.get("url");

  if (logId) {
    const now = new Date();
    // Set status → "clicked" and record timestamps.
    // Guard: only on first click (clickedAt IS NULL) AND never overwrite negative statuses.
    // openedAt: COALESCE preserves the original open timestamp if pixel already fired.
    db.update(campaignLogs)
      .set({
        status: "clicked",
        clickedAt: now,
        openedAt: sql`COALESCE(${campaignLogs.openedAt}, ${now})`,
      })
      .where(
        and(
          eq(campaignLogs.id, logId),
          isNull(campaignLogs.clickedAt),
          notInArray(campaignLogs.status, PROTECTED_STATUSES),
        ),
      )
      .catch((err) => console.error("[track/click] DB update failed", { logId, err }));
  }

  if (!url) {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }

  // Prevent Open Redirect: only allow http/https absolute URLs.
  // javascript:, data:, and relative paths are rejected.
  let destination: URL;
  try {
    destination = new URL(decodeURIComponent(url));
  } catch {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }
  if (destination.protocol !== "https:" && destination.protocol !== "http:") {
    return NextResponse.json({ error: "Disallowed url scheme" }, { status: 400 });
  }

  return NextResponse.redirect(destination.toString());
}
