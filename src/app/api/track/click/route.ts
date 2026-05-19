/**
 * Link click tracking redirect.
 * URL: /api/track/click?log=<campaignLogId>&url=<encodedUrl>&sig=<hmac>
 *
 * The HMAC signature (sig) is generated at campaign-send time via
 * signTrackingUrl(logId, url) and binds the destination URL to the
 * specific log entry, preventing open-redirect abuse.
 */
import { type NextRequest, NextResponse } from "next/server";

import { and, eq, isNull, notInArray, sql } from "drizzle-orm";

import { campaignLogs } from "@/db/schema";
import { getDb } from "@/lib/tenant-context";
import { verifyTrackingUrl } from "@/lib/tracking-token";

// Statuses that must never be downgraded by a click event
const PROTECTED_STATUSES = ["unsubscribed", "bounced", "complained"];

export async function GET(req: NextRequest) {
  const db = await getDb();
  const logId = req.nextUrl.searchParams.get("log");
  const url = req.nextUrl.searchParams.get("url");
  const sig = req.nextUrl.searchParams.get("sig");

  // Reject requests missing required tracking parameters
  if (!url) {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }

  // Verify the HMAC signature that was embedded at campaign-send time.
  // A missing or invalid signature means the URL was tampered with or forged.
  if (!logId || !sig || !verifyTrackingUrl(logId, url, sig)) {
    return NextResponse.json({ error: "Invalid tracking link" }, { status: 400 });
  }

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

  // The HMAC signature verified above guarantees url was produced by this server
  // and therefore points to a destination that was embedded at campaign-send time.
  // No additional scheme / hostname checks are needed.
  let destination: URL;
  try {
    destination = new URL(decodeURIComponent(url));
  } catch {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }

  return NextResponse.redirect(destination.toString());
}
