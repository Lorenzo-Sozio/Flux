import { getLossReasons } from "@/actions/pipeline";
import { requirePageCapability } from "@/lib/page-guard";
import { listPipelines, stagesOfPipeline } from "@/lib/pipelines";
import { getDb } from "@/lib/tenant-context";

import { PipelineStagesClient } from "./_components/pipeline-stages-client";
import { PipelinesBar } from "./_components/pipelines-bar";

/** The workspace's pipelines, and the stages of the one chosen (src/lib/pipelines.ts). */
export default async function PipelineSettingsPage({ searchParams }: { searchParams: Promise<{ pipeline?: string }> }) {
  await requirePageCapability("pipeline:manage", "/dashboard/settings/pipeline");
  const { pipeline } = await searchParams;
  const db = await getDb();
  const pipelines = await listPipelines(db);
  const current = pipelines.find((p) => p.id === pipeline)?.id ?? pipelines[0]?.id ?? "default";

  const [stages, lossReasons] = await Promise.all([stagesOfPipeline(db, current), getLossReasons(true)]);

  return (
    <div className="space-y-4">
      <PipelinesBar pipelines={pipelines} current={current} />
      {/* Keyed by pipeline: switching tabs is a different list, not an edit of this one. */}
      <PipelineStagesClient key={current} pipelineId={current} stages={stages} lossReasons={lossReasons} />
    </div>
  );
}
