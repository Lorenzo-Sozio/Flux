"use client";

import { useState, useTransition } from "react";

import { BanknoteIcon, Loader2, Plus, TruckIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";

import {
  deleteOrderPayment,
  type getOrderInvoicesToPay,
  type getOrderPayments,
  linkOrderPaymentToInvoice,
  recordOrderPayment,
  setOrderDelivered,
} from "@/actions/orders";
import { PaymentRemoveButton } from "@/components/crm/payment-remove-button";
import { ReceiptEditDialog } from "@/components/crm/receipt-edit-dialog";
import { StatusBadge } from "@/components/crm/record/record-page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { useCurrency } from "@/hooks/use-currency";
import { isRecordablePayment, paymentSummary } from "@/lib/order-payment";

import { PAYMENT_TONE } from "./order-tones";

type Payment = Awaited<ReturnType<typeof getOrderPayments>>[number];
type PayableInvoice = Awaited<ReturnType<typeof getOrderInvoicesToPay>>[number];

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
 *
 * ⚠️⚠️ Which invoice a payment pays (I10). With one issued invoice it is that one; with none it
 * is a deposit on the order, which reaches the invoice when it is issued; with several the
 * person says which — a payment that paid "the order" used to leave every invoice unpaid.
 * A deposit left on an order that now has invoices is linked from its row.
 */
export function PaymentsCard({
  orderId,
  totalAmount,
  currency,
  deliveredAt,
  payments,
  invoices,
  canWrite,
  canInvoice,
  today,
}: {
  orderId: string;
  totalAmount: string | number | null;
  /** The order's own currency: payments are recorded in it. */
  currency: string;
  deliveredAt: Date | string | null;
  payments: Payment[];
  /** The order's issued invoices, with what each still owes. */
  invoices: PayableInvoice[];
  /** A viewer reads the payments; the controls that would only answer "forbidden" are not drawn. */
  canWrite: boolean;
  /** Paying or correcting an invoice's money asks for the invoice's permission too. */
  canInvoice: boolean;
  /** The workspace's day: the form's default and its latest allowed date. */
  today: string;
}) {
  const t = useTranslations("orders.payments");
  const format = useFormatter();
  const { formatMoney } = useCurrency();
  const [adding, setAdding] = useState(false);
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(today);
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");
  // The invoice this payment pays: chosen when there are several, implied otherwise.
  const [invoiceId, setInvoiceId] = useState("");
  const [delivered, setDelivered] = useState(deliveredAt ? new Date(deliveredAt).toISOString().slice(0, 10) : "");
  const [pending, startTransition] = useTransition();

  const summary = paymentSummary(totalAmount, payments);

  function add() {
    if (!isRecordablePayment(amount)) {
      toast.error(t("amountInvalid"));
      return;
    }
    if (invoices.length > 1 && !invoiceId) {
      toast.error(t("chooseInvoice"));
      return;
    }
    startTransition(async () => {
      try {
        const r = await recordOrderPayment(orderId, {
          // The text as typed: "12,50" is a number to the server's parser and NaN to Number().
          amount,
          paidAt,
          method,
          reference,
          invoiceId: invoiceId || undefined,
        });
        // Beyond what the invoice owed, the rest waits on the order for the next invoice: said.
        toast.success(
          r.onOrder > 0 ? t("recordedRestOnOrder", { amount: formatMoney(r.onOrder, currency) }) : t("recorded"),
        );
        setAmount("");
        setMethod("");
        setReference("");
        setInvoiceId("");
        setAdding(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("recordFailed"));
      }
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      try {
        const r = await deleteOrderPayment(id);
        toast.success(r.removed === "allocation" ? t("removedToCredit") : t("removed"));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("recordFailed"));
      }
    });
  }

  function link(paymentId: string, target: string) {
    if (!target) return;
    startTransition(async () => {
      try {
        await linkOrderPaymentToInvoice(paymentId, target);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("recordFailed"));
      }
    });
  }

  const invoiceLabel = (i: PayableInvoice) =>
    `${i.number ?? t("invoiceUnnumbered")} · ${t("stillOwed", { amount: formatMoney(Math.max(0, i.outstanding), i.currency) })}`;

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
                    {p.reference ? ` · ${p.reference}` : ""}
                    {p.recordedBy ? ` · ${p.recordedBy}` : ""}
                  </p>
                  <p className="truncate text-xs">
                    {p.invoiceId ? (
                      <span className="text-muted-foreground">
                        {t("paidInvoice", { number: p.invoiceNumber ?? t("invoiceUnnumbered") })}
                      </span>
                    ) : (
                      <span className="text-amber-700 dark:text-amber-400">{t("depositOnOrder")}</span>
                    )}
                  </p>
                  {!p.invoiceId && invoices.length > 0 && canWrite && canInvoice && (
                    <NativeSelect
                      aria-label={t("linkToInvoice")}
                      className="mt-1 h-8 text-xs"
                      value=""
                      onChange={(e) => link(p.id, e.target.value)}
                      disabled={pending}
                    >
                      <NativeSelectOption value="">{t("linkToInvoice")}</NativeSelectOption>
                      {invoices.map((i) => (
                        <NativeSelectOption key={i.id} value={i.id}>
                          {invoiceLabel(i)}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  )}
                </div>
                {canWrite && (!p.invoiceId || canInvoice) && p.receiptId && (
                  <ReceiptEditDialog
                    receipt={{
                      id: p.receiptId,
                      amount: p.receiptAmount ?? p.amount,
                      receivedAt: p.paidAt,
                      method: p.method,
                      reference: p.reference,
                      note: p.note,
                    }}
                  />
                )}
                {canWrite && (!p.invoiceId || canInvoice) && (
                  <PaymentRemoveButton
                    payment={p}
                    currency={currency}
                    disabled={pending}
                    onConfirm={() => remove(p.id)}
                  />
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
                  <Input
                    id="payment-date"
                    type="date"
                    max={today}
                    value={paidAt}
                    onChange={(e) => setPaidAt(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                <div className="space-y-1.5">
                  <Label htmlFor="payment-reference" className="text-xs">
                    {t("reference")}
                  </Label>
                  <Input
                    id="payment-reference"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder={t("referencePlaceholder")}
                  />
                </div>
              </div>
              {invoices.length > 1 ? (
                <div className="space-y-1.5">
                  <Label htmlFor="payment-invoice" className="text-xs">
                    {t("invoice")}
                  </Label>
                  <NativeSelect id="payment-invoice" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
                    <NativeSelectOption value="">{t("chooseInvoice")}</NativeSelectOption>
                    {invoices.map((i) => (
                      <NativeSelectOption key={i.id} value={i.id}>
                        {invoiceLabel(i)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
              ) : (
                <p className="text-muted-foreground text-xs">
                  {invoices.length === 1
                    ? t("goesToInvoice", { number: invoices[0].number ?? t("invoiceUnnumbered") })
                    : t("goesToOrder")}
                </p>
              )}
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
              onClick={() => {
                // One invoice owing: the form opens on what it owes, and on today.
                setAmount(invoices.length === 1 ? String(invoices[0].outstanding) : "");
                setPaidAt(today);
                setAdding(true);
              }}
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
