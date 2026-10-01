import { Clock, DollarSign, Gauge, Target, TrendingUp } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { getPipelineReport } from "@/actions/pipeline";
import { Money } from "@/components/crm/money";
import { RecordCards, ResponsiveRecordList } from "@/components/crm/record-cards";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { parsePipelineFilters, pipelineView } from "@/lib/pipeline-filters";

import { PipelineReportCharts } from "./_components/pipeline-report-charts-lazy";

export default async function PipelineReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { owners, period, pipeline } = parsePipelineFilters(await searchParams, {
    period: pipelineView("report").defaultPeriod,
  });
  const [report, t] = await Promise.all([getPipelineReport({ owners, period, pipeline }), getTranslations("pipeline")]);

  // Amounts are stored in EUR and shown in the workspace currency, like the
  // sibling pages; this one used to format euro in the server's own locale.
  const fmt = (n: number) => <Money value={n} />;
  const days = (n: number | null) => (n === null ? "—" : t("filters.daysShort", { days: n }));
  const pct = (n: number | null) => (n === null ? "—" : `${n}%`);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-2xl tracking-tight">{t("report")}</h1>
        <p className="text-muted-foreground text-sm">{t("reportSubtitlePeriod", { days: period })}</p>
      </div>

      {/* KPI Cards. One column on a phone: half of 360px, less the card's padding,
          is about 110px, and a pipeline value at this size is wider than that —
          the card clips it rather than wrapping it. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
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
        <Card>
          <CardHeader className="pb-2">
            <CardTitle
              className="flex items-center gap-2 font-medium text-muted-foreground text-sm"
              title={t("velocityHelp")}
            >
              <Gauge className="h-4 w-4 text-sky-500" /> {t("velocity")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl">{report.velocity === null ? "—" : fmt(report.velocity)}</div>
            <p className="mt-1 text-muted-foreground text-xs">
              {report.cycleDays === null ? t("velocityUnknown") : t("velocityPerDay", { days: report.cycleDays })}
            </p>
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
          {/* Five columns do not fit a phone; below md each stage is a card. */}
          <ResponsiveRecordList
            cards={
              <RecordCards
                items={report.stageReport.map((stage) => ({
                  id: stage.id,
                  title: (
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-3 w-3 shrink-0 rounded-full"
                        style={{ background: stage.color ?? "#94a3b8" }}
                      />
                      <span className="truncate">{stage.name}</span>
                    </span>
                  ),
                  badge: <Badge variant="secondary">{stage.dealCount}</Badge>,
                  fields: [
                    { label: t("totalValue"), value: fmt(stage.totalValue) },
                    { label: t("weightedValue"), value: fmt(stage.weightedValue) },
                    { label: t("avgDays"), value: days(stage.avgDaysInStage) },
                    { label: t("conversion"), value: pct(stage.conversion) },
                    ...(stage.stale > 0 ? [{ label: t("stale"), value: String(stage.stale) }] : []),
                  ],
                }))}
              />
            }
            table={
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-2 font-medium">{t("columns.stage")}</th>
                      <th className="pb-2 text-right font-medium">{t("deals")}</th>
                      <th className="pb-2 text-right font-medium">{t("totalValue")}</th>
                      <th className="pb-2 text-right font-medium">{t("weightedValue")}</th>
                      <th className="pb-2 text-right font-medium" title={t("avgDaysHelp")}>
                        {t("avgDays")}
                      </th>
                      <th className="pb-2 text-right font-medium" title={t("conversionHelp")}>
                        {t("conversion")}
                      </th>
                      <th className="pb-2 text-right font-medium" title={t("staleHelp")}>
                        {t("stale")}
                      </th>
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
                            {days(stage.avgDaysInStage)}
                          </div>
                        </td>
                        <td className="py-3 text-right">{pct(stage.conversion)}</td>
                        <td
                          className={stage.stale > 0 ? "py-3 text-right font-medium text-amber-600" : "py-3 text-right"}
                        >
                          {stage.closing ? "—" : stage.stale}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
