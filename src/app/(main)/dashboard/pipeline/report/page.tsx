import Link from "next/link";

import { ArrowLeft, Clock, DollarSign, Target, TrendingUp } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { getPipelineReport } from "@/actions/pipeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { PipelineReportCharts } from "./_components/pipeline-report-charts";

export default async function PipelineReportPage() {
  const report = await getPipelineReport();
  const t = await getTranslations("pipeline");

  const fmt = (n: number) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard/pipeline">
            <ArrowLeft className="mr-2 h-4 w-4" /> {t("backToPipeline")}
          </Link>
        </Button>
        <div>
          <h1 className="font-bold text-2xl tracking-tight">{t("report")}</h1>
          <p className="text-muted-foreground text-sm">{t("reportSubtitle")}</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 font-medium text-muted-foreground text-sm">
              <DollarSign className="h-4 w-4 text-green-500" /> {t("pipelineValue")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl">{fmt(report.totalPipeline)}</div>
            <p className="mt-1 text-muted-foreground text-xs">{t("openDeals", { count: report.openCount })}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 font-medium text-muted-foreground text-sm">
              <TrendingUp className="h-4 w-4 text-blue-500" /> {t("revenueWon")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl">{fmt(report.totalWonValue)}</div>
            <p className="mt-1 text-muted-foreground text-xs">{t("dealsClosed", { count: report.wonCount })}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 font-medium text-muted-foreground text-sm">
              <Target className="h-4 w-4 text-orange-500" /> {t("winRate")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl">{report.winRate}%</div>
            <p className="mt-1 text-muted-foreground text-xs">
              {t("lostWon", { lost: report.lostCount, won: report.wonCount })}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 font-medium text-muted-foreground text-sm">
              <DollarSign className="h-4 w-4 text-purple-500" /> {t("weightedForecast")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl">{fmt(report.stageReport.reduce((s, r) => s + r.weightedValue, 0))}</div>
            <p className="mt-1 text-muted-foreground text-xs">{t("probabilityAdjusted")}</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <PipelineReportCharts stageReport={report.stageReport} />

      {/* Stage Table */}
      <Card>
        <CardHeader>
          <CardTitle>{t("stageBreakdown")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 font-medium">{t("columns.stage")}</th>
                  <th className="pb-2 text-right font-medium">{t("deals")}</th>
                  <th className="pb-2 text-right font-medium">{t("totalValue")}</th>
                  <th className="pb-2 text-right font-medium">{t("weightedValue")}</th>
                  <th className="pb-2 text-right font-medium">{t("avgDays")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {report.stageReport.map((stage) => (
                  <tr key={stage.id} className="py-2">
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-full" style={{ background: stage.color ?? "#94a3b8" }} />
                        {stage.name}
                      </div>
                    </td>
                    <td className="py-3 text-right">
                      <Badge variant="secondary">{stage.dealCount}</Badge>
                    </td>
                    <td className="py-3 text-right font-medium">{fmt(stage.totalValue)}</td>
                    <td className="py-3 text-right text-muted-foreground">{fmt(stage.weightedValue)}</td>
                    <td className="py-3 text-right">
                      <div className="flex items-center justify-end gap-1 text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {stage.avgDaysInStage}d
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
