import { getRepScorecard } from "@/actions/reports";
import { currentPeriodKey } from "@/lib/calendar-period";
import { requirePageCapability } from "@/lib/page-guard";
import { getWorkspaceTimeZone } from "@/lib/workspace-time-zone";

import { ScorecardClient } from "./_components/scorecard-client";

/**
 * One row per salesperson for a month, quarter or year: won against target, coverage,
 * win rate, average value, cycle and the calls, meetings and emails behind them (§11.2).
 * Every figure that counts deals opens the deals it counted.
 */
export default async function ScorecardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePageCapability("report:read", "/dashboard/reports/scorecard");
  const params = await searchParams;
  const period = typeof params.period === "string" ? params.period : null;
  const [data, timeZone] = await Promise.all([getRepScorecard({ period }), getWorkspaceTimeZone()]);
  // Null only for a period with no bounds, which a parsed key never is.
  if (!data) return null;
  return <ScorecardClient data={data} today={currentPeriodKey("month", new Date(), timeZone)} />;
}
