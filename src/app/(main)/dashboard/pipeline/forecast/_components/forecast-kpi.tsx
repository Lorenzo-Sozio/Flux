"use client";

import Link from "next/link";

import { CheckCircle2, DollarSign, Target, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCurrency } from "@/hooks/use-currency";

interface ForecastData {
  totalWeighted: number;
  bestCase: number;
  committed: number;
  currentMonthTarget: number;
  byOwner: { name: string; dealCount: number; weighted: number }[];
}

export function ForecastKPI({ totalWeighted, bestCase, committed, currentMonthTarget }: Omit<ForecastData, "byOwner">) {
  const t = useTranslations("pipeline.forecast");
  const { formatAmount } = useCurrency();

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <DollarSign className="h-4 w-4 text-blue-500" /> {t("totalPipeline")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatAmount(totalWeighted, { noDecimals: true })}</div>
          <p className="text-xs text-muted-foreground mt-1">{t("totalPipelineDesc")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <TrendingUp className="h-4 w-4 text-sky-500" /> {t("bestCase")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatAmount(bestCase, { noDecimals: true })}</div>
          <p className="text-xs text-muted-foreground mt-1">{t("bestCaseDesc")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Target className="h-4 w-4 text-green-500" /> {t("committed")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-green-600">{formatAmount(committed, { noDecimals: true })}</div>
          <p className="text-xs text-muted-foreground mt-1">{t("committedDesc")}</p>
        </CardContent>
      </Card>

      {currentMonthTarget > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-purple-500" /> {t("vsTarget")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${committed >= currentMonthTarget ? "text-green-600" : "text-amber-600"}`}
            >
              {Math.round((committed / currentMonthTarget) * 100)}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {t("vsTargetDesc", { amount: formatAmount(currentMonthTarget, { noDecimals: true }) })}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-dashed">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-muted-foreground/40" /> {t("vsTarget")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {t("noTarget")}{" "}
              <Link href="/dashboard/settings/targets" className="underline hover:text-foreground">
                {t("setTargets")}
              </Link>
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function ForecastOwnerTable({ byOwner }: { byOwner: ForecastData["byOwner"] }) {
  const t = useTranslations("pipeline.forecast");
  const { formatAmount } = useCurrency();

  if (byOwner.length === 0) return null;

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-xs text-muted-foreground uppercase tracking-wider">
          <th className="pb-2 text-left font-medium">{t("colOwner")}</th>
          <th className="pb-2 text-right font-medium">{t("colDeals")}</th>
          <th className="pb-2 text-right font-medium">{t("colWeightedValue")}</th>
        </tr>
      </thead>
      <tbody>
        {byOwner.map((o, i) => (
          <tr key={i} className="border-b last:border-0">
            <td className="py-2.5 font-medium">{o.name}</td>
            <td className="py-2.5 text-right text-muted-foreground">{o.dealCount}</td>
            <td className="py-2.5 text-right font-semibold tabular-nums">
              {formatAmount(o.weighted, { noDecimals: true })}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
