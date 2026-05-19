"use client";

import { useTranslations } from "next-intl";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { useCurrency } from "@/hooks/use-currency";

interface Props {
  revenueTrend: { month: string; deals: number; orders: number }[];
}

export function CashFlowOverview({ revenueTrend }: Props) {
  const t = useTranslations("finance");
  const { formatAmount } = useCurrency();

  const chartConfig = {
    deals: {
      label: t("dealsWonLabel"),
      color: "var(--chart-1)",
    },
    orders: {
      label: t("ordersLabel"),
      color: "var(--chart-2)",
    },
  } as ChartConfig;

  const totalDeals = revenueTrend.reduce((acc, item) => acc + item.deals, 0);
  const totalOrders = revenueTrend.reduce((acc, item) => acc + item.orders, 0);

  const chartData = revenueTrend.map((item) => {
    const [year, month] = item.month.split("-");
    const label = new Date(Number(year), Number(month) - 1, 1).toLocaleString(undefined, { month: "short" });
    return { ...item, label };
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-base">{t("revenueTrend")}</CardTitle>
          <CardDescription className="text-xs mt-0.5">{t("revenueTrendDesc")}</CardDescription>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-sm" style={{ background: "var(--chart-1)" }} />
            <span className="text-muted-foreground text-xs">{t("dealsLabel")}</span>
            <span className="font-medium text-xs tabular-nums">{formatAmount(totalDeals, { noDecimals: true })}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-sm" style={{ background: "var(--chart-2)" }} />
            <span className="text-muted-foreground text-xs">{t("ordersLabel")}</span>
            <span className="font-medium text-xs tabular-nums">{formatAmount(totalOrders, { noDecimals: true })}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <ChartContainer className="max-h-64 w-full" config={chartConfig}>
          <BarChart margin={{ left: -25, right: 0, top: 10, bottom: 0 }} accessibilityLayer data={chartData}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} tickMargin={8} axisLine={false} className="text-xs" />
            <YAxis
              axisLine={false}
              tickLine={false}
              tickMargin={8}
              tickFormatter={(value) => (value >= 1000 ? `${(value / 1000).toFixed(0)}k` : `${value}`)}
              className="text-xs"
            />
            <ChartTooltip content={<ChartTooltipContent hideLabel={false} />} />
            <Bar dataKey="deals" stackId="a" fill={chartConfig.deals.color as string} radius={[0, 0, 0, 0]} />
            <Bar dataKey="orders" stackId="a" fill={chartConfig.orders.color as string} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
