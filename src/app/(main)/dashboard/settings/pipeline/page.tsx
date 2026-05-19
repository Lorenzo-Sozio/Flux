import { redirect } from "next/navigation";

import { getPipelineStages } from "@/actions/pipeline";
import { auth } from "@/auth";

import { PipelineStagesClient } from "./_components/pipeline-stages-client";

export default async function PipelineSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = (session.user as any).role;
  if (!["admin", "owner"].includes(role)) redirect("/dashboard/pipeline");

  const stages = await getPipelineStages();

  return <PipelineStagesClient stages={stages} />;
}
