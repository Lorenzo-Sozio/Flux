/**
 * Email open tracking pixel.
 * Called when the tracking pixel in a campaign email is loaded.
 * URL: /api/track/open?log=<campaignLogId>
 */
import { type NextRequest, NextResponse } from "next/server";

import { and, eq, isNull, notInArray } from "drizzle-orm";

import { campaignLogs } from "@/db/schema";
import { getDb } from "@/lib/tenant-context";

// 1x1 transparent GIF
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

// Statuses that block advancing to "opened"
const PROTECTED_STATUSES = ["opened", "clicked", "unsubscribed", "bounced", "complained"];

export async function GET(req: NextRequest) {
  const db = await getDb();
  const logId = req.nextUrl.searchParams.get("log");

  if (logId) {
    const now = new Date();

    // 1. Advance status to "opened" only when not already at a higher state
    db.update(campaignLogs)
      .set({ status: "opened", openedAt: now })
      .where(and(eq(campaignLogs.id, logId), notInArray(campaignLogs.status, PROTECTED_STATUSES)))
      .catch((err) => console.error("[track/open] status advance failed", { logId, err }));

    // 2. Backfill openedAt when it is still null (e.g. status is already "clicked"
    //    because user clicked a link before the pixel loaded — Apple Mail, etc.)
    db.update(campaignLogs)
      .set({ openedAt: now })
      .where(
        and(
          eq(campaignLogs.id, logId),
          isNull(campaignLogs.openedAt),
          notInArray(campaignLogs.status, ["unsubscribed", "bounced", "complained"]),
        ),
      )
      .catch((err) => console.error("[track/open] openedAt backfill failed", { logId, err }));
  }

  return new Response(PIXEL, {
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
