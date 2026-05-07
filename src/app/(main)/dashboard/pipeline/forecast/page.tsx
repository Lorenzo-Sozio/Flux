import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { ArrowLeft, CheckCircle2, DollarSign, Target, TrendingUp } from "lucide-react";

import { getForecastData } from "@/actions/pipeline";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { ForecastBarChart, OwnerPieChart } from "./_components/forecast-charts";

export default async function ForecastPage() {
  const [data, t] = await Promise.all([getForecastData(), getTranslations("pipeline.forecast")]);

  const fmt = (n: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: data.currency,
      maximumFractionDigits: 0,
    }).format(n);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard/pipeline">
            <ArrowLeft className="mr-2 h-4 w-4" /> Pipeline
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <DollarSign className="h-4 w-4 text-blue-500" /> {t("totalPipeline")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fmt(data.totalWeighted)}</div>
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
            <div className="text-2xl font-bold">{fmt(data.bestCase)}</div>
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
            <div className="text-2xl font-bold text-green-600">{fmt(data.committed)}</div>
            <p className="text-xs text-muted-foreground mt-1">{t("committedDesc")}</p>
          </CardContent>
        </Card>

        {data.currentMonthTarget > 0 ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-purple-500" /> {t("vsTarget")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${data.committed >= data.currentMonthTarget ? "text-green-600" : "text-amber-600"}`}>
                {Math.round((data.committed / data.currentMonthTarget) * 100)}%
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {t("vsTargetDesc", { amount: fmt(data.currentMonthTarget) })}
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

      {/* Monthly bar chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("monthlyChart")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-[#bfdbfe]" /> {t("legendAll")}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-[#60a5fa]" /> {t("legendBestCase")}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-[#2563eb]" /> {t("legendCommitted")}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-[#a855f7]" /> {t("legendTarget")}
            </span>
          </div>
          <ForecastBarChart months={data.months} currency={data.currency} />
        </CardContent>
      </Card>

      {/* Owner breakdown */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("pipelineByOwner")}</CardTitle>
          </CardHeader>
          <CardContent>
            <OwnerPieChart byOwner={data.byOwner} currency={data.currency} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("ownerBreakdown")}</CardTitle>
          </CardHeader>
          <CardContent>
            {data.byOwner.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noAssignedDeals")}</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground uppercase tracking-wider">
                    <th className="pb-2 text-left font-medium">{t("colOwner")}</th>
                    <th className="pb-2 text-right font-medium">{t("colDeals")}</th>
                    <th className="pb-2 text-right font-medium">{t("colWeightedValue")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byOwner.map((o, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2.5 font-medium">{o.name}</td>
                      <td className="py-2.5 text-right text-muted-foreground">{o.dealCount}</td>
                      <td className="py-2.5 text-right font-semibold tabular-nums">{fmt(o.weighted)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
