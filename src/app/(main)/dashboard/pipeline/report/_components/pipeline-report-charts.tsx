"use client";

import { useTranslations } from "next-intl";
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCurrency } from "@/hooks/use-currency";
import { useIsMobile } from "@/hooks/use-mobile";

type StageReport = {
  id: string;
  name: string;
  color: string | null;
  dealCount: number;
  totalValue: number;
  weightedValue: number;
  /** Days spent in the stage by the deals that left it; null until one has. */
  avgDaysInStage: number | null;
  closing?: boolean;
};

export function PipelineReportCharts({ stageReport }: { stageReport: StageReport[] }) {
  const t = useTranslations("pipeline");
  const { formatAmount } = useCurrency();
  const fmt = (v: number) => formatAmount(v, { noDecimals: true });
  const isMobile = useIsMobile();
  // ⚠️ Stage names under six bars in 300px collide, and recharts' answer is to
  // drop every other one — so on a phone half the stages had no name at all.
  // Shortened there instead; the tooltip still carries the whole name.
  const tickName = (name: string) => (isMobile && name.length > 7 ? `${name.slice(0, 6)}…` : name);

  const valueData = stageReport.map((s) => ({
    name: s.name,
    totalValue: Math.round(s.totalValue),
    weightedForecast: Math.round(s.weightedValue),
    fill: s.color ?? "#94a3b8",
  }));

  // Won and Lost are where deals end, not stages they spend time in.
  const velocityData = stageReport
    .filter((s) => !s.closing)
    .map((s) => ({
      name: s.name,
      avgDays: s.avgDaysInStage,
      deals: s.dealCount,
      fill: s.color ?? "#94a3b8",
    }));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("charts.valueByStage")}</CardTitle>
        </CardHeader>
        <CardContent className="max-sm:px-3">
          <div className="h-[220px] sm:h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={valueData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} tickFormatter={tickName} />
                <YAxis tickFormatter={(v) => `€${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="totalValue" name={t("charts.totalValue")} radius={[4, 4, 0, 0]}>
                  {valueData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} fillOpacity={0.85} />
                  ))}
                </Bar>
                <Bar
                  dataKey="weightedForecast"
                  name={t("charts.weightedForecast")}
                  fill="hsl(var(--primary))"
                  fillOpacity={0.4}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("charts.dealVelocity")}</CardTitle>
        </CardHeader>
        <CardContent className="max-sm:px-3">
          <div className="h-[220px] sm:h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={velocityData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} tickFormatter={tickName} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="avgDays" name={t("charts.avgDays")} radius={[4, 4, 0, 0]}>
                  {velocityData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} fillOpacity={0.8} />
                  ))}
                </Bar>
                <Bar dataKey="deals" name={t("charts.deals")} fill="#6366f1" fillOpacity={0.6} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
