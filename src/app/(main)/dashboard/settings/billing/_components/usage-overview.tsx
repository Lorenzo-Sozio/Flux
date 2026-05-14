"use client";

import { BarChart3 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { PlanLimits } from "@/lib/billing/plans-config";

interface UsageMetric {
  current: number;
  limit: number | null;
  percent: number | null;
}

interface UsageOverviewProps {
  usage: Record<string, UsageMetric>;
  limits?: PlanLimits;
}

const METRIC_ORDER = [
  "maxUsers",
  "maxRecords",
  "apiCallsPerMonth",
  "automationRunsPerMonth",
  "storageGb",
  "maxIntegrations",
];

function formatValue(metric: string, value: number): string {
  if (metric === "storageGb") return `${value} GB`;
  return new Intl.NumberFormat("it-IT").format(value);
}

function progressColor(percent: number | null): string {
  if (percent === null) return "";
  if (percent >= 100) return "[&>div]:bg-destructive";
  if (percent >= 90) return "[&>div]:bg-orange-500";
  if (percent >= 80) return "[&>div]:bg-yellow-500";
  return "";
}

export function UsageOverview({ usage, limits }: UsageOverviewProps) {
  const t = useTranslations("settings.billing");

  const merged: Record<string, UsageMetric> = {};

  if (limits) {
    for (const key of METRIC_ORDER) {
      const planLimit = limits[key as keyof PlanLimits] as number | null;
      const tracked = usage[key];
      if (tracked) {
        merged[key] = tracked;
      } else {
        merged[key] = {
          current: 0,
          limit: planLimit ?? null,
          percent: planLimit !== null && planLimit > 0 ? 0 : null,
        };
      }
    }
  } else {
    for (const key of METRIC_ORDER) {
      if (usage[key]) merged[key] = usage[key];
    }
  }

  const entries = Object.entries(merged);

  if (entries.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            {t("usage.title")}
          </CardTitle>
          <CardDescription>{t("usage.noData")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          {t("usage.titlePeriod")}
        </CardTitle>
        <CardDescription>{t("usage.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {entries.map(([key, data]) => (
          <div key={key} className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">
                {t(`usage.metrics.${key}` as Parameters<typeof t>[0], { fallback: key })}
              </span>
              <span className="text-muted-foreground">
                {formatValue(key, data.current)}
                <span className="mx-1">/</span>
                {data.limit === null ? t("usage.unlimited") : formatValue(key, data.limit)}
                {data.percent !== null && <span className="ml-1.5 text-xs">({data.percent}%)</span>}
              </span>
            </div>
            {data.limit !== null ? (
              <Progress value={Math.min(data.percent ?? 0, 100)} className={`h-2 ${progressColor(data.percent)}`} />
            ) : (
              <div className="h-2 rounded-full bg-muted" />
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
