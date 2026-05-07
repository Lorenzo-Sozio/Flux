import Link from "next/link";

import { ArrowLeft, Clock, Percent, TrendingUp, Users } from "lucide-react";

import { getFunnelData } from "@/actions/analytics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { FunnelChart, PeriodSelector } from "./_components/funnel-chart";

export default async function FunnelPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const { period } = await searchParams;
  const periodDays = Number(period ?? 90);
  const data = await getFunnelData(Number.isFinite(periodDays) && periodDays > 0 ? periodDays : 90);

  const overallRate =
    data.totals.totalLeads > 0 ? Number(((data.totals.totalWon / data.totals.totalLeads) * 100).toFixed(2)) : 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/dashboard/analytics"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" /> Analytics
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Sales Funnel</h1>
            <p className="text-sm text-muted-foreground">
              Lead-to-won conversion analysis — last {data.periodDays} days
            </p>
          </div>
        </div>
        <PeriodSelector current={data.periodDays} base="/dashboard/analytics/funnel" />
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Users className="h-4 w-4 text-indigo-500" /> Total Leads
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.totals.totalLeads.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">Entered the funnel</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <TrendingUp className="h-4 w-4 text-green-500" /> Won
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.totals.totalWon.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">Deals closed won</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Percent className="h-4 w-4 text-blue-500" /> Overall Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{overallRate}%</div>
            <p className="text-xs text-muted-foreground mt-1">Lead → Won</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Clock className="h-4 w-4 text-amber-500" /> Avg Cycle
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.avgDealCycleDays}d</div>
            <p className="text-xs text-muted-foreground mt-1">Deal creation → won</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Funnel visualization */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Conversion Funnel</CardTitle>
          </CardHeader>
          <CardContent>
            <FunnelChart stages={data.stages} conversionRates={data.conversionRates} />
          </CardContent>
        </Card>

        {/* Stage-to-stage rates */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stage Conversion Rates</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.conversionRates.map((cr) => (
              <div key={`${cr.from}-${cr.to}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-muted-foreground">
                    {cr.from} → {cr.to}
                  </span>
                  <span
                    className={`text-sm font-bold ${
                      cr.rate >= 50 ? "text-green-600" : cr.rate >= 20 ? "text-amber-600" : "text-red-500"
                    }`}
                  >
                    {cr.rate}%
                  </span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
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

            <div className="pt-3 border-t space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Avg lead conversion time</span>
                <span className="font-medium">{data.avgLeadConversionDays}d</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Avg deal cycle</span>
                <span className="font-medium">{data.avgDealCycleDays}d</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Source breakdown */}
      {data.sourceBreakdown.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Leads by Source</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {data.sourceBreakdown.map((s) => {
                const pct = data.totals.totalLeads > 0 ? Math.round((s.count / data.totals.totalLeads) * 100) : 0;
                return (
                  <div key={s.source} className="rounded-lg border p-3 text-center">
                    <div className="text-lg font-bold">{s.count}</div>
                    <div className="text-xs text-muted-foreground capitalize">{s.source}</div>
                    <div className="text-xs font-medium text-primary">{pct}%</div>
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
