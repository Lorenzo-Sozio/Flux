import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { listSavedReports } from "@/actions/report-builder";
import { ENTITY_CONFIGS } from "@/lib/report-builder-config";
import { ReportBuilderClient } from "./_components/report-builder-client";

export default async function ReportBuilderPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const role = (session.user as { role?: string }).role;
  if (!["admin", "owner"].includes(role ?? "")) redirect("/dashboard");

  const saved = await listSavedReports();

  return (
    <div className="flex flex-col h-full">
      <ReportBuilderClient
        entityConfigs={ENTITY_CONFIGS}
        savedReports={saved}
      />
    </div>
  );
}
