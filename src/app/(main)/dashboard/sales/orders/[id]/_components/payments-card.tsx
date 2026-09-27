"use client";

import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { BanknoteIcon, Loader2, Plus, Trash2, TruckIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";

import { deleteOrderPayment, type getOrderPayments, recordOrderPayment, setOrderDelivered } from "@/actions/orders";
import { StatusBadge } from "@/components/crm/record/record-page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useCurrency } from "@/hooks/use-currency";
import { isRecordablePayment, paymentSummary } from "@/lib/order-payment";

import { PAYMENT_TONE } from "./order-tones";

type Payment = Awaited<ReturnType<typeof getOrderPayments>>[number];

/**
 * What has been paid, and when it was delivered.
 *
 * The two questions asked about an order after it exists, and neither had an
 * answer anywhere in the product. Payments are listed rather than summed into a
 * single figure because a deposit and a balance are two events, and the second
 * one used to overwrite the first in every design that stores only a total.
 *
 * The arithmetic is the same function the server validates with, so the figure
 * here and the figure that is stored cannot drift apart.
 *
 * ⚠️ The payments arrive from the page, not from a fetch of the card's own. The
 * hero's "paid" and "balance due" figures are read from the same rows, and a card
 * that kept its own copy would let a payment recorded here leave the header saying
 * the order was still unpaid. Every change refreshes the route instead, so both are
 * redrawn from one read.
 */
export function PaymentsCard({
  orderId,
  totalAmount,
  currency,
  deliveredAt,
  payments,
  canWrite,
}: {
  orderId: string;
  totalAmount: string | number | null;
  /** The order's own currency: payments are recorded in it. */
  currency: string;
  deliveredAt: Date | string | null;
  payments: Payment[];
  /** A viewer reads the payments; the controls that would only answer "forbidden" are not drawn. */
  canWrite: boolean;
}) {
  const t = useTranslations("orders.payments");
  const format = useFormatter();
  const router = useRouter();
  const { formatMoney } = useCurrency();
  const [adding, setAdding] = useState(false);
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(() => new Date().toLocaleDateString("en-CA"));
  const [method, setMethod] = useState("");
  const [delivered, setDelivered] = useState(deliveredAt ? new Date(deliveredAt).toISOString().slice(0, 10) : "");
  const [pending, startTransition] = useTransition();

  const summary = paymentSummary(totalAmount, payments);

  function add() {
    if (!isRecordablePayment(amount)) {
      toast.error(t("amountInvalid"));
      return;
    }
    startTransition(async () => {
      try {
        await recordOrderPayment(orderId, { amount: Number(amount), paidAt, method });
        setAmount("");
        setMethod("");
        setAdding(false);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("recordFailed"));
      }
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      try {
        await deleteOrderPayment(id);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("recordFailed"));
      }
    });
  }

  function saveDelivered(value: string) {
    setDelivered(value);
    startTransition(async () => {
      try {
        await setOrderDelivered(orderId, value || null);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("recordFailed"));
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <BanknoteIcon className="size-4 text-muted-foreground" aria-hidden />
          {t("title")}
        </CardTitle>
        <StatusBadge tone={PAYMENT_TONE[summary.state]}>{t(`state.${summary.state}`)}</StatusBadge>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="space-y-1.5 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">{t("paid")}</span>
            <span className="tabular-nums">{formatMoney(summary.paid, currency)}</span>
          </div>
          <div className="flex items-center justify-between gap-3 font-medium">
            <span>{summary.outstanding < 0 ? t("credit") : t("outstanding")}</span>
            <span className="tabular-nums">{formatMoney(Math.abs(summary.outstanding), currency)}</span>
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
                    {p.recordedBy ? ` · ${p.recordedBy}` : ""}
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
                  <Label htmlFor="payment-amount" className="text-xs">
                    {t("amount")}
                  </Label>
                  <Input
                    id="payment-amount"
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
                  <Label htmlFor="payment-date" className="text-xs">
                    {t("date")}
                  </Label>
                  <Input id="payment-date" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="payment-method" className="text-xs">
                  {t("method")}
                </Label>
                <Input
                  id="payment-method"
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

        <Separator />

        {/* The date the status cannot say. */}
        <div className="space-y-1.5">
          <Label htmlFor="order-delivered" className="flex items-center gap-1.5 text-xs">
            <TruckIcon className="size-3.5 text-muted-foreground" aria-hidden />
            {t("deliveredOn")}
          </Label>
          <Input
            id="order-delivered"
            type="date"
            value={delivered}
            onChange={(e) => saveDelivered(e.target.value)}
            disabled={pending || !canWrite}
          />
        </div>
      </CardContent>
    </Card>
  );
}
