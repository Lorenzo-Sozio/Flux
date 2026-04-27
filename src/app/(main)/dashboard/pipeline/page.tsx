import { getPipelineData } from "@/actions/pipeline";
import { getCompanies, getContacts } from "@/actions/crm";
import { PipelineBoard } from "./components/pipeline-board";
import { auth } from "@/auth";

export default async function PipelinePage() {
  const session = await auth();
  const role = session?.user?.role;
  const canEdit = role !== "viewer";
  const canManageStages = role === "admin" || role === "owner";

  const [data, companies, contacts] = await Promise.all([
    getPipelineData(),
    getCompanies(),
    getContacts(),
  ]);

  return (
    <div className="p-4 sm:p-6 md:p-8 h-full bg-muted/10">
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
