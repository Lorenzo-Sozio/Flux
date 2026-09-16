import { Clock, Percent, TrendingUp, Users } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { getFunnelData } from "@/actions/analytics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { parsePipelineFilters, pipelineView } from "@/lib/pipeline-filters";

import { FunnelChart } from "./_components/funnel-chart";

export default async function FunnelPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { owners, period } = parsePipelineFilters(await searchParams, {
    period: pipelineView("funnel").defaultPeriod,
  });
  const [data, t, format] = await Promise.all([
    getFunnelData(period, owners),
    getTranslations("analytics.funnel"),
    getFormatter(),
  ]);
  const stageName = (key: string) => t(`stages.${key}` as never);
  const stages = data.stages.map((s) => ({ label: stageName(s.key), count: s.count, fill: s.fill }));
  const conversionRates = data.conversionRates.map((cr) => ({
    from: stageName(cr.from),
    to: stageName(cr.to),
    rate: cr.rate,
  }));

  const overallRate =
    data.totals.totalLeads > 0 ? Number(((data.totals.totalWon / data.totals.totalLeads) * 100).toFixed(2)) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="font-bold text-2xl tracking-tight">{t("title")}</h1>
            <p className="text-muted-foreground text-sm">{t("subtitle", { days: data.periodDays })}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 font-medium text-muted-foreground text-sm">
              <Users className="h-4 w-4 text-indigo-500" /> {t("totalLeads")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl">{format.number(data.totals.totalLeads)}</div>
            <p className="mt-1 text-muted-foreground text-xs">{t("totalLeadsDesc")}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 font-medium text-muted-foreground text-sm">
              <TrendingUp className="h-4 w-4 text-green-500" /> {t("won")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl">{format.number(data.totals.totalWon)}</div>
            <p className="mt-1 text-muted-foreground text-xs">{t("wonDesc")}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 font-medium text-muted-foreground text-sm">
              <Percent className="h-4 w-4 text-blue-500" /> {t("overallRate")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl">
              {format.number(overallRate / 100, { style: "percent", maximumFractionDigits: 2 })}
            </div>
            <p className="mt-1 text-muted-foreground text-xs">{t("overallRateDesc")}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 font-medium text-muted-foreground text-sm">
              <Clock className="h-4 w-4 text-amber-500" /> {t("avgCycle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl">{t("daysShort", { days: data.avgDealCycleDays })}</div>
            <p className="mt-1 text-muted-foreground text-xs">{t("avgCycleDesc")}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">{t("conversionFunnel")}</CardTitle>
          </CardHeader>
          <CardContent>
            <FunnelChart stages={stages} conversionRates={conversionRates} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("stageRates")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {conversionRates.map((cr) => (
              <div key={`${cr.from}-${cr.to}`}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-muted-foreground text-sm">
                    {cr.from} → {cr.to}
                  </span>
                  <span
                    className={`font-bold text-sm ${
                      cr.rate >= 50 ? "text-green-600" : cr.rate >= 20 ? "text-amber-600" : "text-red-500"
                    }`}
                  >
                    {cr.rate}%
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(cr.rate, 100)}%`,
                      backgroundColor: cr.rate >= 50 ? "#22c55e" : cr.rate >= 20 ? "#f59e0b" : "#ef4444",
                    }}
                  />
                </div>
              </div>
            ))}

            <div className="space-y-2 border-t pt-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("avgLeadConversion")}</span>
                <span className="font-medium">{t("daysShort", { days: data.avgLeadConversionDays })}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("avgDealCycle")}</span>
                <span className="font-medium">{t("daysShort", { days: data.avgDealCycleDays })}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {data.sourceBreakdown.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("leadsBySource")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {data.sourceBreakdown.map((s) => {
                const pct = data.totals.totalLeads > 0 ? Math.round((s.count / data.totals.totalLeads) * 100) : 0;
                return (
                  <div key={s.source ?? "unknown"} className="rounded-lg border p-3 text-center">
                    <div className="font-bold text-lg">{format.number(s.count)}</div>
                    <div className="text-muted-foreground text-xs capitalize">{s.source ?? t("unknownSource")}</div>
                    <div className="font-medium text-primary text-xs">{pct}%</div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
