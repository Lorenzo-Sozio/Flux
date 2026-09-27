import { redirect } from "next/navigation";

import { getCompaniesForSelect, getContactsForSelect } from "@/actions/crm";
import { getPipelineData } from "@/actions/pipeline";
import { getActor, hasCapability } from "@/lib/auth-guard";
import { parsePipelineFilters } from "@/lib/pipeline-filters";

import { PipelineBoard } from "./components/pipeline-board";

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // ⚠️ The board opens on the deals of whoever is looking. It opened on everybody's, so a
  // salesperson's own work was one filter away every morning. Written into the URL rather
  // than applied silently, so the filter bar shows what is applied; "everyone" is
  // `owners=all`, which stays.
  if (params.owners === undefined) {
    const actor = await getActor();
    if (actor) {
      const next = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) if (typeof v === "string") next.set(k, v);
      next.set("owners", actor.userId);
      redirect(`/dashboard/pipeline?${next.toString()}`);
    }
  }
  const filters = parsePipelineFilters(params);
  // Workspace role, not the platform staff field (audit rilievo U-02).
  const [canEdit, canManageStages] = await Promise.all([
    hasCapability("record:write"),
    hasCapability("pipeline:manage"),
  ]);

  // The deal modal needs two dropdowns, not every column of every record. These
  // used to load the full contact and company tables on each visit to the board
  // (audit rilievo B-08).
  const [data, companies, contacts] = await Promise.all([
    getPipelineData(filters),
    getCompaniesForSelect(),
    getContactsForSelect(),
  ]);

  return (
    <div className="h-full min-h-0 bg-muted/10">
      <PipelineBoard
        initialStages={data.stages}
        initialDeals={data.deals}
        companies={companies}
        contacts={contacts}
        canEdit={canEdit}
        canManageStages={canManageStages}
      />
    </div>
  );
}
