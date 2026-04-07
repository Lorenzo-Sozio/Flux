/**
 * Link click tracking redirect.
 * URL: /api/track/click?log=<campaignLogId>&url=<encodedUrl>
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { campaignLogs } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const logId = req.nextUrl.searchParams.get("log");
  const url = req.nextUrl.searchParams.get("url");

  if (logId) {
    db.update(campaignLogs)
      .set({ status: "clicked", clickedAt: new Date() })
      .where(eq(campaignLogs.id, logId))
      .catch(() => {});
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
