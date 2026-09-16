"use client";

import { useFormatter, useTranslations } from "next-intl";

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
  const t = useTranslations("analytics.funnel");
  const format = useFormatter();
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
                  {t("conversionStep", { rate: cr.rate > 100 ? ">100" : cr.rate, from: cr.from, to: cr.to })}
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
                <span className="font-bold tabular-nums text-sm">{format.number(stage.count)}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
