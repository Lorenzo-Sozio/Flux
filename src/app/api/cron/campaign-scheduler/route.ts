// Campaign scheduler - dispatches campaigns whose scheduledAt has passed, in every
// workspace. Run every 5 minutes.
// External: curl -H "Authorization: Bearer $CRON_SECRET" https://your-domain/api/cron/campaign-scheduler

import { dispatchDueCampaigns } from "@/lib/campaign-send";
import { runCronJob } from "@/lib/cron-runner";

export async function GET(req: Request) {
  // `dispatchDueCampaigns` calls getDb() internally; runCronJob sets the active
  // workspace around each call so it resolves per tenant (audit rilievo B-02).
  return runCronJob("campaign-scheduler", req, async () => {
    const results = await dispatchDueCampaigns();
    return { dispatched: results.length, campaigns: results };
  });
}
