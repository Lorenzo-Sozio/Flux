import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { ArrowLeft, CheckCircle2, DollarSign, Target, TrendingUp } from "lucide-react";

import { getForecastData } from "@/actions/pipeline";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { ForecastBarChart, OwnerPieChart } from "./_components/forecast-charts";
import { ForecastKPI, ForecastOwnerTable } from "./_components/forecast-kpi";

export default async function ForecastPage() {
  const [data, t] = await Promise.all([getForecastData(), getTranslations("pipeline.forecast")]);

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

      {/* KPI row + owner table (client, uses useCurrency) */}
      <ForecastKPI
        totalWeighted={data.totalWeighted}
        bestCase={data.bestCase}
        committed={data.committed}
        currentMonthTarget={data.currentMonthTarget}
        byOwner={data.byOwner}
      />

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
              <ForecastOwnerTable byOwner={data.byOwner} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
