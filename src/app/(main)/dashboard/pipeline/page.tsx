import { getPipelineData } from "@/actions/pipeline";
import { PipelineBoard } from "./components/pipeline-board";

export default async function PipelinePage() {
  const data = await getPipelineData();

  return (
    <div className="flex h-full flex-col p-8 space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Sales Pipeline</h1>
      <PipelineBoard initialStages={data.stages} initialDeals={data.deals} />
    </div>
  );
}
