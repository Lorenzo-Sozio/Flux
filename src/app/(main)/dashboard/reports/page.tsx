import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { subDays } from "date-fns";
import { BarChart3 } from "lucide-react";

import {
  getReportKPIs, getActivityByUser, getActivityByAction,
  getDailyActivityTrend, getTaskPerformanceByUser,
  getRecentActivityLog, getCampaignPerformanceSummary,
  getReportUsers,
} from "@/actions/reports";
import { ReportsClient } from "./_components/reports-client";

export default async function ReportsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = (session.user as { role?: string }).role;
  if (!["admin", "owner"].includes(role ?? "")) redirect("/dashboard");

  const defaultFrom = subDays(new Date(), 29).toISOString().split("T")[0];
  const defaultTo   = new Date().toISOString().split("T")[0];
  const filters     = { from: defaultFrom, to: defaultTo };

  const [users, kpis, activityByUser, activityByAction, dailyTrend, taskPerf, recentLog, campaignPerf] =
    await Promise.all([
      getReportUsers(),
      getReportKPIs(filters),
      getActivityByUser(filters),
      getActivityByAction(filters),
      getDailyActivityTrend(filters),
      getTaskPerformanceByUser(filters),
      getRecentActivityLog({ ...filters, limit: 100 }),
      getCampaignPerformanceSummary(filters),
    ]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <BarChart3 className="w-6 h-6 text-primary" />
          Reports & Analytics
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Monitor user activity, performance metrics, and campaign results. Admin only.
        </p>
      </div>

      <ReportsClient
        users={users}
        initial={{ kpis, activityByUser, activityByAction, dailyTrend, taskPerf, recentLog, campaignPerf }}
      />
    </div>
  );
}
