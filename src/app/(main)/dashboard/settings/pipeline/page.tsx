import { getPipelineStages } from "@/actions/pipeline";
import { requirePageCapability } from "@/lib/page-guard";

import { PipelineStagesClient } from "./_components/pipeline-stages-client";

export default async function PipelineSettingsPage() {
  await requirePageCapability("pipeline:manage", "/dashboard/settings/pipeline");

  const stages = await getPipelineStages();

  return <PipelineStagesClient stages={stages} />;
}
