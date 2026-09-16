import { getTranslations } from "next-intl/server";

import { getTerritoryReport } from "@/actions/territory-report";
import { requirePageCapability } from "@/lib/page-guard";
import { can } from "@/lib/permissions";
import { parsePipelineFilters, pipelineView } from "@/lib/pipeline-filters";

import { TerritoryTable } from "./_components/territory-table";

/**
 * Leads and pipeline by territory.
 *
 * Under the pipeline rather than under /dashboard/reports, like the funnel and
 * win/loss beside it: it answers a sales question and should not need the
 * reporting package to open.
 */
export default async function TerritoryReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePageCapability("report:read");
  const { owners, period } = parsePipelineFilters(await searchParams, {
    period: pipelineView("territories").defaultPeriod,
  });

  const [report, t] = await Promise.all([getTerritoryReport(period, owners), getTranslations("pipeline.territories")]);

  return (
    <div className="space-y-6">
      <div className="min-w-0">
        <h1 className="font-bold text-2xl tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
      </div>

      <TerritoryTable report={report} canManage={can(actor, "territory:manage")} />
    </div>
  );
}
