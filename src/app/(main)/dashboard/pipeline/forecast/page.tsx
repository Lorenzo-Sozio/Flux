import { getTranslations } from "next-intl/server";

import { getForecastData } from "@/actions/pipeline";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { parsePipelineFilters } from "@/lib/pipeline-filters";

import { ForecastBarChart, OwnerPieChart } from "./_components/forecast-charts-lazy";
import { ForecastKPI, ForecastOutside, ForecastOwnerTable } from "./_components/forecast-kpi";

export default async function ForecastPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { owners, pipeline } = parsePipelineFilters(await searchParams);
  const [data, t] = await Promise.all([getForecastData({ owners, pipeline }), getTranslations("pipeline.forecast")]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div>
          <h1 className="font-bold text-2xl tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
        </div>
      </div>

      {/* KPI row + owner table (client, uses useCurrency) */}
      <ForecastKPI
        totalWeighted={data.totalWeighted}
        bestCase={data.bestCase}
        committed={data.committed}
        currentMonthTarget={data.currentMonthTarget}
        currentMonthCommitted={data.currentMonthCommitted}
        wonThisMonth={data.wonThisMonth}
      />
      <ForecastOutside unscheduled={data.unscheduled} overdue={data.overdue} />

      {/* Monthly bar chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("monthlyChart")}</CardTitle>
        </CardHeader>
        {/* On a phone the card's side padding is a sixth of the chart's width. */}
        <CardContent className="max-sm:px-3">
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-muted-foreground text-xs">
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
          <CardContent className="max-sm:px-3">
            <OwnerPieChart byOwner={data.byOwner} currency={data.currency} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("ownerBreakdown")}</CardTitle>
          </CardHeader>
          <CardContent>
            {data.byOwner.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("noAssignedDeals")}</p>
            ) : (
              <ForecastOwnerTable byOwner={data.byOwner} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
