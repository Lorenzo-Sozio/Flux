"use client";

import { Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useCurrency } from "@/hooks/use-currency";

/**
 * Taking a payment back, asked first and said plainly.
 *
 * ⚠️ One tap on a bin used to remove money from an invoice, with nothing to say what became
 * of it. Three different things happen, and the dialog names the one that will: the payment
 * is deleted; only this share goes, and the rest of the transfer stays where it is; or the
 * money came from the bank statement, so it stays — as the customer's credit — and only the
 * link to this document is undone (src/lib/receipts.ts, `removeAllocation`).
 */
export function PaymentRemoveButton({
  payment,
  currency,
  disabled,
  onConfirm,
}: {
  payment: {
    amount: string | number | null;
    paidAt: Date | string;
    receiptAmount: string | number | null;
    bankLinked: boolean;
  };
  currency: string;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const t = useTranslations("paymentRemove");
  const format = useFormatter();
  const { formatMoney } = useCurrency();
  const amount = formatMoney(Math.abs(Number(payment.amount ?? 0)), currency);
  const date = format.dateTime(new Date(payment.paidAt), { dateStyle: "medium" });
  const shared =
    payment.receiptAmount !== null && Math.abs(Number(payment.receiptAmount) - Number(payment.amount ?? 0)) > 0.005;
  const body = payment.bankLinked
    ? t("bankLinked", { amount })
    : shared
      ? t("shared", { amount, receipt: formatMoney(Math.abs(Number(payment.receiptAmount)), currency) })
      : t("deleted", { amount, date });

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-10 shrink-0 text-muted-foreground hover:text-destructive md:size-8"
          disabled={disabled}
          aria-label={t("button")}
          title={t("button")}
        >
          <Trash2 className="size-3.5" aria-hidden />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title", { amount })}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{t("confirm")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
