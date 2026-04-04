import { getPipelineReport } from "@/actions/pipeline";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, TrendingUp, DollarSign, Target, Clock } from "lucide-react";
import Link from "next/link";
import { PipelineReportCharts } from "./_components/pipeline-report-charts";

export default async function PipelineReportPage() {
  const report = await getPipelineReport();

  const fmt = (n: number) =>
    new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard/pipeline">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Pipeline
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Pipeline Report</h1>
          <p className="text-muted-foreground text-sm">Sales funnel analysis and forecasting.</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <DollarSign className="h-4 w-4 text-green-500" /> Pipeline Value
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fmt(report.totalPipeline)}</div>
            <p className="text-xs text-muted-foreground mt-1">{report.openCount} open deals</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <TrendingUp className="h-4 w-4 text-blue-500" /> Revenue Won
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fmt(report.totalWonValue)}</div>
            <p className="text-xs text-muted-foreground mt-1">{report.wonCount} deals closed</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Target className="h-4 w-4 text-orange-500" /> Win Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{report.winRate}%</div>
            <p className="text-xs text-muted-foreground mt-1">
              {report.lostCount} lost · {report.wonCount} won
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <DollarSign className="h-4 w-4 text-purple-500" /> Weighted Forecast
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {fmt(report.stageReport.reduce((s, r) => s + r.weightedValue, 0))}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Probability-adjusted</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <PipelineReportCharts stageReport={report.stageReport} />

      {/* Stage Table */}
      <Card>
        <CardHeader>
          <CardTitle>Stage Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 font-medium">Stage</th>
                  <th className="pb-2 font-medium text-right">Deals</th>
                  <th className="pb-2 font-medium text-right">Total Value</th>
                  <th className="pb-2 font-medium text-right">Weighted</th>
                  <th className="pb-2 font-medium text-right">Avg. Days</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {report.stageReport.map((stage) => (
                  <tr key={stage.id} className="py-2">
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-3 w-3 rounded-full"
                          style={{ background: stage.color ?? "#94a3b8" }}
                        />
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
