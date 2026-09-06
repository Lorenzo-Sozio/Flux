import { runCronJob } from "@/lib/cron-runner";
import { riprova } from "@/lib/webhook-retry";

/**
 * Retries failed webhook deliveries, for every workspace.
 *
 *   Esterno:  curl -H "Authorization: Bearer $CRON_SECRET" https://.../api/cron/webhook-retry
 *
 * ⚠️ **Without this a lost event is simply lost**, and whoever was waiting for it has no
 * way of knowing: an integration that receives events "nearly always" is an integration
 * nothing can be decided on.
 *
 * ⚠️ Before `runCronJob` this route opened a single database with `getDb()`, which reads
 * the tenant from a header a scheduled request does not carry: the job threw before
 * retrying anything, so delivery was in fact *at-most-once* while the documentation said
 * otherwise (audit rilievo B-02).
 *
 * What to retry is decided by `lib/webhook-retry`, which is pure and tested: this file
 * holds only the cron authentication and the loop over workspaces.
 */
export async function GET(req: Request) {
  return runCronJob("webhook-retry", req, async (db) => riprova(db));
}
