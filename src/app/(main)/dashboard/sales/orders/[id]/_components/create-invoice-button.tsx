"use client";

import Link from "next/link";

import { Receipt } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

/**
 * Opens the new-invoice page filled in from this order: one place an invoice is written.
 *
 * ⚠️ When the order already has a draft invoice the button opens that draft instead.
 * The new-invoice page refuses a second draft for the same order anyway; sending the
 * reader there only to be told so is a round trip that ends where this one does.
 */
export function CreateInvoiceButton({
  orderId,
  draftId,
  variant = "outline",
  balance = false,
}: {
  orderId: string;
  draftId?: string | null;
  variant?: "outline" | "default";
  /** The order has deposit invoices: this one is the balance, and takes them off (I11). */
  balance?: boolean;
}) {
  const t = useTranslations("invoices");
  return (
    <Button asChild variant={variant} size="sm" className="gap-1.5">
      <Link href={draftId ? `/dashboard/sales/invoices/${draftId}` : `/dashboard/sales/invoices/new?order=${orderId}`}>
        <Receipt className="size-3.5" aria-hidden />{" "}
        {draftId ? t("new.openDraft") : balance ? t("deposit.createBalance") : t("createFromOrder")}
      </Link>
    </Button>
  );
}
