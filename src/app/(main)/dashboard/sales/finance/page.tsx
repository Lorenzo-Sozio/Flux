import Link from "next/link";

import { getFinanceDashboard } from "@/actions/finance";
import { Button } from "@/components/ui/button";
import { getTranslations } from "next-intl/server";

import { CashFlowOverview } from "./_components/cash-flow-overview";
import { FinanceKPICards } from "./_components/finance-kpi-cards";
import { IncomeReliability } from "./_components/income-reliability";
import { SpendingBreakdown } from "./_components/spending-breakdown";

export default async function FinancePage() {
  const [data, t] = await Promise.all([getFinanceDashboard(), getTranslations("finance")]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("overviewTitle")}</h1>
          <p className="text-muted-foreground mt-1">{t("overviewSubtitle")}</p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/dashboard/pipeline">{t("viewPipeline")}</Link>
        </Button>
      </div>

      <FinanceKPICards data={data} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
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
