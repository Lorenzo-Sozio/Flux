import type { LucideIcon } from "lucide-react";

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
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">{label}</CardTitle>
        <Icon className="h-4 w-4 text-gray-500 dark:text-gray-400" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {description && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{description}</p>}
        {trend !== "neutral" && (
          <div className={`text-xs font-medium mt-2 ${trend === "up" ? "text-green-600" : "text-red-600"}`}>
            {trend === "up" ? "↑" : "↓"} vs last month
          </div>
        )}
      </CardContent>
    </Card>
  );
}
