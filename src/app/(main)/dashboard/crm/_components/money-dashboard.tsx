import Link from "next/link";

import {
  AlarmClockIcon,
  ArrowRight,
  BadgeEuroIcon,
  BanknoteIcon,
  CrownIcon,
  FilePenLineIcon,
  PackageCheckIcon,
  PercentIcon,
  ReceiptTextIcon,
  ScrollTextIcon,
  TrophyIcon,
  WalletIcon,
} from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";

import { getCommissions } from "@/actions/commissions";
import { getRecurringRevenueSummary } from "@/actions/contracts";
import { getReceivables } from "@/actions/invoices";
import { Money } from "@/components/crm/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type CurrencyAmount, moneyFigures, moneyHeadline } from "@/lib/home-dashboard-data";
import { failed, loadedValue, loadOutcome } from "@/lib/load-outcome";
import { getDb } from "@/lib/tenant-context";
import { toWallDate } from "@/lib/wall-clock";
import { getWorkspaceTimeZone } from "@/lib/workspace-time-zone";

import { HeadlineKpi, KPI_VALUE, Kpi } from "./kpi";

/** An amount in the currency it is owed in: an invoice's money is never converted. */
function formatIn(amount: number, currency: string, locale: string) {
  return new Intl.NumberFormat(locale === "it" ? "it-IT" : "en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
    useGrouping: "always",
  }).format(amount);
}

/**
 * The administrator's home: what is owed and how late, what is waiting to be invoiced,
 * and what the salespeople are owed this month. Every figure opens the list it counts.
 *
 * ⚠️ Money from invoices stays in its own currency and is never summed across two:
 * a total of euros and dollars is a number that means nothing (CLAUDE.md, documents).
 */
export async function MoneyDashboard() {
  const t = await getTranslations("crm.dashboards.money");
  const locale = await getLocale();
  const [db, timeZone] = await Promise.all([getDb(), getWorkspaceTimeZone()]);
  const now = new Date();
  const thisMonth = toWallDate(now, timeZone).slice(0, 7);
  // ⚠️ A figure that did not load says so; it is never shown as zero (I14). "€ 0 overdue" from a
  // database that did not answer read as good news.
  const [headlineO, receivablesO, figuresO, commissionsO, recurringO] = await Promise.all([
    loadOutcome("home money headline", () => moneyHeadline(db, now, timeZone)),
    loadOutcome("home receivables", () => getReceivables()),
    loadOutcome("home money figures", () => moneyFigures(db)),
    loadOutcome("home commissions", () => getCommissions()),
    loadOutcome("home recurring revenue", () => getRecurringRevenueSummary()),
  ]);
  const headline = loadedValue(headlineO);
  const receivables = loadedValue(receivablesO);
  const figures = loadedValue(figuresO);
  const commissions = loadedValue(commissionsO);
  const recurring = loadedValue(recurringO);
  const na = (
    <span className="text-muted-foreground" title={t("unavailableHint")}>
      {t("unavailable")}
    </span>
  );

  const totals = receivables?.totals ?? [];
  const perCurrency = (pick: (row: (typeof totals)[number]) => number) =>
    totals.length === 0
      ? formatIn(0, "EUR", locale)
      : totals.map((row) => formatIn(pick(row), row.currency, locale)).join(" · ");
  const overdueAny = totals.some((row) => row.overdue > 0);
  const overdueList = (receivables?.invoices ?? [])
    .filter((i) => i.daysOverdue > 0)
    .sort((a, b) => b.daysOverdue - a.daysOverdue)
    .slice(0, 6);

  const report = commissions?.report ?? null;
  const amounts = (list: CurrencyAmount[] | undefined) =>
    list && list.length > 0
      ? list.map((a) => formatIn(a.amount, a.currency, locale)).join(" · ")
      : formatIn(0, "EUR", locale);
  const approved = report ? report.months.every((m) => m.approvedAt) : false;

  return (
    <>
      {/* The four the money side opens with: what was won, what was billed, what came in. */}
      <div className="grid grid-cols-2 gap-3 md:gap-6 xl:grid-cols-4">
        <HeadlineKpi
          href={`/dashboard/pipeline?owners=all&status=won&closed=${thisMonth}&pipeline=all`}
          title={t("wonMonth")}
          icon={<TrophyIcon className="h-4 w-4 shrink-0 text-emerald-600" />}
          value={headline ? <Money value={headline.won.month} /> : na}
        >
          {headline && (
            <>
              {t("sinceYearStart")} <Money value={headline.won.year} />
            </>
          )}
        </HeadlineKpi>
        <HeadlineKpi
          href="/dashboard/pipeline?owners=all&status=won&pipeline=all"
          title={t("wonAllTime")}
          icon={<CrownIcon className="h-4 w-4 shrink-0 text-amber-600" />}
          value={headline ? <Money value={headline.won.allTime} /> : na}
        >
          {headline && t("wonAllTimeDesc", { count: headline.won.allTimeCount })}
        </HeadlineKpi>
        <HeadlineKpi
          href="/dashboard/sales/finance"
          title={t("collected")}
          icon={<BanknoteIcon className="h-4 w-4 shrink-0 text-blue-600" />}
          value={headline ? amounts(headline.collected.month) : na}
        >
          {headline && `${t("sinceYearStart")} ${amounts(headline.collected.year)}`}
        </HeadlineKpi>
        <HeadlineKpi
          href="/dashboard/sales/invoices?status=issued"
          title={t("invoiced")}
          icon={<ReceiptTextIcon className="h-4 w-4 shrink-0 text-violet-600" />}
          value={headline ? amounts(headline.invoiced.month) : na}
        >
          {headline && `${t("invoicedDesc")} · ${t("sinceYearStart")} ${amounts(headline.invoiced.year)}`}
        </HeadlineKpi>
      </div>

      <div className="grid grid-cols-2 gap-3 md:gap-6 xl:grid-cols-3">
        <Kpi
          href="/dashboard/sales/finance"
          accent="border-l-blue-500"
          title={t("outstanding")}
          icon={<WalletIcon className="h-4 w-4 shrink-0 text-blue-500" />}
        >
          <div className={KPI_VALUE}>{receivables ? perCurrency((row) => row.outstanding) : na}</div>
          {receivables && (
            <p className="mt-1 text-muted-foreground text-xs">
              {t("outstandingDesc", { count: receivables.invoices.length })}
            </p>
          )}
        </Kpi>
        <Kpi
          href="/dashboard/sales/finance"
          accent={overdueAny ? "border-l-red-500" : "border-l-slate-300"}
          title={t("overdue")}
          icon={
            <AlarmClockIcon className={`h-4 w-4 shrink-0 ${overdueAny ? "text-red-500" : "text-muted-foreground"}`} />
          }
        >
          <div className={KPI_VALUE}>{receivables ? perCurrency((row) => row.overdue) : na}</div>
          <p className="mt-1 text-muted-foreground text-xs">{t("overdueDesc")}</p>
        </Kpi>
        <Kpi
          href="/dashboard/sales/orders?status=completed"
          accent={figures && figures.ordersToInvoice > 0 ? "border-l-amber-500" : "border-l-slate-300"}
          title={t("toInvoice")}
          icon={<PackageCheckIcon className="h-4 w-4 shrink-0 text-amber-500" />}
        >
          <div className={KPI_VALUE}>{figures ? figures.ordersToInvoice : na}</div>
          <p className="mt-1 text-muted-foreground text-xs">{t("toInvoiceDesc")}</p>
        </Kpi>
        <Kpi
          href="/dashboard/sales/invoices?status=draft"
          accent="border-l-violet-500"
          title={t("drafts")}
          icon={<FilePenLineIcon className="h-4 w-4 shrink-0 text-violet-500" />}
        >
          <div className={KPI_VALUE}>{figures ? figures.draftInvoices : na}</div>
          <p className="mt-1 text-muted-foreground text-xs">{t("draftsDesc")}</p>
        </Kpi>
        <Kpi
          href="/dashboard/pipeline/commissions"
          accent="border-l-emerald-500"
          title={t("commissions")}
          icon={<PercentIcon className="h-4 w-4 shrink-0 text-emerald-500" />}
        >
          <div className={KPI_VALUE}>{failed(commissionsO) ? na : <Money value={report?.totals.amount ?? 0} />}</div>
          <p className="mt-1 text-muted-foreground text-xs">
            {!report || report.totals.amount === 0
              ? t("commissionsNone")
              : approved
                ? t("commissionsApproved")
                : t("commissionsToApprove")}
          </p>
        </Kpi>
        <Kpi
          href="/dashboard/sales/contracts?view=renewal_due"
          accent="border-l-yellow-500"
          title={t("renewals")}
          icon={<ScrollTextIcon className="h-4 w-4 shrink-0 text-yellow-500" />}
        >
          <div className={KPI_VALUE}>{recurring ? recurring.renewalsDue : na}</div>
          <p className="mt-1 text-muted-foreground text-xs">{t("renewalsDesc")}</p>
        </Kpi>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <BadgeEuroIcon className="h-4 w-4 text-muted-foreground" />
              {t("overdueTitle")}
            </CardTitle>
            <CardDescription>{t("overdueListDesc")}</CardDescription>
          </div>
          <Button variant="outline" size="sm" className="shrink-0 gap-1" asChild>
            <Link href="/dashboard/sales/finance">
              {t("viewFinance")} <ArrowRight className="h-3 w-3" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {!receivables ? (
            <p className="px-6 py-8 text-center text-muted-foreground text-sm">{t("unavailableHint")}</p>
          ) : overdueList.length === 0 ? (
            <p className="px-6 py-8 text-center text-muted-foreground text-sm">{t("noOverdue")}</p>
          ) : (
            <ul className="divide-y">
              {overdueList.map((inv) => (
                <li key={inv.id}>
                  <Link
                    href={`/dashboard/sales/invoices/${inv.id}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40 sm:px-6"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-sm">{inv.customer ?? inv.documentNumber ?? "—"}</p>
                      <p className="truncate text-muted-foreground text-xs">
                        {inv.documentNumber}
                        {inv.documentNumber && " · "}
                        <span className="font-medium text-red-600 dark:text-red-400">
                          {t("overdueDays", { days: inv.daysOverdue })}
                        </span>
                      </p>
                    </div>
                    <p className="shrink-0 font-semibold text-sm tabular-nums">
                      {formatIn(inv.outstanding, inv.currency, locale)}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
