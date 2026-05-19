"use client";

import { DollarSign, GitPullRequest, Target, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";

import type { FinanceDashboardData } from "@/actions/finance";
import { MetricCard } from "@/components/crm/metric-card";
import { useCurrency } from "@/hooks/use-currency";

export function FinanceKPICards({ data }: { data: FinanceDashboardData }) {
  const { formatAmount } = useCurrency();
  const t = useTranslations("finance");

  const momDelta =
    data.monthlyRevenueLastMonth > 0
      ? ((data.monthlyRevenue - data.monthlyRevenueLastMonth) / data.monthlyRevenueLastMonth) * 100
      : null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <MetricCard
        icon={DollarSign}
        label={t("totalRevenue")}
        value={formatAmount(data.totalRevenue, { noDecimals: true })}
        description={
          data.totalRevenueLastMonth > 0
            ? t("lastMonthRevenue", { amount: formatAmount(data.totalRevenueLastMonth, { noDecimals: true }) })
            : t("dealsAndOrders")
        }
      />
      <MetricCard
        icon={GitPullRequest}
        label={t("pipelineValue")}
        value={formatAmount(data.pipelineValue, { noDecimals: true })}
        description={t("pipelineWeighted", { raw: formatAmount(data.pipelineValueRaw, { noDecimals: true }) })}
      />
      <MetricCard
        icon={TrendingUp}
        label={t("thisMonth")}
        value={formatAmount(data.monthlyRevenue, { noDecimals: true })}
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
  );
}
