// Campaign scheduler — dispatches campaigns whose scheduledAt has passed.
// Run every 5 minutes: cron schedule "0,5,10,... * * * *" (every 5 min)
// External: curl -H "Authorization: Bearer $CRON_SECRET" https://your-domain/api/cron/campaign-scheduler

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { dispatchDueCampaigns } from "@/lib/campaign-send";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const authHeader = req.headers.get("authorization") ?? "";
    const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    let authorized = false;
    try {
      const a = Buffer.from(provided);
      const b = Buffer.from(secret);
      authorized = a.length === b.length && timingSafeEqual(a, b);
    } catch {}
    if (!authorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const results = await dispatchDueCampaigns();
    return NextResponse.json({ dispatched: results.length, campaigns: results });
  } catch (err) {
    console.error("[campaign-scheduler]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
