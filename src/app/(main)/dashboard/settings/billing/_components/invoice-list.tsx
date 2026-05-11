"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, Download } from "lucide-react";

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

const STATUS_BADGE: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  paid: { label: "Paid", variant: "default" },
  open: { label: "Open", variant: "secondary" },
  draft: { label: "Draft", variant: "outline" },
  void: { label: "Void", variant: "outline" },
  uncollectible: { label: "Uncollectible", variant: "destructive" },
};

function formatAmount(cents: number, currency: string) {
  return new Intl.NumberFormat("en-EU", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

export function InvoiceList({ invoices }: InvoiceListProps) {
  if (invoices.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Invoices
          </CardTitle>
          <CardDescription>No invoices yet.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          Invoices
        </CardTitle>
        <CardDescription>Download or view your past invoices.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="divide-y">
          {invoices.map((inv) => {
            const badge = STATUS_BADGE[inv.status ?? ""] ?? {
              label: inv.status ?? "—",
              variant: "outline" as const,
            };
            const date = new Date(inv.created * 1000).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            });

            return (
              <div key={inv.id} className="flex items-center justify-between py-3">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">
                    {inv.number ?? inv.id}
                    <Badge variant={badge.variant} className="ml-2 text-xs">
                      {badge.label}
                    </Badge>
                  </p>
                  <p className="text-xs text-muted-foreground">{date}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium">
                    {formatAmount(inv.amountPaid || inv.amountDue, inv.currency)}
                  </span>
                  {inv.invoicePdf && (
                    <Button variant="ghost" size="icon" asChild>
                      <a href={inv.invoicePdf} target="_blank" rel="noopener noreferrer">
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
