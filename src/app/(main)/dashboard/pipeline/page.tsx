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
      <div className="mb-4 flex justify-end">
        <Button variant="outline" size="sm" asChild>
          <Link href="/dashboard/pipeline/report">
            <BarChart2 className="mr-2 h-4 w-4" /> Pipeline Report
          </Link>
        </Button>
      </div>
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
