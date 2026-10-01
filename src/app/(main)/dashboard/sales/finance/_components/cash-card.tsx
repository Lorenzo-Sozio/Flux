"use client";

import type { ReactNode } from "react";

import Link from "next/link";

import { Banknote, Clock, HandCoins, Percent, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { useCurrency } from "@/hooks/use-currency";
import type { CashStats, CurrencyAmount } from "@/lib/cash-stats";

/**
 * The cash side of Finance (I14). Every figure carries its definition under it, in the words of
 * src/lib/cash-stats.ts: a number the reader cannot check is a number they cannot use.
 */
export function CashCard({ stats }: { stats: CashStats }) {
  const t = useTranslations("finance.cash");
  const { formatMoney } = useCurrency();
  const list = (amounts: CurrencyAmount[]) =>
    amounts.length === 0 ? formatMoney(0, "EUR") : amounts.map((a) => formatMoney(a.amount, a.currency)).join(" · ");

  // The chart and the ratios are in one currency: the euro when it is there, else the first.
  const currencies = [...new Set([...stats.collected, ...stats.invoiced].map((s) => s.currency))];
  const main = currencies.sort((a, b) => Number(b === "EUR") - Number(a === "EUR") || a.localeCompare(b))[0] ?? "EUR";
  const collected = stats.collected.find((s) => s.currency === main)?.values ?? stats.months.map(() => 0);
  const invoiced = stats.invoiced.find((s) => s.currency === main)?.values ?? stats.months.map(() => 0);
  const data = stats.months.map((month, i) => {
    const [y, m] = month.split("-");
    return {
      label: new Date(Number(y), Number(m) - 1, 1).toLocaleString(undefined, { month: "short" }),
      collected: collected[i],
      invoiced: invoiced[i],
    };
  });
  const chartConfig = {
    collected: { label: t("collectedLabel"), color: "var(--chart-1)" },
    invoiced: { label: t("invoicedLabel"), color: "var(--chart-2)" },
  } as ChartConfig;

  const dso = stats.dso.find((d) => d.currency === main) ?? null;
  const rate = stats.collectionRate.find((r) => r.currency === main) ?? null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t("title")}</CardTitle>
        <CardDescription>{t("subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Figure
            icon={<Banknote className="size-4 text-blue-600" aria-hidden />}
            label={t("collected")}
            value={list(stats.collectedThisMonth)}
            sub={t("lastMonth", { amount: list(stats.collectedLastMonth) })}
            definition={t("collectedDef")}
          />
          <Figure
            icon={<Clock className="size-4 text-amber-600" aria-hidden />}
            label={t("dso")}
            value={dso?.days != null ? t("dsoValue", { days: dso.days }) : "—"}
            sub={
              dso?.days == null ? t("dsoNone") : currencies.length > 1 ? t("inCurrency", { currency: main }) : undefined
            }
            definition={t("dsoDef")}
          />
          <Figure
            icon={<Percent className="size-4 text-emerald-600" aria-hidden />}
            label={t("rate")}
            value={rate?.rate != null ? `${Math.round(rate.rate * 1000) / 10}%` : "—"}
            sub={
              rate?.rate != null
                ? t("rateOf", { paid: formatMoney(rate.paid, main), asked: formatMoney(rate.asked, main) })
                : t("rateNone")
            }
            note={rate?.rate != null && currencies.length > 1 ? t("inCurrency", { currency: main }) : undefined}
            definition={t("rateDef")}
          />
          <Figure
            icon={<HandCoins className="size-4 text-violet-600" aria-hidden />}
            label={t("deposits")}
            value={list(stats.depositsToInvoice.total)}
            definition={t("depositsDef")}
          />
          <Figure
            icon={<Wallet className="size-4 text-slate-600" aria-hidden />}
            label={t("credit")}
            value={list(stats.customersCredit)}
            definition={t("creditDef")}
          />
        </div>

        <div>
          <p className="font-medium text-sm">{t("chartTitle")}</p>
          <p className="text-muted-foreground text-xs">{t("chartDesc")}</p>
          {currencies.length > 1 && (
            <p className="text-muted-foreground text-xs">{t("otherCurrencies", { currency: main })}</p>
          )}
          {data.every((d) => d.collected === 0 && d.invoiced === 0) ? (
            <p className="mt-3 rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm">
              {t("chartEmpty")}
            </p>
          ) : (
            <ChartContainer config={chartConfig} className="mt-3 h-56 w-full">
              <BarChart data={data} margin={{ left: 0, right: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={64}
                  tickFormatter={(v: number) => formatMoney(v, main).replace(/,00(?=\D*$)/, "")}
                />
                <ChartTooltip content={<ChartTooltipContent formatter={(v) => formatMoney(Number(v), main)} />} />
                <Bar dataKey="collected" fill="var(--color-collected)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="invoiced" fill="var(--color-invoiced)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ChartContainer>
          )}
        </div>

        {stats.depositsToInvoice.orders.length > 0 && (
          <div>
            <p className="mb-2 font-medium text-sm">{t("depositsList")}</p>
            <ul className="divide-y rounded-md border text-sm">
              {stats.depositsToInvoice.orders.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <Link href={`/dashboard/sales/orders/${o.id}`} className="min-w-0 truncate hover:underline">
                    {o.orderNumber}
                    {o.companyName && <span className="text-muted-foreground"> · {o.companyName}</span>}
                  </Link>
                  <span className="shrink-0 tabular-nums">{formatMoney(o.amount, o.currency)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Money that arrived and paid nothing yet: each customer's page uses it on an invoice or refunds it. */}
        {stats.creditCustomers.length > 0 && (
          <div>
            <p className="mb-2 font-medium text-sm">{t("creditList")}</p>
            <ul className="divide-y rounded-md border text-sm">
              {stats.creditCustomers.map((c) => (
                <li key={`${c.id}-${c.currency}`} className="flex items-center justify-between gap-3 px-3 py-2">
                  <Link href={`/dashboard/companies/${c.id}`} className="min-w-0 truncate hover:underline">
                    {c.name ?? "—"}
                  </Link>
                  <span className="shrink-0 text-emerald-700 tabular-nums dark:text-emerald-400">
                    {formatMoney(c.amount, c.currency)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Figure({
  icon,
  label,
  value,
  sub,
  note,
  definition,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub?: string;
  /** Which currency the figure is in, when the workspace has more than one. */
  note?: string;
  definition: string;
}) {
  return (
    <div className="flex flex-col rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 font-medium text-muted-foreground text-xs">{label}</p>
        {icon}
      </div>
      <p className="mt-1 break-words font-bold text-xl tabular-nums">{value}</p>
      {sub && <p className="text-muted-foreground text-xs">{sub}</p>}
      {note && <p className="text-muted-foreground text-xs">{note}</p>}
      <p className="mt-2 border-t pt-2 text-[11px] text-muted-foreground leading-snug">{definition}</p>
    </div>
  );
}

// The error card lives in ./cash-error.tsx: the company page shows it, and importing it from here
// carried the chart library into every company page.
export { CashError } from "./cash-error";
