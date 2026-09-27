"use client";

import { useTranslations } from "next-intl";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useIsMobile } from "@/hooks/use-mobile";

const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#8884d8"];

interface Props {
  dealDistribution: any[];
  leadsBySource: any[];
}

export default function CRMCharts({ dealDistribution, leadsBySource }: Props) {
  const t = useTranslations("crm");
  // ⚠️ On a phone the desktop margins took some 50px of a 300px card, stage
  // names ran into each other on the axis, and the pie's outside labels were
  // clipped at both edges. The phone gets tighter margins, shortened stage
  // names (the tooltip keeps the full one) and a legend instead of labels.
  const isMobile = useIsMobile();
  const shorten = (name: string) => (isMobile && name.length > 8 ? `${name.slice(0, 7)}…` : name);
  return (
    <div className="grid grid-cols-1 gap-6 md:gap-8 lg:grid-cols-2">
      {/* Pipeline Chart */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>{t("dealsByStage")}</CardTitle>
          <CardDescription>{t("dealsByStageDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="h-[240px] sm:h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={dealDistribution}
              margin={
                isMobile ? { top: 12, right: 8, left: -16, bottom: 0 } : { top: 20, right: 30, left: 20, bottom: 5 }
              }
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
              <XAxis
                dataKey="name"
                axisLine={false}
                tickLine={false}
                style={{ fontSize: isMobile ? "10px" : "12px" }}
                tickFormatter={shorten}
                interval={isMobile ? 0 : "preserveEnd"}
              />
              <YAxis axisLine={false} tickLine={false} style={{ fontSize: isMobile ? "10px" : "12px" }} />
              <Tooltip
                cursor={{ fill: "#f3f4f6" }}
                contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }}
              />
              <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Lead Source Chart */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>{t("leadsBySource")}</CardTitle>
          <CardDescription>{t("leadsBySourceDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="flex h-[240px] flex-col justify-center sm:h-[300px]">
          {!leadsBySource || leadsBySource.length === 0 ? (
            <p className="text-center text-muted-foreground italic">{t("noLeadSourceData")}</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={leadsBySource}
                  cx="50%"
                  cy="50%"
                  innerRadius={isMobile ? 45 : 60}
                  outerRadius={isMobile ? 75 : 100}
                  paddingAngle={5}
                  dataKey="value"
                  label={
                    isMobile
                      ? false
                      : (entry: any) =>
                          `${entry.name} ${(((entry.value || 0) / (leadsBySource.reduce((s, e) => s + (e.value || 0), 0) || 1)) * 100).toFixed(0)}%`
                  }
                >
                  {leadsBySource.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={isMobile ? { fontSize: 11 } : undefined} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
