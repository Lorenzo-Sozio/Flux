import { listSavedReports } from "@/actions/report-builder";
import { requirePageCapability } from "@/lib/page-guard";
import { ENTITY_CONFIGS } from "@/lib/report-builder-config";

import { ReportBuilderClient } from "./_components/report-builder-client";

export default async function ReportBuilderPage() {
  // Reading a report needs no more authority than reading the rows behind it.
  // Saving and deleting shared reports is gated separately in the actions.
  await requirePageCapability("report:read", "/dashboard/reports/builder");

  const saved = await listSavedReports();

  return (
    <div className="flex h-full flex-col">
      <ReportBuilderClient entityConfigs={ENTITY_CONFIGS} savedReports={saved} />
    </div>
  );
}
