/**
 * Email open tracking pixel.
 * Called when the tracking pixel in a campaign email is loaded.
 * URL: /api/track/open?log=<campaignLogId>
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { campaignLogs } from "@/db/schema";
import { eq } from "drizzle-orm";

// 1x1 transparent GIF
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

export async function GET(req: NextRequest) {
  const logId = req.nextUrl.searchParams.get("log");

  if (logId) {
    // Fire-and-forget update
    db.update(campaignLogs)
      .set({ status: "opened" })
      .where(eq(campaignLogs.id, logId))
      .catch(() => {});
  }

  return new Response(PIXEL, {
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
