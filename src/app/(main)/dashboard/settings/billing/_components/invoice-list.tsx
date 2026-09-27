"use client";

import { Download, FileText } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface Invoice {
  id: string;
  number: string | null;
  status: string | null;
  amountDue: number;
  amountPaid: number;
  currency: string;
  periodStart: number;
  periodEnd: number;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
  created: number;
}

interface InvoiceListProps {
  invoices: Invoice[];
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  paid: "default",
  open: "secondary",
  draft: "outline",
  void: "outline",
  uncollectible: "destructive",
};

function formatAmount(cents: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

export function InvoiceList({ invoices }: InvoiceListProps) {
  const t = useTranslations("settings.billing");
  const tc = useTranslations("common");

  if (invoices.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            {t("invoices.title")}
          </CardTitle>
          <CardDescription>{t("invoices.noInvoices")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          {t("invoices.title")}
        </CardTitle>
        <CardDescription>{t("invoices.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="divide-y">
          {invoices.map((inv) => {
            const statusKey = inv.status && inv.status in STATUS_VARIANT ? inv.status : null;
            const badgeVariant = statusKey ? STATUS_VARIANT[statusKey] : ("outline" as const);
            const badgeLabel = statusKey
              ? t(`invoices.status.${statusKey}` as Parameters<typeof t>[0])
              : (inv.status ?? "—");

            const date = new Date(inv.created * 1000).toLocaleDateString(undefined, {
              day: "numeric",
              month: "short",
              year: "numeric",
            });

            return (
              <div key={inv.id} className="flex items-center justify-between gap-3 py-3">
                {/* ⚠️ A draft invoice has no number and falls back to its Stripe id,
                    28 characters with no space to break at. Without `min-w-0` and
                    `truncate` that id set the row's width and pushed the amount and
                    the download off the side of a phone. */}
                <div className="min-w-0 space-y-0.5">
                  <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                    <span className="min-w-0 truncate">{inv.number ?? inv.id}</span>
                    <Badge variant={badgeVariant} className="text-xs">
                      {badgeLabel}
                    </Badge>
                  </p>
                  <p className="text-xs text-muted-foreground">{date}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-sm font-medium">
                    {formatAmount(inv.amountPaid || inv.amountDue, inv.currency)}
                  </span>
                  {inv.invoicePdf && (
                    <Button variant="ghost" size="icon" asChild>
                      <a href={inv.invoicePdf} target="_blank" rel="noopener noreferrer" aria-label={tc("download")}>
                        <Download className="h-4 w-4" />
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
