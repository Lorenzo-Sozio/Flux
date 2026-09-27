import type { LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface MetricCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  description?: string;
  trend?: "up" | "down" | "neutral";
  className?: string;
}

export function MetricCard({
  icon: Icon,
  label,
  value,
  description,
  trend = "neutral",
  className = "",
}: MetricCardProps) {
  const t = useTranslations("metricCard");
  return (
    <Card className={className}>
      {/* Tighter below `sm`, where these sit two to a row with ~120px of content each. */}
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 px-4 pb-2 sm:px-6">
        <CardTitle className="min-w-0 text-sm font-medium text-gray-600 dark:text-gray-400">{label}</CardTitle>
        <Icon className="h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400" />
      </CardHeader>
      <CardContent className="px-4 sm:px-6">
        <div className="break-words text-xl font-bold tabular-nums sm:text-2xl">{value}</div>
        {description && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{description}</p>}
        {trend !== "neutral" && (
          <div className={`text-xs font-medium mt-2 ${trend === "up" ? "text-green-600" : "text-red-600"}`}>
            {trend === "up" ? "↑" : "↓"} {t("vsLastMonth")}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
