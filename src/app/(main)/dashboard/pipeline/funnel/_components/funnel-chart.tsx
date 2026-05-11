"use client";

import Link from "next/link";

import { useTranslations } from "next-intl";

type Stage = {
  label: string;
  count: number;
  fill: string;
};

type ConversionRate = {
  from: string;
  to: string;
  rate: number;
};

export function FunnelChart({ stages, conversionRates }: { stages: Stage[]; conversionRates: ConversionRate[] }) {
  const maxCount = Math.max(...stages.map((s) => s.count), 1);

  return (
    <div className="space-y-1">
      {stages.map((stage, i) => {
        const widthPct = Math.max((stage.count / maxCount) * 100, stage.count > 0 ? 4 : 1);
        const cr = conversionRates[i - 1];
        return (
          <div key={stage.label}>
            {i > 0 && cr && (
              <div className="flex items-center gap-2 py-0.5 pl-4">
                <span className="text-muted-foreground text-xs">↓</span>
                <span
                  className={`text-xs font-medium ${cr.rate >= 50 ? "text-green-600" : cr.rate >= 20 ? "text-amber-600" : "text-red-500"}`}
                >
                  {cr.rate > 100 ? ">100" : cr.rate}% conversion ({cr.from} → {cr.to})
                </span>
              </div>
            )}
            <div className="relative h-12 overflow-hidden rounded-lg bg-muted/30">
              <div
                className="absolute inset-y-0 left-0 flex items-center rounded-lg px-3 transition-all duration-500"
                style={{ width: `${widthPct}%`, backgroundColor: stage.fill }}
              />
              <div className="absolute inset-y-0 left-0 flex items-center px-3">
                <span className="text-sm font-semibold text-white drop-shadow">{stage.label}</span>
              </div>
              <div className="absolute inset-y-0 right-4 flex items-center">
                <span className="font-bold tabular-nums text-sm">{stage.count.toLocaleString()}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function PeriodSelector({ current, base }: { current: number; base: string }) {
  const t = useTranslations("analytics.funnel");
  const options = [
    { value: 30 },
    { value: 90 },
    { value: 180 },
    { value: 365 },
  ];

  return (
    <div className="flex gap-1 rounded-lg border p-1">
      {options.map((opt) => (
        <Link
          key={opt.value}
          href={`${base}?period=${opt.value}`}
          className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
            current === opt.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          {t("daysLabel", { count: opt.value })}
        </Link>
      ))}
    </div>
  );
}
