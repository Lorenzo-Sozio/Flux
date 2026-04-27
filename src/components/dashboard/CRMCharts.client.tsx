// @ts-nocheck
'use client';

import { useTranslations } from "next-intl";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend
} from "recharts";

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];

interface Props {
  dealDistribution: any[];
  leadsBySource: any[];
}

export default function CRMCharts({ dealDistribution, leadsBySource }: Props) {
  const t = useTranslations("crm");
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* Pipeline Chart */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>{t("dealsByStage")}</CardTitle>
          <CardDescription>{t("dealsByStageDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dealDistribution} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
              <XAxis dataKey="name" axisLine={false} tickLine={false} style={{ fontSize: '12px' }} />
              <YAxis axisLine={false} tickLine={false} style={{ fontSize: '12px' }} />
              <Tooltip 
                cursor={{ fill: '#f3f4f6' }}
                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
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
        <CardContent className="h-[300px] flex flex-col justify-center">
          {(!leadsBySource || leadsBySource.length === 0) ? (
            <p className="text-center text-muted-foreground italic">{t("noLeadSourceData")}</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={leadsBySource}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={5}
                  dataKey="value"
                  label={(entry: any) => `${entry.name} ${((entry.value || 0) / (leadsBySource.reduce((s, e) => s + (e.value || 0), 0) || 1) * 100).toFixed(0)}%`}
                >
                  {leadsBySource.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
