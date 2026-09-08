import { sweepIdempotencyKeys } from "@/lib/api-idempotency";
import { runCronJob } from "@/lib/cron-runner";

/**
 * Forgets idempotency keys old enough that nobody is going to retry them.
 *
 * ⚠️ Every keyed import stores its **whole response**, which is the point: a
 * repeat gets the original answer back, ids and all, instead of importing again.
 * It is also why the table cannot be left alone. A five-hundred-record answer is
 * tens of kilobytes, and a workspace importing daily writes one of those every
 * day, for ever, in a database the customer pays for.
 *
 * A key is worth keeping only as long as somebody might send it again. Thirty
 * days is far past any retry a client library would make on its own, and past
 * the point where a person re-running yesterday's file would still be calling it
 * the same import.
 *
 * ⚠️ Daily, and deliberately on the schedule `ticket-autoclose` already uses. The
 * Free plan allows five cron triggers per account and all five are spoken for;
 * a sixth schedule needs Workers Paid, while another job on an existing one is
 * free. custom-worker.ts maps the schedule to both routes.
 */
export async function GET(req: Request) {
  return runCronJob("idempotency-sweep", req, async (db) => ({ forgotten: await sweepIdempotencyKeys(db) }));
}
