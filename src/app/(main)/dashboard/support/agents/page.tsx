import { getSupportAgentReport } from "@/actions/support-report";
import { currentPeriodKey } from "@/lib/calendar-period";
import { requirePageCapability } from "@/lib/page-guard";
import { getWorkspaceTimeZone } from "@/lib/workspace-time-zone";

import { AgentsClient } from "./_components/agents-client";

/**
 * The support desk person by person for a month, quarter or year (§12.2): what arrived, what
 * was solved and how fast, which promises were kept, and what the customers said.
 */
export default async function SupportAgentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePageCapability("report:read", "/dashboard/support/agents");
  const params = await searchParams;
  const period = typeof params.period === "string" ? params.period : null;
  const [data, timeZone] = await Promise.all([getSupportAgentReport({ period }), getWorkspaceTimeZone()]);
  return <AgentsClient data={data} today={currentPeriodKey("month", new Date(), timeZone)} />;
}
