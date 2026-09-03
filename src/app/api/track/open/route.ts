/**
 * Email open tracking pixel.
 * Called when the tracking pixel in a campaign email is loaded.
 * URL: /api/track/open?log=<campaignLogId>
 */
import type { NextRequest } from "next/server";

import { and, eq, isNull, notInArray } from "drizzle-orm";

import { campaignLogs } from "@/db/schema";
import { resolveTenantByProbe } from "@/lib/tenant-resolve";

// 1x1 transparent GIF
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

// Statuses that block advancing to "opened"
const PROTECTED_STATUSES = ["opened", "clicked", "unsubscribed", "bounced", "complained"];

export async function GET(req: NextRequest) {
  const logId = req.nextUrl.searchParams.get("log");

  // No session and no tenant header — a mail client fetched this. The workspace
  // is derived from the log row instead (audit rilievo B-01). A failure here only
  // costs an unrecorded open; the pixel is always returned.
  const resolved = logId
    ? await resolveTenantByProbe(`campaignLog:${logId}`, async (db) => {
        const row = await db.query.campaignLogs.findFirst({
          where: eq(campaignLogs.id, logId),
          columns: { id: true },
        });
        return Boolean(row);
      }).catch(() => null)
    : null;

  const db = resolved?.db;

  if (logId && db) {
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
