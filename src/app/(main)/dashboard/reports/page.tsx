import { subDays } from "date-fns";
import { BarChart3 } from "lucide-react";
import { getTranslations } from "next-intl/server";

import {
  getActivityByAction,
  getActivityByUser,
  getCampaignPerformanceSummary,
  getDailyActivityTrend,
  getRecentActivityLog,
  getReportKPIs,
  getReportUsers,
  getSalesReport,
  getTaskPerformanceByUser,
} from "@/actions/reports";
import { requirePageCapability } from "@/lib/page-guard";

import { ReportsClient } from "./_components/reports-client";

export default async function ReportsPage() {
  await requirePageCapability("report:read", "/dashboard/reports");
  const t = await getTranslations("reports.overviewPage");

  const defaultFrom = subDays(new Date(), 29).toISOString().split("T")[0];
  const defaultTo = new Date().toISOString().split("T")[0];
  const filters = { from: defaultFrom, to: defaultTo };

  const [users, kpis, activityByUser, activityByAction, dailyTrend, taskPerf, recentLog, campaignPerf, salesReport] =
    await Promise.all([
      getReportUsers(),
      getReportKPIs(filters),
      getActivityByUser(filters),
      getActivityByAction(filters),
      getDailyActivityTrend(filters),
      getTaskPerformanceByUser(filters),
      getRecentActivityLog({ ...filters, limit: 100 }),
      getCampaignPerformanceSummary(filters),
      getSalesReport(filters),
    ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 font-bold text-2xl tracking-tight">
          <BarChart3 className="h-6 w-6 text-primary" />
          {t("title")}
        </h1>
        <p className="mt-1 text-muted-foreground text-sm">{t("subtitle")}</p>
      </div>

      <ReportsClient
        users={users}
        initial={{ kpis, activityByUser, activityByAction, dailyTrend, taskPerf, recentLog, campaignPerf, salesReport }}
      />
    </div>
  );
}
