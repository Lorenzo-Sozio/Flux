import { redirect } from "next/navigation";

import { getWorkloadMatrix } from "@/actions/workload";
import { auth } from "@/auth";

import { WorkloadClient } from "./_components/workload-client";

export default async function WorkloadPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Snap to Monday of current week
  const dow = today.getDay();
  const monday = new Date(today.getTime() + (dow === 0 ? -6 : 1 - dow) * 86400000);

  // Default: 2 weeks (current + next)
  const endDate = new Date(monday.getTime() + 13 * 86400000);

  const matrix = await getWorkloadMatrix(monday, endDate);

  return <WorkloadClient matrix={matrix} startDate={monday} endDate={endDate} />;
}
