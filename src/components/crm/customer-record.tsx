"use client";

import Link from "next/link";

import { FileText, Handshake, LifeBuoy, ShoppingCart } from "lucide-react";
import { useTranslations } from "next-intl";

import type { CustomerRecord, CustomerRecordRow } from "@/actions/customer-record";
import { Badge } from "@/components/ui/badge";
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
  formatAmount: (n: number) => string;
}) {
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
              <div className="min-w-0">
                <p className="truncate font-medium text-sm">{row.label}</p>
                {row.sub && <p className="truncate text-muted-foreground text-xs">{row.sub}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {row.amount !== null && (
                  <span className="font-medium text-sm tabular-nums">{formatAmount(row.amount)}</span>
                )}
                <Badge variant="outline" className={cn("h-5 text-[10px] capitalize", STATUS_TONE[row.status])}>
                  {row.status.replace(/_/g, " ")}
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

export function CustomerRecordPanel({ record }: { record: CustomerRecord }) {
  const t = useTranslations("customerRecord");
  const { formatAmount } = useCurrency();

  const empty =
    record.deals.length === 0 &&
    record.quotes.length === 0 &&
    record.orders.length === 0 &&
    record.tickets.length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("subtitle")}</CardDescription>
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
              formatAmount={formatAmount}
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
