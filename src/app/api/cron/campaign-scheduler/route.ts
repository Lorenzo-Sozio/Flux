// Campaign scheduler — dispatches campaigns whose scheduledAt has passed.
// Run every 5 minutes: cron schedule "0,5,10,... * * * *" (every 5 min)
// External: curl -H "Authorization: Bearer $CRON_SECRET" https://your-domain/api/cron/campaign-scheduler

import { NextRequest, NextResponse } from "next/server";
import { dispatchDueCampaigns } from "@/lib/campaign-send";
import { verifyCronRequest } from "@/lib/cron-auth";

export async function GET(req: NextRequest) {
  const authError = verifyCronRequest(req);
  if (authError) return authError;

  try {
    const results = await dispatchDueCampaigns();
    return NextResponse.json({ dispatched: results.length, campaigns: results });
  } catch (err) {
    console.error("[campaign-scheduler]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
