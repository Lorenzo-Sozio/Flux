"use client";

import { useMemo, useState, useTransition } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { BanknoteIcon, DownloadIcon, Loader2, Plus, Undo2, WalletIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";

import { type getCustomerMoney, recordCustomerReceiptAction, recordRefundAction } from "@/actions/receipts";
import { ReceiptEditDialog } from "@/components/crm/receipt-edit-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCurrency } from "@/hooks/use-currency";
import { isRecordablePayment, parsePaymentAmount } from "@/lib/order-payment";

type Money = NonNullable<Awaited<ReturnType<typeof getCustomerMoney>>>;

/**
 * A customer's money (I10): what they still owe, the credit they have with us, and the
 * transfers that arrived — each with the invoices it paid.
 *
 * ⚠️⚠️ One transfer, several invoices. A customer who settles three invoices with one bank
 * transfer used to be written down as three payments, or as one on the wrong invoice. Here the
 * amount that arrived is typed once and shared across their open invoices, the oldest due
 * first — a proposal the person can change line by line; what is not shared stays as their
 * credit, which a later invoice uses in one click.
 */
export function CustomerMoneyCard({
  companyId,
  data,
  canWrite,
}: {
  companyId: string;
  data: Money;
  canWrite: boolean;
}) {
  const t = useTranslations("receipts");
  const tS = useTranslations("statement");
  const format = useFormatter();
  const router = useRouter();
  const { formatMoney } = useCurrency();
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState("");
  // The workspace's day, not the browser's: an evening payment typed abroad was dated tomorrow.
  const [day, setDay] = useState(data.today);
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");
  // Typed shares, by invoice; an invoice not typed takes the proposal.
  const [typed, setTyped] = useState<Record<string, string>>({});

  // ⚠️ A transfer is in one currency. The card offers every currency the customer owes or holds
  // credit in, the one owed longest first; what is owed is shown per currency, never summed.
  const currencies = useMemo(
    () => [...new Set([...data.owed.map((i) => i.currency), ...data.credit.map((c) => c.currency), "EUR"])],
    [data.owed, data.credit],
  );
  const [currency, setCurrency] = useState(currencies[0]);
  const owed = useMemo(() => data.owed.filter((i) => i.currency === currency), [data.owed, currency]);
  const owedByCurrency = useMemo(() => {
    const out = new Map<string, number>();
    for (const i of data.owed)
      out.set(i.currency, Math.round(((out.get(i.currency) ?? 0) + i.outstanding) * 100) / 100);
    return [...out];
  }, [data.owed]);

  // The proposal: what arrived, shared oldest due first, never beyond what each owes.
  const proposal = useMemo(() => {
    let left = parsePaymentAmount(amount) ?? 0;
    const out: Record<string, number> = {};
    for (const i of [...owed].sort((a, b) => a.dueDate.localeCompare(b.dueDate))) {
      const share = Math.round(Math.min(left, i.outstanding) * 100) / 100;
      out[i.id] = share > 0 ? share : 0;
      left = Math.round((left - out[i.id]) * 100) / 100;
    }
    return out;
  }, [amount, owed]);

  const shares = owed.map((i) => ({
    invoiceId: i.id,
    amount: typed[i.id] !== undefined ? (parsePaymentAmount(typed[i.id]) ?? 0) : proposal[i.id],
  }));
  const shared = Math.round(shares.reduce((s, x) => s + x.amount, 0) * 100) / 100;
  const received = parsePaymentAmount(amount) ?? 0;
  const toCredit = Math.round((received - shared) * 100) / 100;

  function record() {
    if (!isRecordablePayment(amount)) {
      toast.error(t("amountInvalid"));
      return;
    }
    if (toCredit < 0) {
      toast.error(t("sharesExceed"));
      return;
    }
    startTransition(async () => {
      const r = await recordCustomerReceiptAction(companyId, {
        amount,
        paidAt: day,
        method,
        reference,
        currency,
        allocations: shares.filter((s) => s.amount > 0),
      }).catch(() => null);
      if (!r?.ok) {
        toast.error(r && !r.ok ? r.error : t("recordFailed"));
        return;
      }
      toast.success(
        toCredit > 0 ? t("recordedWithCredit", { amount: formatMoney(toCredit, currency) }) : t("recorded"),
      );
      setAdding(false);
      setAmount("");
      setDay(data.today);
      setMethod("");
      setReference("");
      setTyped({});
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <BanknoteIcon className="size-4 text-muted-foreground" aria-hidden />
          {t("title")}
        </CardTitle>
        {/* Every document and payment with the balance after each, for the customer's accountant (I14). */}
        <Button variant="outline" size="sm" className="gap-1.5" asChild>
          <a href={`/api/companies/${encodeURIComponent(companyId)}/statement`} download>
            <DownloadIcon className="size-3.5" aria-hidden /> {tS("export")}
          </a>
        </Button>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="space-y-1.5">
          {owedByCurrency.length === 0 ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{t("owed")}</span>
              <span className="tabular-nums">—</span>
            </div>
          ) : (
            owedByCurrency.map(([c, total]) => (
              <div key={c} className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{t("owed")}</span>
                <span className="tabular-nums">{formatMoney(total, c)}</span>
              </div>
            ))
          )}
          {data.credit
            .filter((c) => c.credit > 0.005)
            .map((c) => (
              <CreditRow
                key={c.currency}
                companyId={companyId}
                currency={c.currency}
                credit={c.credit}
                today={data.today}
                canWrite={canWrite}
              />
            ))}
        </div>

        {canWrite &&
          (adding ? (
            <div className="space-y-3 rounded-md border bg-muted/20 p-3">
              {/* One column: this card lives in the side column, a phone's width even on a desktop. */}
              <div className="grid grid-cols-1 gap-3">
                {currencies.length > 1 && (
                  <div className="space-y-1.5">
                    <Label htmlFor="receipt-currency" className="text-xs">
                      {t("currency")}
                    </Label>
                    <select
                      id="receipt-currency"
                      value={currency}
                      onChange={(e) => {
                        setCurrency(e.target.value);
                        setTyped({});
                      }}
                      className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                    >
                      {currencies.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="receipt-amount" className="text-xs">
                    {t("amountReceived", { currency })}
                  </Label>
                  <Input
                    id="receipt-amount"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      setTyped({});
                    }}
                    className="tabular-nums"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="receipt-day" className="text-xs">
                    {t("date")}
                  </Label>
                  <Input
                    id="receipt-day"
                    type="date"
                    max={data.today}
                    value={day}
                    onChange={(e) => setDay(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="receipt-method" className="text-xs">
                    {t("method")}
                  </Label>
                  <Input
                    id="receipt-method"
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                    placeholder={t("methodPlaceholder")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="receipt-reference" className="text-xs">
                    {t("reference")}
                  </Label>
                  <Input
                    id="receipt-reference"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder={t("referencePlaceholder")}
                  />
                </div>
              </div>

              {owed.length > 0 && (
                <div className="space-y-1.5">
                  <p className="font-medium text-xs">{t("shareAcross")}</p>
                  <ul className="divide-y rounded-md border bg-background">
                    {owed.map((i) => (
                      <li key={i.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-xs">{i.documentNumber ?? t("unnumbered")}</p>
                          <p className="truncate text-muted-foreground text-xs">
                            {t("owesDue", {
                              amount: formatMoney(i.outstanding, i.currency),
                              date: format.dateTime(new Date(`${i.dueDate}T12:00:00`), { dateStyle: "medium" }),
                            })}
                          </p>
                        </div>
                        <Input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="0.01"
                          aria-label={t("shareFor", { number: i.documentNumber ?? t("unnumbered") })}
                          className="h-8 w-28 shrink-0 text-right tabular-nums"
                          value={typed[i.id] ?? (proposal[i.id] ? String(proposal[i.id]) : "")}
                          onChange={(e) => setTyped((prev) => ({ ...prev, [i.id]: e.target.value }))}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {received > 0 && (
                <p className={toCredit < 0 ? "text-destructive text-xs" : "text-muted-foreground text-xs"}>
                  {toCredit < 0
                    ? t("sharesExceed")
                    : toCredit > 0
                      ? t("restToCredit", { amount: formatMoney(toCredit, currency) })
                      : t("allShared")}
                </p>
              )}

              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setAdding(false)} disabled={pending}>
                  {t("cancel")}
                </Button>
                <Button type="button" onClick={record} disabled={pending} className="gap-1.5">
                  {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                  {t("record")}
                </Button>
              </div>
            </div>
          ) : (
            <Button type="button" variant="outline" className="w-full gap-1.5" onClick={() => setAdding(true)}>
              <Plus className="size-3.5" aria-hidden /> {t("add")}
            </Button>
          ))}

        {data.receipts.length > 0 && (
          <ul className="divide-y rounded-md border">
            {data.receipts.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-2 py-1.5 pr-1 pl-3">
                <div className="min-w-0">
                  <p
                    className={
                      Number(r.amount) < 0 ? "font-medium text-destructive tabular-nums" : "font-medium tabular-nums"
                    }
                  >
                    {formatMoney(Number(r.amount), r.currency)}
                  </p>
                  <p className="truncate text-muted-foreground text-xs">
                    {format.dateTime(new Date(r.receivedAt), { dateStyle: "medium" })}
                    {r.method ? ` · ${r.method}` : ""}
                    {r.reference ? ` · ${r.reference}` : ""}
                  </p>
                  <p className="flex flex-wrap gap-x-2 text-xs">
                    {r.allocations.length === 0 ? (
                      <span className="text-emerald-700 dark:text-emerald-400">{t("allCredit")}</span>
                    ) : (
                      r.allocations.map((a, i) =>
                        a.invoiceId ? (
                          <Link
                            key={`${a.invoiceId}-${i}`}
                            href={`/dashboard/sales/invoices/${a.invoiceId}`}
                            className="text-primary hover:underline"
                          >
                            {a.invoiceNumber ?? t("unnumbered")} · {formatMoney(Number(a.amount), r.currency)}
                          </Link>
                        ) : (
                          <Link
                            key={`${a.orderId}-${i}`}
                            href={`/dashboard/sales/orders/${a.orderId}`}
                            className="text-amber-700 hover:underline dark:text-amber-400"
                          >
                            {t("depositShort")} · {formatMoney(Number(a.amount), r.currency)}
                          </Link>
                        ),
                      )
                    )}
                  </p>
                </div>
                {canWrite && Number(r.amount) > 0 && (
                  <ReceiptEditDialog
                    receipt={{
                      id: r.id,
                      amount: r.amount,
                      receivedAt: r.receivedAt,
                      method: r.method,
                      reference: r.reference,
                      note: r.note,
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The customer's credit in one currency and, for whoever may, giving it back. A refund is a
 * negative receipt: the database refuses one larger than the credit, whoever else spends it at
 * the same moment.
 */
function CreditRow({
  companyId,
  currency,
  credit,
  today,
  canWrite,
}: {
  companyId: string;
  currency: string;
  credit: number;
  today: string;
  canWrite: boolean;
}) {
  const t = useTranslations("receipts");
  const router = useRouter();
  const { formatMoney } = useCurrency();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState(String(credit));
  const [day, setDay] = useState(today);
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");
  const id = `refund-${currency}`;

  function refund() {
    const value = parsePaymentAmount(amount);
    if (value === null || value <= 0) {
      toast.error(t("amountInvalid"));
      return;
    }
    if (value > credit + 0.005) {
      toast.error(t("refundOverCredit", { amount: formatMoney(credit, currency) }));
      return;
    }
    startTransition(async () => {
      const r = await recordRefundAction({ companyId, currency, amount, paidAt: day, method, reference }).catch(
        () => null,
      );
      if (!r?.ok) {
        toast.error(r && !r.ok ? r.error : t("refundFailed"));
        return;
      }
      toast.success(t("refunded", { amount: formatMoney(value, currency) }));
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 font-medium text-emerald-700 dark:text-emerald-400">
        <span className="flex min-w-0 items-center gap-1.5">
          <WalletIcon className="size-3.5 shrink-0" aria-hidden />
          {t("credit")}
        </span>
        <span className="flex items-center gap-1">
          <span className="tabular-nums">{formatMoney(credit, currency)}</span>
          {canWrite && !open && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => {
                setAmount(String(credit));
                setDay(today);
                setOpen(true);
              }}
            >
              <Undo2 className="size-3.5" aria-hidden /> {t("refund")}
            </Button>
          )}
        </span>
      </div>
      {open && (
        <div className="space-y-3 rounded-md border bg-muted/20 p-3">
          <div className="grid grid-cols-1 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-amount`} className="text-xs">
                {t("refundAmount", { currency })}
              </Label>
              <Input
                id={`${id}-amount`}
                type="number"
                inputMode="decimal"
                min="0"
                max={credit}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-day`} className="text-xs">
                {t("refundDate")}
              </Label>
              <Input id={`${id}-day`} type="date" max={today} value={day} onChange={(e) => setDay(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-method`} className="text-xs">
                {t("method")}
              </Label>
              <Input
                id={`${id}-method`}
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                placeholder={t("methodPlaceholder")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-reference`} className="text-xs">
                {t("reference")}
              </Label>
              <Input
                id={`${id}-reference`}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder={t("referencePlaceholder")}
              />
            </div>
          </div>
          <p className="text-muted-foreground text-xs">{t("refundHint")}</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              {t("cancel")}
            </Button>
            <Button type="button" onClick={refund} disabled={pending} className="gap-1.5">
              {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              {t("refundConfirm")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
