"use client";

import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { HandCoins, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { createDepositInvoice } from "@/actions/invoices";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isRecordablePayment } from "@/lib/order-payment";

const DEPOSIT_SHARES = [30, 40, 50] as const;

/**
 * A deposit invoice (TD02) for part of the order (I11, the way deposits are usually invoiced).
 *
 * The amount is what the customer pays, VAT included; the server splits it across the order's
 * VAT rates and refuses more than is left to invoice. It makes a draft and opens it, to be read
 * and issued like any invoice — a fiscal document is never issued from a dialog.
 */
export function DepositInvoiceButton({
  orderId,
  left,
  suggested,
  leftText,
  total,
  variant = "outline",
}: {
  orderId: string;
  /** The order's total, VAT included: what a percentage is of. */
  total: number;
  /** What is left to invoice on the order, VAT included. */
  left: number;
  /** A deposit already received on the order and not yet invoiced: the amount proposed. */
  suggested?: number;
  /** `left`, formatted in the order's currency by the page. */
  leftText: string;
  variant?: "outline" | "default";
}) {
  const t = useTranslations("invoices.deposit");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(suggested ? String(suggested) : "");
  const [pending, startTransition] = useTransition();
  // A share of the order, never more than what is left to invoice.
  const shares = DEPOSIT_SHARES.map((percent) => ({
    percent,
    amount: Math.min(left, Math.round(total * percent) / 100),
  }));

  function create() {
    if (!isRecordablePayment(amount)) {
      toast.error(t("amountInvalid"));
      return;
    }
    startTransition(async () => {
      const r = await createDepositInvoice(orderId, amount).catch(() => null);
      if (!r?.ok) {
        toast.error(r && !r.ok ? r.error : t("failed"));
        return;
      }
      setOpen(false);
      router.push(`/dashboard/sales/invoices/${r.id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant={variant} size="sm" className="gap-1.5" disabled={left <= 0}>
          <HandCoins className="size-3.5" aria-hidden /> {t("create")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("createTitle")}</DialogTitle>
          <DialogDescription>{t("createHint")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="deposit-amount">{t("amount")}</Label>
          <Input
            id="deposit-amount"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="tabular-nums"
          />
          <p className="text-muted-foreground text-xs">{t("leftToInvoice", { amount: leftText })}</p>
          {total > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-muted-foreground text-xs">{t("percentOf")}</span>
              {shares.map((s) => (
                <Button
                  key={s.percent}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs tabular-nums"
                  aria-label={t("percentAria", { percent: s.percent })}
                  onClick={() => setAmount(s.amount.toFixed(2))}
                >
                  {s.percent}%
                </Button>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            {t("cancel")}
          </Button>
          <Button type="button" onClick={create} disabled={pending} className="gap-1.5">
            {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {t("createDraft")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
