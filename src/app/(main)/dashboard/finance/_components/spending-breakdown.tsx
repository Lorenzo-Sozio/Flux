"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useCurrency } from "@/hooks/use-currency";

interface Props {
  revenueBreakdown: {
    dealsRevenue: number;
    quotesRevenue: number;
    ordersRevenue: number;
  };
}

export function SpendingBreakdown({ revenueBreakdown }: Props) {
  const t = useTranslations("finance");
  const { formatAmount } = useCurrency();
  const { dealsRevenue, quotesRevenue, ordersRevenue } = revenueBreakdown;

  const sources = [
    { key: "deals", label: t("dealsWonLabel"), amount: dealsRevenue },
    { key: "orders", label: t("ordersCompletedLabel"), amount: ordersRevenue },
    { key: "quotes", label: t("quotesAcceptedLabel"), amount: quotesRevenue },
  ];

  const total = sources.reduce((sum, item) => sum + item.amount, 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t("revenueSources")}</CardTitle>
        <CardDescription className="text-xs">{t("revenueSourcesDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        {total > 0 ? (
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
            {sources
              .filter((item) => item.amount > 0)
              .map((item, index) => {
                const width = (item.amount / total) * 100;
                const alpha = Math.max(0.35, 1 - index * 0.25);
                return (
                  <div
                    key={item.key}
                    className="h-full shrink-0"
                    style={{
                      width: `${width}%`,
                      background: `color-mix(in oklch, var(--primary) ${alpha * 100}%, transparent)`,
                    }}
                    title={`${item.label}: ${formatAmount(item.amount)}`}
                  />
                );
              })}
          </div>
        ) : (
          <div className="h-3 w-full rounded-full bg-muted" />
        )}

        <div className="space-y-2">
          {sources.map((item, index) => {
            const pct = total > 0 ? Math.round((item.amount / total) * 100) : 0;
            const alpha = Math.max(0.35, 1 - index * 0.25);
            return (
              <div key={item.key} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className="size-2.5 rounded-sm"
                    style={{ background: `color-mix(in oklch, var(--primary) ${alpha * 100}%, transparent)` }}
                  />
                  <span className="text-sm text-muted-foreground">{item.label}</span>
                </div>
                <div className="flex items-center gap-2 text-sm tabular-nums">
                  <span className="text-muted-foreground">{pct}%</span>
                  <span className="font-medium">{formatAmount(item.amount, { noDecimals: true })}</span>
                </div>
              </div>
            );
          })}
        </div>

        {total > 0 && (
          <div className="border-t pt-3 flex justify-between text-sm">
            <span className="text-muted-foreground">{t("total")}</span>
            <span className="font-semibold">{formatAmount(total, { noDecimals: true })}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
