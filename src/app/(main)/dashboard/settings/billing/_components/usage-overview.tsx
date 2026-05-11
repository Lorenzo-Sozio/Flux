"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { BarChart3 } from "lucide-react";

interface UsageMetric {
  current: number;
  limit: number | null;
  percent: number | null;
}

interface UsageOverviewProps {
  usage: Record<string, UsageMetric>;
}

const METRIC_LABELS: Record<string, string> = {
  api_calls: "API Calls",
  storage_mb: "Storage",
  automation_runs: "Automation Runs",
  active_users: "Active Users",
};

function formatValue(metric: string, value: number): string {
  if (metric === "storage_mb") {
    return value >= 1024
      ? `${(value / 1024).toFixed(1)} GB`
      : `${value} MB`;
  }
  return new Intl.NumberFormat("en").format(value);
}

function formatLimit(metric: string, limit: number | null): string {
  if (limit === null) return "Unlimited";
  return formatValue(metric, limit);
}

function progressColor(percent: number | null): string {
  if (percent === null) return "";
  if (percent >= 100) return "[&>div]:bg-destructive";
  if (percent >= 90) return "[&>div]:bg-orange-500";
  if (percent >= 80) return "[&>div]:bg-yellow-500";
  return "";
}

export function UsageOverview({ usage }: UsageOverviewProps) {
  const entries = Object.entries(usage).filter(([key]) => METRIC_LABELS[key]);

  if (entries.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            Usage
          </CardTitle>
          <CardDescription>No usage data for this billing period yet.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          Usage This Period
        </CardTitle>
        <CardDescription>Resets at the start of each billing period.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {entries.map(([key, data]) => (
          <div key={key} className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{METRIC_LABELS[key] ?? key}</span>
              <span className="text-muted-foreground">
                {formatValue(key, data.current)} / {formatLimit(key, data.limit)}
                {data.percent !== null && (
                  <span className="ml-1 text-xs">({data.percent}%)</span>
                )}
              </span>
            </div>
            {data.limit !== null && (
              <Progress
                value={Math.min(data.percent ?? 0, 100)}
                className={`h-2 ${progressColor(data.percent)}`}
              />
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
