"use client";

import { useMemo } from "react";

import { AlertTriangle, TrendingUp, Zap } from "lucide-react";
import { useTranslations } from "next-intl";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Rule {
  id: string;
  isActive: boolean;
}

interface AutomationLog {
  id: string;
  ruleId: string;
  success: boolean;
  createdAt: Date;
}

interface AutomationOverviewProps {
  rules: Rule[];
  logs: AutomationLog[];
}

export function AutomationOverview({ rules, logs }: AutomationOverviewProps) {
  const t = useTranslations("automation");
  const stats = useMemo(() => {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const active = rules.filter((r) => r.isActive).length;
    const last24hLogs = logs.filter((l) => new Date(l.createdAt) > last24h);
    const last24hSuccess = last24hLogs.filter((l) => l.success).length;
    const last24hFailed = last24hLogs.filter((l) => !l.success).length;

    return {
      total: rules.length,
      active,
      inactive: rules.length - active,
      last24hExecutions: last24hLogs.length,
      last24hSuccess,
      last24hFailed,
      successRate: last24hLogs.length > 0 ? Math.round((last24hSuccess / last24hLogs.length) * 100) : 0,
    };
  }, [rules, logs]);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      {/* Total Rules */}
      <Card className="border-blue-200/50 bg-gradient-to-br from-blue-50 to-blue-100/50 dark:border-blue-800/40 dark:from-blue-900/20 dark:to-blue-800/10">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-muted-foreground text-xs">{t("stats.totalRules")}</p>
              <p className="mt-1 font-bold text-2xl">{stats.total}</p>
              <p className="mt-2 text-green-600 text-xs dark:text-green-400">
                {t("stats.active", { count: stats.active })}
              </p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-100/50 dark:bg-blue-900/30">
              <Zap className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Last 24h Executions */}
      <Card className="border-purple-200/50 bg-gradient-to-br from-purple-50 to-purple-100/50 dark:border-purple-800/40 dark:from-purple-900/20 dark:to-purple-800/10">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-muted-foreground text-xs">{t("stats.last24h")}</p>
              <p className="mt-1 font-bold text-2xl">{stats.last24hExecutions}</p>
              <p className="mt-2 text-muted-foreground text-xs">{t("stats.runsTotal")}</p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-purple-100/50 dark:bg-purple-900/30">
              <TrendingUp className="h-6 w-6 text-purple-600 dark:text-purple-400" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Success Rate */}
      <Card className="border-green-200/50 bg-gradient-to-br from-green-50 to-green-100/50 dark:border-green-800/40 dark:from-green-900/20 dark:to-green-800/10">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-muted-foreground text-xs">{t("stats.successRate")}</p>
              <p className="mt-1 font-bold text-2xl">{stats.successRate}%</p>
              <p className="mt-2 text-green-600 text-xs dark:text-green-400">
                {t("stats.successCount", { success: stats.last24hSuccess, total: stats.last24hExecutions })}
              </p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-green-100/50 dark:bg-green-900/30">
              <div className="font-bold text-green-600 text-lg dark:text-green-400">✓</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Failed Runs */}
      <Card
        className={cn(
          "border-yellow-200/50 bg-gradient-to-br dark:border-yellow-800/40",
          stats.last24hFailed > 0
            ? "from-yellow-50 to-yellow-100/50 dark:from-yellow-900/20 dark:to-yellow-800/10"
            : "from-slate-50 to-slate-100/50 opacity-60 dark:from-slate-900/20 dark:to-slate-800/10",
        )}
      >
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-muted-foreground text-xs">{t("stats.failedRuns")}</p>
              <p className="mt-1 font-bold text-2xl">{stats.last24hFailed}</p>
              <p className="mt-2 text-muted-foreground text-xs">{t("stats.inLast24h")}</p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-yellow-100/50 dark:bg-yellow-900/30">
              <AlertTriangle
                className={`h-6 w-6 ${
                  stats.last24hFailed > 0 ? "text-yellow-600 dark:text-yellow-400" : "text-muted-foreground opacity-40"
                }`}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
