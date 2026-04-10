import { getPipelineData } from "@/actions/pipeline";
import { getCompanies, getContacts } from "@/actions/crm";
import { PipelineBoard } from "./components/pipeline-board";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { BarChart2 } from "lucide-react";
import { auth } from "@/auth";

export default async function PipelinePage() {
  const session = await auth();
  const canEdit = session?.user?.role !== "viewer";

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
      />
    </div>
  );
}
