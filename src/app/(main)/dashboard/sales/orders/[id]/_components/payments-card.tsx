"use client";

import { useEffect, useState, useTransition } from "react";

import { BanknoteIcon, Loader2, Plus, Trash2, TruckIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { deleteOrderPayment, getOrderPayments, recordOrderPayment, setOrderDelivered } from "@/actions/orders";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useCurrency } from "@/hooks/use-currency";
import { isRecordablePayment, paymentSummary } from "@/lib/order-payment";
import { cn } from "@/lib/utils";

type Payment = Awaited<ReturnType<typeof getOrderPayments>>[number];

const STATE_TONE: Record<string, string> = {
  unpaid: "border-rose-300 text-rose-700 dark:border-rose-800 dark:text-rose-400",
  partial: "border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400",
  paid: "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400",
  overpaid: "border-sky-300 text-sky-700 dark:border-sky-800 dark:text-sky-400",
};

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
 */
export function PaymentsCard({
  orderId,
  totalAmount,
  deliveredAt,
}: {
  orderId: string;
  totalAmount: string | number | null;
  deliveredAt: Date | string | null;
}) {
  const t = useTranslations("orders.payments");
  const { formatAmount } = useCurrency();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("");
  const [delivered, setDelivered] = useState(deliveredAt ? new Date(deliveredAt).toISOString().slice(0, 10) : "");
  const [pending, startTransition] = useTransition();

  function reload() {
    getOrderPayments(orderId)
      .then(setPayments)
      .catch(() => setPayments([]))
      .finally(() => setLoading(false));
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: the order is the trigger
  useEffect(reload, [orderId]);

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
        reload();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("recordFailed"));
      }
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      try {
        await deleteOrderPayment(id);
        reload();
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
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("recordFailed"));
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <BanknoteIcon className="h-4 w-4 text-muted-foreground" />
          {t("title")}
        </CardTitle>
        <Badge variant="outline" className={cn("h-5 text-[10px]", STATE_TONE[summary.state])}>
          {t(`state.${summary.state}`)}
        </Badge>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="space-y-1.5 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{t("paid")}</span>
            <span className="tabular-nums">{formatAmount(summary.paid)}</span>
          </div>
          <div className="flex items-center justify-between font-medium">
            <span>{summary.outstanding < 0 ? t("credit") : t("outstanding")}</span>
            <span className="tabular-nums">{formatAmount(Math.abs(summary.outstanding))}</span>
          </div>
        </div>

        {payments.length > 0 && (
          <>
            <Separator />
            <ul className="space-y-1">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <span className="tabular-nums">{formatAmount(Number(p.amount ?? 0))}</span>
                    <span className="ml-2 text-muted-foreground">
                      {new Date(p.paidAt).toLocaleDateString()}
                      {p.method ? ` · ${p.method}` : ""}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => remove(p.id)}
                    disabled={pending}
                    aria-label={t("removePayment")}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}

        {loading && <p className="text-muted-foreground text-xs">{t("loading")}</p>}

        {adding ? (
          <div className="space-y-2 rounded-md border bg-muted/20 p-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[10px]">{t("amount")}</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="h-8 tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">{t("date")}</Label>
                <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} className="h-8" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]">{t("method")}</Label>
              <Input
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                placeholder={t("methodPlaceholder")}
                className="h-8"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)} disabled={pending}>
                {t("cancel")}
              </Button>
              <Button type="button" size="sm" onClick={add} disabled={pending} className="gap-1.5">
                {pending && <Loader2 className="h-3 w-3 animate-spin" />}
                {t("record")}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full gap-1.5"
            onClick={() => setAdding(true)}
            disabled={pending}
          >
            <Plus className="h-3.5 w-3.5" /> {t("addPayment")}
          </Button>
        )}

        <Separator />

        {/* The date the status cannot say. */}
        <div className="space-y-1">
          <Label className="flex items-center gap-1.5 text-[10px]">
            <TruckIcon className="h-3 w-3 text-muted-foreground" />
            {t("deliveredOn")}
          </Label>
          <Input
            type="date"
            value={delivered}
            onChange={(e) => saveDelivered(e.target.value)}
            disabled={pending}
            className="h-8"
          />
        </div>
      </CardContent>
    </Card>
  );
}
