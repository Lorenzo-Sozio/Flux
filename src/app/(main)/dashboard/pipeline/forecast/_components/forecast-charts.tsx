"use client";

import { useFormatter, useTranslations } from "next-intl";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useIsMobile } from "@/hooks/use-mobile";
import { formatCurrency } from "@/lib/utils";

type MonthBucket = {
  label: string;
  committed: number;
  bestCase: number;
  pipeline: number;
  target: number;
};

type OwnerBucket = {
  name: string;
  weighted: number;
  dealCount: number;
};

const OWNER_COLORS = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0891b2"];

const fmt = (n: number, currency: string) => formatCurrency(n, { currency, maximumFractionDigits: 0 });

export function ForecastBarChart({ months, currency }: { months: MonthBucket[]; currency: string }) {
  const isMobile = useIsMobile();
  const format = useFormatter();
  const tf = useTranslations("pipeline.forecast");
  const data = months.map((m) => ({
    label: m.label,
    Committed: Math.round(m.committed),
    "Best Case": Math.round(m.bestCase),
    Pipeline: Math.round(m.pipeline),
    Target: Math.round(m.target),
  }));

  const hasTargets = months.some((m) => m.target > 0);

  // ⚠️ On a phone an 80px axis of full amounts ("1.250.000 €") and 32px of margin
  // leave the six months about 170px between them. The axis goes compact
  // ("1,3 Mln €") and narrow there, and the chart's own legend goes: the page draws
  // a translated one directly above it, and two legends were a third of the height.
  return (
    <div className="h-[240px] sm:h-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={isMobile ? { top: 4, right: 4, left: 0, bottom: 4 } : { top: 4, right: 16, left: 16, bottom: 4 }}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
          <XAxis dataKey="label" tick={{ fontSize: isMobile ? 10 : 11 }} axisLine={false} tickLine={false} />
          <YAxis
            tick={{ fontSize: isMobile ? 10 : 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) =>
              isMobile
                ? format.number(v, { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 })
                : fmt(v, currency)
            }
            width={isMobile ? 52 : 80}
          />
          <Tooltip
            formatter={(value: number) => fmt(value, currency)}
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
          />
          {!isMobile && <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} />}
          {/* `name` is what the tooltip and the legend print: the data keys are
              English identifiers and were being shown as labels. */}
          <Bar dataKey="Pipeline" name={tf("legendAll")} fill="#bfdbfe" radius={[3, 3, 0, 0]} />
          <Bar dataKey="Best Case" name={tf("legendBestCase")} fill="#60a5fa" radius={[3, 3, 0, 0]} />
          <Bar dataKey="Committed" name={tf("legendCommitted")} fill="#2563eb" radius={[3, 3, 0, 0]} />
          {hasTargets && (
            <Bar dataKey="Target" name={tf("legendTarget")} fill="#a855f7" fillOpacity={0.35} radius={[3, 3, 0, 0]} />
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function OwnerPieChart({ byOwner, currency }: { byOwner: OwnerBucket[]; currency: string }) {
  const t = useTranslations("pipeline");
  const isMobile = useIsMobile();
  if (byOwner.length === 0) return <p className="text-sm text-muted-foreground text-center py-8">{t("noData")}</p>;

  const data = byOwner.map((o) => ({ name: o.name, value: Math.round(o.weighted) }));

  // ⚠️ The labels are drawn *outside* the pie, and a phone leaves them about 50px
  // either side of it: every owner's name was cut off at the card's edge. There
  // the names move into a legend underneath, which wraps instead of clipping.
  return (
    <ResponsiveContainer width="100%" height={isMobile ? 280 : 240}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy={isMobile ? "45%" : "50%"}
          outerRadius={isMobile ? 80 : 90}
          label={isMobile ? false : ({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
          labelLine={false}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={OWNER_COLORS[i % OWNER_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(v: number) => fmt(v, currency)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
        {isMobile && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />}
      </PieChart>
    </ResponsiveContainer>
  );
}
