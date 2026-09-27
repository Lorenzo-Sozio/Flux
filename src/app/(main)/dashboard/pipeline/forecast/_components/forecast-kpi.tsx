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
  currentMonthCommitted: number;
  wonThisMonth: number;
  byOwner: { name: string; dealCount: number; weighted: number }[];
}

export function ForecastKPI({
  totalWeighted,
  bestCase,
  committed,
  currentMonthTarget,
  currentMonthCommitted,
  wonThisMonth,
}: Omit<ForecastData, "byOwner">) {
  // This month only: won already, plus committed to close this month.
  const onCourse = wonThisMonth + currentMonthCommitted;
  const t = useTranslations("pipeline.forecast");
  const { formatAmount } = useCurrency();

  // Four across only from lg. From sm it used to be four, and a quarter of a
  // tablet cannot hold a seven-figure amount at this size: the card clips it.
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
              className={`text-2xl font-bold ${onCourse >= currentMonthTarget ? "text-green-600" : "text-amber-600"}`}
            >
              {Math.round((onCourse / currentMonthTarget) * 100)}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {t("vsTargetDesc", {
                won: formatAmount(wonThisMonth, { noDecimals: true }),
                committed: formatAmount(currentMonthCommitted, { noDecimals: true }),
                amount: formatAmount(currentMonthTarget, { noDecimals: true }),
              })}
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
              <Link href="/dashboard/pipeline/targets" className="underline hover:text-foreground">
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

  // Four money columns do not fit a phone; the table scrolls sideways inside
  // its card rather than pushing the page out of the viewport.
  return (
    <div className="overflow-x-auto">
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
    </div>
  );
}

type Outside = { count: number; weighted: number; total: number };

/**
 * The open deals the forecast leaves out, as work to do.
 *
 * ⚠️ They were computed and never shown: a deal with no close date, or with a date already
 * past, disappeared from the forecast without a trace. One needs a date, the other needs a
 * decision — and neither gets one while nobody can see it.
 */
export function ForecastOutside({ unscheduled, overdue }: { unscheduled: Outside; overdue: Outside }) {
  const t = useTranslations("pipeline.forecast");
  const { formatAmount } = useCurrency();
  if (unscheduled.count === 0 && overdue.count === 0) return null;
  return (
    <Card className="border-amber-300 dark:border-amber-800">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t("outsideTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-sm">
        {overdue.count > 0 && (
          <p>
            {t("outsideOverdue", { count: overdue.count, amount: formatAmount(overdue.total, { noDecimals: true }) })}
          </p>
        )}
        {unscheduled.count > 0 && (
          <p>
            {t("outsideUnscheduled", {
              count: unscheduled.count,
              amount: formatAmount(unscheduled.total, { noDecimals: true }),
            })}
          </p>
        )}
        <p className="text-muted-foreground text-xs">
          {t("outsideHint")}{" "}
          <Link href="/dashboard/pipeline" className="underline hover:text-foreground">
            {t("outsideOpenBoard")}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
