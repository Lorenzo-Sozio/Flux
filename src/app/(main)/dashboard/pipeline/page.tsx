import { getCompaniesForSelect, getContactsForSelect } from "@/actions/crm";
import { getPipelineData } from "@/actions/pipeline";
import { hasCapability } from "@/lib/auth-guard";

import { PipelineBoard } from "./components/pipeline-board";

export default async function PipelinePage() {
  // Workspace role, not the platform staff field (audit rilievo U-02).
  const [canEdit, canManageStages] = await Promise.all([
    hasCapability("record:write"),
    hasCapability("pipeline:manage"),
  ]);

  // The deal modal needs two dropdowns, not every column of every record. These
  // used to load the full contact and company tables on each visit to the board
  // (audit rilievo B-08).
  const [data, companies, contacts] = await Promise.all([
    getPipelineData(),
    getCompaniesForSelect(),
    getContactsForSelect(),
  ]);

  return (
    <div className="h-full bg-muted/10">
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
