"use client";

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
  const data = months.map((m) => ({
    label: m.label,
    Committed: Math.round(m.committed),
    "Best Case": Math.round(m.bestCase),
    Pipeline: Math.round(m.pipeline),
    Target: Math.round(m.target),
  }));

  const hasTargets = months.some((m) => m.target > 0);

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 4, right: 16, left: 16, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => fmt(v, currency)}
          width={80}
        />
        <Tooltip formatter={(value: number) => fmt(value, currency)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
        <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="Pipeline" fill="#bfdbfe" radius={[3, 3, 0, 0]} />
        <Bar dataKey="Best Case" fill="#60a5fa" radius={[3, 3, 0, 0]} />
        <Bar dataKey="Committed" fill="#2563eb" radius={[3, 3, 0, 0]} />
        {hasTargets && <Bar dataKey="Target" fill="#a855f7" fillOpacity={0.35} radius={[3, 3, 0, 0]} />}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function OwnerPieChart({ byOwner, currency }: { byOwner: OwnerBucket[]; currency: string }) {
  if (byOwner.length === 0) return <p className="text-sm text-muted-foreground text-center py-8">No data</p>;

  const data = byOwner.map((o) => ({ name: o.name, value: Math.round(o.weighted) }));

  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          outerRadius={90}
          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
          labelLine={false}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={OWNER_COLORS[i % OWNER_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(v: number) => fmt(v, currency)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
