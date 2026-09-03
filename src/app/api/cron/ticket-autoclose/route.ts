import { autoCloseResolvedTickets } from "@/actions/support";
import { runCronJob } from "@/lib/cron-runner";

/** Closes resolved tickets that have gone quiet, in every workspace. Daily. */
export async function GET(req: Request) {
  return runCronJob("ticket-autoclose", req, async () => ({ closed: await autoCloseResolvedTickets() }));
}
