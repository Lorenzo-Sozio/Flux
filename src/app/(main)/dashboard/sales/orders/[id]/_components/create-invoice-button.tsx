"use client";

import Link from "next/link";

import { Receipt } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

/** Opens the new-invoice page filled in from this order: one place an invoice is written. */
export function CreateInvoiceButton({ orderId }: { orderId: string }) {
  const t = useTranslations("invoices");
  return (
    <Button asChild variant="outline" size="sm" className="gap-1.5">
      <Link href={`/dashboard/sales/invoices/new?order=${orderId}`}>
        <Receipt className="h-3.5 w-3.5" /> {t("createFromOrder")}
      </Link>
    </Button>
  );
}
