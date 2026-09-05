import Link from "next/link";

import { getTranslations } from "next-intl/server";

import { getFinanceDashboard } from "@/actions/finance";
import { Button } from "@/components/ui/button";
import { requirePageCapability } from "@/lib/page-guard";

import { CashFlowOverview } from "./_components/cash-flow-overview";
import { FinanceKPICards } from "./_components/finance-kpi-cards";
import { IncomeReliability } from "./_components/income-reliability";
import { SpendingBreakdown } from "./_components/spending-breakdown";

export default async function FinancePage() {
  // The dashboard underneath has always required an administrator, and the page
  // had no guard at all — so everybody else reached it and met a raw error
  // instead of the redirect that says why. The money stays where it was; only
  // the way of being told changes.
  await requirePageCapability("settings:manage", "/dashboard/sales/finance");

  const [data, t] = await Promise.all([getFinanceDashboard(), getTranslations("finance")]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-2xl tracking-tight">{t("overviewTitle")}</h1>
          <p className="mt-1 text-muted-foreground">{t("overviewSubtitle")}</p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/dashboard/pipeline">{t("viewPipeline")}</Link>
        </Button>
      </div>

      <FinanceKPICards data={data} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <CashFlowOverview revenueTrend={data.revenueTrend} />
          <SpendingBreakdown revenueBreakdown={data.revenueBreakdown} />
        </div>
        <div>
          <IncomeReliability pipelineByStage={data.pipelineByStage} />
        </div>
      </div>
    </div>
  );
}
