"use client";

import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { BanknoteIcon, Loader2, Plus, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";

import { deleteInvoicePaymentAction, type getInvoicePayments, recordInvoicePaymentAction } from "@/actions/invoices";
import { PAYMENT_TONE } from "@/app/(main)/dashboard/sales/orders/[id]/_components/order-tones";
import { StatusBadge } from "@/components/crm/record/record-page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCurrency } from "@/hooks/use-currency";
import { isRecordablePayment } from "@/lib/order-payment";

type Payments = NonNullable<Awaited<ReturnType<typeof getInvoicePayments>>>;

/**
 * What has arrived against an issued invoice, and what is still owed after its credit
 * notes (src/lib/receivables.ts). The same words and colours as an order's payments: it is
 * the same question, asked of the document the customer was actually sent.
 *
 * ⚠️ The rows and the balance come from the page, and every change refreshes it: the
 * receivables schedule on Finance reads the same rows, and a card with its own copy could
 * say "paid" while the schedule still chased the customer.
 */
export function InvoicePaymentsCard({
  invoiceId,
  currency,
  data,
  canWrite,
}: {
  invoiceId: string;
  currency: string;
  data: Payments;
  canWrite: boolean;
}) {
  const t = useTranslations("orders.payments");
  const ti = useTranslations("invoices.payments");
  const format = useFormatter();
  const router = useRouter();
  const { formatMoney } = useCurrency();
  const { balance, payments } = data;
  const [adding, setAdding] = useState(false);
  const [amount, setAmount] = useState(balance.outstanding > 0 ? String(balance.outstanding) : "");
  const [paidAt, setPaidAt] = useState(() => new Date().toLocaleDateString("en-CA"));
  const [method, setMethod] = useState("");
  const [pending, startTransition] = useTransition();

  function add() {
    if (!isRecordablePayment(amount)) {
      toast.error(t("amountInvalid"));
      return;
    }
    startTransition(async () => {
      const r = await recordInvoicePaymentAction(invoiceId, { amount, paidAt, method }).catch(() => null);
      if (!r?.ok) {
        toast.error(r?.error ?? t("recordFailed"));
        return;
      }
      setMethod("");
      setAdding(false);
      router.refresh();
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      await deleteInvoicePaymentAction(id).catch(() => toast.error(t("recordFailed")));
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <BanknoteIcon className="size-4 text-muted-foreground" aria-hidden />
          {t("title")}
        </CardTitle>
        <StatusBadge tone={PAYMENT_TONE[balance.state]}>{t(`state.${balance.state}`)}</StatusBadge>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="space-y-1.5 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">{ti("due")}</span>
            <span className="tabular-nums">{formatMoney(balance.due, currency)}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">{t("paid")}</span>
            <span className="tabular-nums">{formatMoney(balance.paid, currency)}</span>
          </div>
          <div className="flex items-center justify-between gap-3 font-medium">
            <span>{balance.outstanding < 0 ? t("credit") : t("outstanding")}</span>
            <span className="tabular-nums">{formatMoney(Math.abs(balance.outstanding), currency)}</span>
          </div>
        </div>

        {payments.length > 0 && (
          <ul className="divide-y rounded-md border">
            {payments.map((p) => (
              <li key={p.id} className="flex min-h-11 items-center justify-between gap-2 py-1 pr-1 pl-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium tabular-nums">{formatMoney(Number(p.amount ?? 0), currency)}</p>
                  <p className="truncate text-muted-foreground text-xs">
                    {format.dateTime(new Date(p.paidAt), { dateStyle: "medium" })}
                    {p.method ? ` · ${p.method}` : ""}
                  </p>
                </div>
                {canWrite && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-10 shrink-0 text-muted-foreground hover:text-destructive md:size-8"
                    onClick={() => remove(p.id)}
                    disabled={pending}
                    aria-label={t("removePayment")}
                    title={t("removePayment")}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {canWrite &&
          (adding ? (
            <div className="space-y-3 rounded-md border bg-muted/20 p-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="invoice-payment-amount" className="text-xs">
                    {t("amount")}
                  </Label>
                  <Input
                    id="invoice-payment-amount"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="tabular-nums"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="invoice-payment-date" className="text-xs">
                    {t("date")}
                  </Label>
                  <Input
                    id="invoice-payment-date"
                    type="date"
                    value={paidAt}
                    onChange={(e) => setPaidAt(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invoice-payment-method" className="text-xs">
                  {t("method")}
                </Label>
                <Input
                  id="invoice-payment-method"
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  placeholder={t("methodPlaceholder")}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setAdding(false)} disabled={pending}>
                  {t("cancel")}
                </Button>
                <Button type="button" onClick={add} disabled={pending} className="gap-1.5">
                  {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                  {t("record")}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="w-full gap-1.5"
              onClick={() => setAdding(true)}
              disabled={pending}
            >
              <Plus className="size-3.5" aria-hidden /> {t("addPayment")}
            </Button>
          ))}
      </CardContent>
    </Card>
  );
}
