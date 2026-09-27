import { getCommissions } from "@/actions/commissions";
import { getPipelines } from "@/actions/pipeline";
import { getPipelineMembers } from "@/actions/pipeline-members";
import { currentPeriodKey } from "@/lib/calendar-period";
import { approvableMonths } from "@/lib/commissions";
import { parsePipelineFilters } from "@/lib/pipeline-filters";
import { toWallDate } from "@/lib/wall-clock";

import { CommissionsClient } from "./_components/commissions-client";

/**
 * Commissions (L8): accrued on the won deal (D6), per person, for a month, quarter or year.
 * A manager sets the rates and approves a month once it is over; everybody else sees their
 * own — decided by the action, not by this page.
 */
export default async function CommissionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { owners } = parsePipelineFilters(params);
  const period = typeof params.period === "string" ? params.period : null;
  const [data, members, pipelines] = await Promise.all([
    getCommissions({ period, owners }),
    getPipelineMembers(),
    getPipelines().catch(() => []),
  ]);
  // Null only for a period with no bounds, which a parsed key never is.
  if (!data.report) return null;
  const now = new Date();

  return (
    <CommissionsClient
      report={data.report}
      rules={data.rules}
      canManage={data.canManage}
      timeZone={data.timeZone}
      members={members.map((m) => ({ id: m.id, name: m.name ?? m.email ?? m.id, former: m.former }))}
      pipelines={pipelines.map((p) => ({ id: p.id, name: p.name }))}
      approvable={approvableMonths(data.report, now, data.timeZone)}
      today={currentPeriodKey("month", now, data.timeZone)}
      todayDate={toWallDate(now, data.timeZone)}
    />
  );
}
