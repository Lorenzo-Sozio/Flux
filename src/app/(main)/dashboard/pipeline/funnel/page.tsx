import { Clock, Percent, TrendingUp, Users } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { getFunnelData } from "@/actions/analytics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { FunnelChart, PeriodSelector } from "./_components/funnel-chart";

export default async function FunnelPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const { period } = await searchParams;
  const periodDays = Number(period ?? 90);
  const data = await getFunnelData(Number.isFinite(periodDays) && periodDays > 0 ? periodDays : 90);
  const t = await getTranslations("analytics.funnel");

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
        <PeriodSelector current={data.periodDays} base="/dashboard/pipeline/funnel" />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 font-medium text-muted-foreground text-sm">
              <Users className="h-4 w-4 text-indigo-500" /> {t("totalLeads")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl">{data.totals.totalLeads.toLocaleString()}</div>
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
            <div className="font-bold text-2xl">{data.totals.totalWon.toLocaleString()}</div>
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
            <div className="font-bold text-2xl">{overallRate}%</div>
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
            <div className="font-bold text-2xl">{data.avgDealCycleDays}d</div>
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
            <FunnelChart stages={data.stages} conversionRates={data.conversionRates} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("stageRates")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.conversionRates.map((cr) => (
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
                <span className="font-medium">{data.avgLeadConversionDays}d</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("avgDealCycle")}</span>
                <span className="font-medium">{data.avgDealCycleDays}d</span>
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
                  <div key={s.source} className="rounded-lg border p-3 text-center">
                    <div className="font-bold text-lg">{s.count}</div>
                    <div className="text-muted-foreground text-xs capitalize">{s.source}</div>
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
