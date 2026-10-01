import { getPipelineData } from "@/actions/pipeline";
import { getActor, hasCapability } from "@/lib/auth-guard";
import { parsePipelineFilters } from "@/lib/pipeline-filters";

import { DefaultOwnersParam } from "./components/default-owners-param";
import { PipelineBoard } from "./components/pipeline-board";

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // ⚠️ The board opens on the deals of whoever is looking. It opened on everybody's, so a
  // salesperson's own work was one filter away every morning. Written into the URL, so the filter
  // bar shows what is applied — by the browser, not by a redirect: the redirect made every tap on
  // Pipeline two server renders. "Everyone" is `owners=all`, which stays.
  const actor = params.owners === undefined ? await getActor() : null;
  const effective = actor ? { ...params, owners: actor.userId } : params;
  const filters = parsePipelineFilters(effective);
  // Workspace role, not the platform staff field (audit rilievo U-02). Read beside the board.
  // ⚠️ No company or contact lists here: the deal dialog asks for them when it opens. They used to
  // travel with every visit to the board, for a dialog most visits never open.
  const [canEdit, canManageStages, data] = await Promise.all([
    hasCapability("record:write"),
    hasCapability("pipeline:manage"),
    getPipelineData(filters),
  ]);

  return (
    <div className="h-full min-h-0 bg-muted/10">
      {actor && <DefaultOwnersParam userId={actor.userId} />}
      <PipelineBoard
        initialStages={data.stages}
        initialDeals={data.deals}
        canEdit={canEdit}
        canManageStages={canManageStages}
      />
    </div>
  );
}
