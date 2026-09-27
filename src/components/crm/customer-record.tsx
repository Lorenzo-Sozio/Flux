"use client";

import Link from "next/link";

import { FileText, Handshake, LifeBuoy, ShoppingCart } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import type { CustomerRecord, CustomerRecordRow } from "@/actions/customer-record";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useCurrency } from "@/hooks/use-currency";
import { cn } from "@/lib/utils";

/**
 * What has been sold to this customer, on the customer's own page.
 *
 * The page could say everything about a company except the part a business opens
 * it for. Four groups, five rows each, every row a link into the document itself.
 *
 * A group with nothing in it is not drawn: four empty headings on a customer
 * added this morning is a screen apologising for itself. When every group is
 * empty the panel says so once, which is a different sentence and a true one.
 */

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const STATUS_TONE: Record<string, string> = {
  won: "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400",
  accepted: "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400",
  completed: "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400",
  lost: "border-rose-300 text-rose-700 dark:border-rose-800 dark:text-rose-400",
  declined: "border-rose-300 text-rose-700 dark:border-rose-800 dark:text-rose-400",
  cancelled: "border-rose-300 text-rose-700 dark:border-rose-800 dark:text-rose-400",
  breached: "border-rose-400 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
  expired: "border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400",
};

function Group({
  icon: Icon,
  title,
  rows,
  more,
  moreHref,
  moreLabel,
  formatAmount,
}: {
  icon: typeof FileText;
  title: string;
  rows: CustomerRecordRow[];
  more: boolean;
  moreHref: string;
  moreLabel: string;
  formatAmount: (n: number, currency: string) => string;
}) {
  const tStatus = useTranslations("entities.statuses");
  const format = useFormatter();
  if (rows.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <h3 className="font-semibold text-muted-foreground text-xs uppercase tracking-wide">{title}</h3>
        <span className="text-muted-foreground/70 text-xs tabular-nums">{rows.length}</span>
      </div>

      <ul className="divide-y rounded-lg border">
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              href={row.href}
              className="flex items-center justify-between gap-3 px-3 py-2 transition-colors hover:bg-muted/40"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-sm">{row.label}</p>
                {row.sub && (
                  <p className="truncate text-muted-foreground text-xs">
                    {/* A deal's expected close arrives as an ISO day; shown raw it
                        read "2026-10-21" in the middle of an Italian screen. */}
                    {ISO_DAY.test(row.sub)
                      ? format.dateTime(new Date(`${row.sub}T12:00:00`), {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })
                      : row.sub}
                  </p>
                )}
              </div>
              {/* On a phone the amount and the status stack: side by side they
                  took half the row and left a quote number three characters. */}
              <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
                {row.amount !== null && (
                  <span className="font-medium text-sm tabular-nums">
                    {formatAmount(row.amount, row.currency ?? "EUR")}
                  </span>
                )}
                <Badge variant="outline" className={cn("h-5 text-[10px] capitalize", STATUS_TONE[row.status])}>
                  {tStatus.has(row.status as never) ? tStatus(row.status as never) : row.status.replace(/_/g, " ")}
                </Badge>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {more && (
        <Link href={moreHref} className="inline-block text-muted-foreground text-xs underline underline-offset-2">
          {moreLabel}
        </Link>
      )}
    </div>
  );
}

export function CustomerRecordPanel({
  record,
  companyId,
  contactId,
  canWrite = true,
}: {
  record: CustomerRecord;
  companyId?: string;
  contactId?: string;
  /** False for a viewer: New quote and New order lead to forms that would refuse them. */
  canWrite?: boolean;
}) {
  const t = useTranslations("customerRecord");
  const { formatMoney, formatAmount: formatEur } = useCurrency();
  // Documents carry their own currency and are shown in it.
  const formatAmount = (n: number, currency: string) => formatMoney(n, currency);
  // ⚠️ A deal's `amount` is EUR at rest whatever `currency` says (that column
  // records what was typed), so it goes through the EUR formatter: shown with its
  // own currency code, a deal typed in dollars printed its euro figure with a $.
  const formatDealAmount = (n: number) => formatEur(n);

  // Starting a quote, an order or a ticket from here carries the customer with
  // it. Without this the path was: read the customer, go to the module, find the
  // customer again in a picker, and hope it is the same one.
  const scope = new URLSearchParams();
  if (companyId) scope.set("companyId", companyId);
  if (contactId) scope.set("contactId", contactId);
  const query = scope.toString() ? `?${scope}` : "";

  const empty =
    record.deals.length === 0 &&
    record.quotes.length === 0 &&
    record.orders.length === 0 &&
    record.tickets.length === 0;

  return (
    <Card>
      {/* ⚠️ Title first, buttons on a row of their own under it, at every width.
          The panel lives in the record pages' narrow side column (a third of the
          width), where buttons beside the title squeezed the description to one
          word per line. */}
      <CardHeader className="space-y-3">
        <div className="min-w-0">
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("subtitle")}</CardDescription>
        </div>
        {record.modules.sales && canWrite && (
          <div className="flex flex-wrap items-center gap-2 max-sm:[&>*]:flex-1">
            <Button asChild variant="outline" size="sm">
              <Link href={`/dashboard/sales/quotes/new${query}`}>{t("newQuote")}</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/dashboard/sales/orders/new${query}`}>{t("newOrder")}</Link>
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        {empty ? (
          <p className="py-4 text-center text-muted-foreground text-sm">{t("empty")}</p>
        ) : (
          <>
            <Group
              icon={Handshake}
              title={t("deals")}
              rows={record.deals}
              more={record.more.deals}
              moreHref="/dashboard/pipeline"
              moreLabel={t("seeAllDeals")}
              formatAmount={formatDealAmount}
            />
            <Group
              icon={FileText}
              title={t("quotes")}
              rows={record.quotes}
              more={record.more.quotes}
              moreHref="/dashboard/sales/quotes"
              moreLabel={t("seeAllQuotes")}
              formatAmount={formatAmount}
            />
            <Group
              icon={ShoppingCart}
              title={t("orders")}
              rows={record.orders}
              more={record.more.orders}
              moreHref="/dashboard/sales/orders"
              moreLabel={t("seeAllOrders")}
              formatAmount={formatAmount}
            />
            <Group
              icon={LifeBuoy}
              title={t("tickets")}
              rows={record.tickets}
              more={record.more.tickets}
              moreHref="/dashboard/support/tickets"
              moreLabel={t("seeAllTickets")}
              formatAmount={formatAmount}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
