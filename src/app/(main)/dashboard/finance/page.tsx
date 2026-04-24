import Link from "next/link";

import { DollarSign, GitPullRequest, Target, TrendingUp } from "lucide-react";

import { getFinanceDashboard } from "@/actions/finance";
import { MetricCard } from "@/components/crm/metric-card";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { getTranslations } from "next-intl/server";

import { CashFlowOverview } from "./_components/cash-flow-overview";
import { IncomeReliability } from "./_components/income-reliability";
import { SpendingBreakdown } from "./_components/spending-breakdown";

export default async function FinancePage() {
  const [data, t] = await Promise.all([getFinanceDashboard(), getTranslations("finance")]);

  const momDelta =
    data.monthlyRevenueLastMonth > 0
      ? ((data.monthlyRevenue - data.monthlyRevenueLastMonth) / data.monthlyRevenueLastMonth) * 100
      : null;

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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          icon={DollarSign}
          label={t("totalRevenue")}
          value={formatCurrency(data.totalRevenue, { noDecimals: true })}
          description={
            data.totalRevenueLastMonth > 0
              ? t("lastMonthRevenue", { amount: formatCurrency(data.totalRevenueLastMonth, { noDecimals: true }) })
              : t("dealsAndOrders")
          }
        />
        <MetricCard
          icon={GitPullRequest}
          label={t("pipelineValue")}
          value={formatCurrency(data.pipelineValue, { noDecimals: true })}
          description={t("pipelineWeighted", { raw: formatCurrency(data.pipelineValueRaw, { noDecimals: true }) })}
        />
        <MetricCard
          icon={TrendingUp}
          label={t("thisMonth")}
          value={formatCurrency(data.monthlyRevenue, { noDecimals: true })}
          description={
            momDelta !== null
              ? t("vsLastMonth", { delta: `${momDelta >= 0 ? "+" : ""}${momDelta.toFixed(1)}` })
              : t("dealsAndOrdersShort")
          }
          trend={momDelta === null ? "neutral" : momDelta >= 0 ? "up" : "down"}
        />
        <MetricCard
          icon={Target}
          label={t("winRate")}
          value={`${data.winRate}%`}
          description={t("winRateDesc", { won: data.dealsWon, lost: data.dealsLost })}
          trend={data.winRate >= 50 ? "up" : data.winRate > 0 ? "down" : "neutral"}
        />
      </div>

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
