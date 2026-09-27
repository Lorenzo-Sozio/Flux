import { redirect } from "next/navigation";

import { getWorkloadMatrix } from "@/actions/workload";
import { auth } from "@/auth";
import { LOGIN_PATH, requirePageFeature } from "@/lib/page-guard";
import { addDaysToDate, toWallDate } from "@/lib/wall-clock";
import { getWorkspaceTimeZone } from "@/lib/workspace-time-zone";

import { WorkloadClient } from "./_components/workload-client";

export default async function WorkloadPage() {
  const session = await auth();
  if (!session?.user?.id) redirect(LOGIN_PATH);
  await requirePageFeature("projects", "/dashboard/tasks");

  // This week's Monday and the Friday after next, as calendar days on the workspace's
  // clock — the server's is UTC on Workers (src/lib/workload-allocation.ts).
  const today = toWallDate(new Date(), await getWorkspaceTimeZone());
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  const monday = addDaysToDate(today, dow === 0 ? -6 : 1 - dow);

  const matrix = await getWorkloadMatrix(monday, addDaysToDate(monday, 13));

  return <WorkloadClient matrix={matrix} start={monday} />;
}
