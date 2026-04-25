import { redirect } from "next/navigation";

import { getWorkloadMatrix } from "@/actions/workload";
import { auth } from "@/auth";

import { WorkloadClient } from "./_components/workload-client";

export default async function WorkloadPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDate = new Date(today.getTime() + 27 * 86400000); // 4 weeks

  const matrix = await getWorkloadMatrix(today, endDate);

  return <WorkloadClient matrix={matrix} startDate={today} endDate={endDate} />;
}
