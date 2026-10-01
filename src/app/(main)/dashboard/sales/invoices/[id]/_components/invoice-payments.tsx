"use client";

import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { ArrowRightLeft, BanknoteIcon, Loader2, Plus, Undo2, WalletIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";

import { deleteInvoicePaymentAction, type getInvoicePayments, recordInvoicePaymentAction } from "@/actions/invoices";
import { allocateCreditAction, recordRefundAction, releaseOverpaymentAction } from "@/actions/receipts";
import { PAYMENT_TONE } from "@/app/(main)/dashboard/sales/orders/[id]/_components/order-tones";
import { PaymentRemoveButton } from "@/components/crm/payment-remove-button";
import { ReceiptEditDialog } from "@/components/crm/receipt-edit-dialog";
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
 *
 * I10: a payment carries the bank's reference and can be corrected; money the customer paid
 * before and nothing has used (their credit) can pay this invoice in one click; money paid
 * beyond what the invoice owes — a credit note after the payment — can be given back.
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
  const [paidAt, setPaidAt] = useState(data.today);
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");
  const [refunding, setRefunding] = useState(false);
  const [pending, startTransition] = useTransition();
  const credit = Math.round(data.credits.reduce((sum, c) => sum + c.left, 0) * 100) / 100;

  function add() {
    if (!isRecordablePayment(amount)) {
      toast.error(t("amountInvalid"));
      return;
    }
    startTransition(async () => {
      const r = await recordInvoicePaymentAction(invoiceId, { amount, paidAt, method, reference }).catch(() => null);
      if (!r?.ok) {
        toast.error(r?.error ?? t("recordFailed"));
        return;
      }
      // What arrived beyond what the invoice owed is the customer's credit: said, never silent.
      if (r.toCredit && r.toCredit > 0)
        toast.success(ti("recordedWithCredit", { amount: formatMoney(r.toCredit, currency) }));
      else toast.success(ti("recorded"));
      setMethod("");
      setReference("");
      setAdding(false);
    });
  }

  /** Spends the customer's credit on this invoice, oldest money first, up to what it owes. */
  function spendCredit() {
    startTransition(async () => {
      let left = balance.outstanding;
      for (const c of data.credits) {
        if (left <= 0) break;
        const share = Math.round(Math.min(left, c.left) * 100) / 100;
        const r = await allocateCreditAction(c.id, invoiceId, share).catch(() => null);
        if (!r?.ok) {
          toast.error(r && !r.ok ? r.error : t("recordFailed"));
          break;
        }
        left = Math.round((left - share) * 100) / 100;
      }
      router.refresh();
    });
  }

  function refund() {
    if (!isRecordablePayment(amount)) {
      toast.error(t("amountInvalid"));
      return;
    }
    startTransition(async () => {
      const r = await recordRefundAction({ invoiceId, amount, paidAt, method, reference }).catch(() => null);
      if (!r?.ok) {
        toast.error(r && !r.ok ? r.error : t("recordFailed"));
        return;
      }
      setRefunding(false);
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const r = await deleteInvoicePaymentAction(id).catch(() => null);
      if (!r?.ok) toast.error(t("recordFailed"));
      else toast.success(r.removed === "allocation" ? ti("removedToCredit") : ti("removed"));
      router.refresh();
    });
  }

  /** What the invoice received beyond what it owes, moved to the customer's credit. */
  function moveToCredit() {
    startTransition(async () => {
      const r = await releaseOverpaymentAction(invoiceId).catch(() => null);
      if (!r?.ok) toast.error(t("recordFailed"));
      else toast.success(ti("movedToCredit", { amount: formatMoney(r.moved ?? 0, currency) }));
      router.refresh();
    });
  }

  /** The form opens on what is owed now, not on the figure it held when the page was drawn. */
  function openAdd() {
    setAmount(balance.outstanding > 0 ? String(balance.outstanding) : "");
    setPaidAt(data.today);
    setAdding(true);
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
                    {p.reference ? ` · ${p.reference}` : ""}
                    {p.receiptAmount && Number(p.receiptAmount) !== Number(p.amount)
                      ? ` · ${ti("partOf", { amount: formatMoney(Math.abs(Number(p.receiptAmount)), currency) })}`
                      : ""}
                  </p>
                </div>
                {canWrite && p.receiptId && (
                  <ReceiptEditDialog
                    receipt={{
                      id: p.receiptId,
                      amount: Math.abs(Number(p.receiptAmount ?? p.amount)),
                      receivedAt: p.paidAt,
                      method: p.method,
                      reference: p.reference,
                      note: p.note,
                    }}
                  />
                )}
                {canWrite && (
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

        {canWrite && credit > 0 && balance.outstanding > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50/60 p-3 text-sm dark:border-emerald-900/50 dark:bg-emerald-950/20">
            <span className="flex min-w-0 items-center gap-2">
              <WalletIcon className="size-4 shrink-0 text-emerald-600" aria-hidden />
              {ti("creditAvailable", { amount: formatMoney(credit, currency) })}
            </span>
            <Button type="button" size="sm" variant="outline" onClick={spendCredit} disabled={pending}>
              {ti("useCredit", { amount: formatMoney(Math.min(credit, balance.outstanding), currency) })}
            </Button>
          </div>
        )}

        {canWrite &&
          balance.outstanding < 0 &&
          (refunding ? (
            <div className="space-y-3 rounded-md border bg-muted/20 p-3">
              <p className="text-muted-foreground text-xs">{ti("refundHint")}</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  aria-label={t("amount")}
                  className="tabular-nums"
                />
                <Input
                  type="date"
                  max={data.today}
                  value={paidAt}
                  onChange={(e) => setPaidAt(e.target.value)}
                  aria-label={t("date")}
                />
                <Input
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  placeholder={t("methodPlaceholder")}
                  aria-label={t("method")}
                />
                <Input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder={t("referencePlaceholder")}
                  aria-label={t("reference")}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setRefunding(false)} disabled={pending}>
                  {t("cancel")}
                </Button>
                <Button type="button" onClick={refund} disabled={pending} className="gap-1.5">
                  {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                  {ti("recordRefund")}
                </Button>
              </div>
            </div>
          ) : (
            // ⚠️ Overpaid: the money either goes back to the customer or stays with us as their
            // credit, where the next invoice uses it. Both are one tap; neither is the default.
            <div className="space-y-2">
              <p className="text-muted-foreground text-xs">{ti("overpaidHint")}</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Button type="button" variant="outline" className="gap-1.5" onClick={moveToCredit} disabled={pending}>
                  <ArrowRightLeft className="size-3.5" aria-hidden />{" "}
                  {ti("moveToCredit", { amount: formatMoney(Math.abs(balance.outstanding), currency) })}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => {
                    setAmount(String(Math.abs(balance.outstanding)));
                    setPaidAt(data.today);
                    setRefunding(true);
                  }}
                  disabled={pending}
                >
                  <Undo2 className="size-3.5" aria-hidden />{" "}
                  {ti("refund", { amount: formatMoney(Math.abs(balance.outstanding), currency) })}
                </Button>
              </div>
            </div>
          ))}

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
                    max={data.today}
                    value={paidAt}
                    onChange={(e) => setPaidAt(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                <div className="space-y-1.5">
                  <Label htmlFor="invoice-payment-reference" className="text-xs">
                    {t("reference")}
                  </Label>
                  <Input
                    id="invoice-payment-reference"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder={t("referencePlaceholder")}
                  />
                </div>
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
            <Button type="button" variant="outline" className="w-full gap-1.5" onClick={openAdd} disabled={pending}>
              <Plus className="size-3.5" aria-hidden /> {t("addPayment")}
            </Button>
          ))}
      </CardContent>
    </Card>
  );
}
