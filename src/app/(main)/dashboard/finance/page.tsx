import Link from "next/link";

import { DollarSign, GitPullRequest, Target, TrendingUp } from "lucide-react";

import { getFinanceDashboard } from "@/actions/finance";
import { MetricCard } from "@/components/crm/metric-card";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";

import { CashFlowOverview } from "./_components/cash-flow-overview";
import { IncomeReliability } from "./_components/income-reliability";
import { SpendingBreakdown } from "./_components/spending-breakdown";

export default async function FinancePage() {
  const data = await getFinanceDashboard();

  const momDelta =
    data.monthlyRevenueLastMonth > 0
      ? ((data.monthlyRevenue - data.monthlyRevenueLastMonth) / data.monthlyRevenueLastMonth) * 100
      : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Finance Overview</h1>
          <p className="text-muted-foreground mt-1">Revenue performance, pipeline value and deal win rate.</p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/dashboard/pipeline">View Pipeline</Link>
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          icon={DollarSign}
          label="Total Revenue"
          value={formatCurrency(data.totalRevenue, { noDecimals: true })}
          description={
            data.totalRevenueLastMonth > 0
              ? `${formatCurrency(data.totalRevenueLastMonth, { noDecimals: true })} last month`
              : "Deals won + Orders completed"
          }
        />
        <MetricCard
          icon={GitPullRequest}
          label="Pipeline Value"
          value={formatCurrency(data.pipelineValue, { noDecimals: true })}
          description={`${formatCurrency(data.pipelineValueRaw, { noDecimals: true })} raw · weighted by probability`}
        />
        <MetricCard
          icon={TrendingUp}
          label="This Month"
          value={formatCurrency(data.monthlyRevenue, { noDecimals: true })}
          description={
            momDelta !== null
              ? `${momDelta >= 0 ? "+" : ""}${momDelta.toFixed(1)}% vs last month`
              : "Deals won + Orders"
          }
          trend={momDelta === null ? "neutral" : momDelta >= 0 ? "up" : "down"}
        />
        <MetricCard
          icon={Target}
          label="Win Rate"
          value={`${data.winRate}%`}
          description={`${data.dealsWon} won · ${data.dealsLost} lost · last 90 days`}
          trend={data.winRate >= 50 ? "up" : data.winRate > 0 ? "down" : "neutral"}
        />
      </div>

      {/* Main grid: chart + sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Revenue Trend + Revenue Sources */}
        <div className="lg:col-span-2 space-y-6">
          <CashFlowOverview revenueTrend={data.revenueTrend} />
          <SpendingBreakdown revenueBreakdown={data.revenueBreakdown} />
        </div>

        {/* Right: Pipeline Health */}
        <div>
          <IncomeReliability pipelineByStage={data.pipelineByStage} />
        </div>
      </div>
    </div>
  );
}
