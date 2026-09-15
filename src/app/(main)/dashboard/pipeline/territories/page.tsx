import Link from "next/link";

import { ChevronLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { getTerritoryReport } from "@/actions/territory-report";
import { requirePageCapability } from "@/lib/page-guard";
import { can } from "@/lib/permissions";

import { TerritoryTable } from "./_components/territory-table";

/**
 * Leads and pipeline by territory.
 *
 * Under the pipeline rather than under /dashboard/reports, like the funnel and
 * win/loss beside it: it answers a sales question and should not need the
 * reporting package to open.
 */
export default async function TerritoryReportPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const actor = await requirePageCapability("report:read");
  const { days } = await searchParams;

  const [report, t, tp] = await Promise.all([
    getTerritoryReport(Number(days) || 90),
    getTranslations("pipeline.territories"),
    getTranslations("pipeline"),
  ]);

  return (
    <div className="space-y-6">
      <div className="min-w-0">
        <Link
          href="/dashboard/pipeline"
          className="mb-3 inline-flex items-center gap-1 text-muted-foreground text-sm transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          {tp("backToPipeline")}
        </Link>
        <h1 className="font-bold text-2xl tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
      </div>

      <TerritoryTable report={report} canManage={can(actor, "territory:manage")} />
    </div>
  );
}
