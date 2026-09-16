"use client";

import { useMemo, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { CheckCircle2, ChevronLeft, CircleAlert, ExternalLink, Loader2, Receipt } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { createInvoice, type getNewInvoiceData, getOrderForInvoice, issueInvoiceAction } from "@/actions/invoices";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { addDays } from "@/lib/contract-terms";
import { invoiceTotals } from "@/lib/fatturapa/totals";
import { customerGaps } from "@/lib/fiscal-ids";
import { PAYMENT_METHODS } from "@/lib/invoice-draft";
import { draftProblems } from "@/lib/invoice-rules";
import { assessStampDuty, type StampMode, withStampRecharge } from "@/lib/stamp-duty";

import { asDraftLines, blankLine, type EditableLine, editableFields, num } from "../../_components/invoice-lines";
import { InvoiceLinesTable, InvoiceTotals } from "../../_components/invoice-parts";

type Data = Awaited<ReturnType<typeof getNewInvoiceData>>;
type Order = Data["orders"][number];

const NO_ORDER = "__none__";

/**
 * Writing an invoice, on one page.
 *
 * Customer, lines, payment and stamp duty are all in front of the person at once,
 * with the totals and what is still missing beside them, and the page ends in
 * either "Save draft" or "Issue". An order is not a separate way in: it is a
 * shortcut that fills the lines in, and they stay editable.
 */
export function NewInvoiceForm({
  data,
  today,
  initialOrder,
  canIssue,
}: {
  data: Data;
  today: string;
  initialOrder: {
    id: string;
    companyId: string | null;
    currency: string;
    discountPercent: number;
    lines: EditableLine[];
  } | null;
  canIssue: boolean;
}) {
  const t = useTranslations("invoices");
  const tn = useTranslations("invoices.new");
  const tI = useTranslations("invoicing");
  const router = useRouter();

  const [companyId, setCompanyId] = useState(initialOrder?.companyId ?? "");
  const [orderId, setOrderId] = useState(initialOrder?.id ?? "");
  const [currency, setCurrency] = useState(initialOrder?.currency ?? "EUR");
  const [lines, setLines] = useState<EditableLine[]>(() => initialOrder?.lines ?? [blankLine()]);
  const [discount, setDiscount] = useState(String(initialOrder?.discountPercent ?? 0));
  const [paymentMethod, setPaymentMethod] = useState("MP05");
  const [dueDate, setDueDate] = useState(addDays(today, 30));
  const [series, setSeries] = useState("");
  const [stampMode, setStampMode] = useState<StampMode>("auto");
  const [stampNote, setStampNote] = useState("");
  const [notes, setNotes] = useState("");
  const [loadingOrder, setLoadingOrder] = useState(false);
  const [busy, setBusy] = useState<"draft" | "issue" | null>(null);
  const [confirmIssue, setConfirmIssue] = useState(false);

  const company = data.companies.find((c) => c.id === companyId) ?? null;
  const order: Order | null = data.orders.find((o) => o.id === orderId) ?? null;
  const ordersForCustomer = companyId ? data.orders.filter((o) => o.companyId === companyId) : data.orders;

  const draftLines = useMemo(() => asDraftLines(lines), [lines]);
  const stamp = assessStampDuty(draftLines, num(discount), stampMode);
  const rechargeLine = stamp.applied && data.rechargeStamp;
  const totals = invoiceTotals(withStampRecharge(draftLines, stamp.applied, data.rechargeStamp), num(discount));
  const money = (n: number) => new Intl.NumberFormat("it-IT", { style: "currency", currency }).format(n);

  const customerProblems = company ? customerGaps(company) : [];
  const problems = [
    ...(company
      ? []
      : [{ key: "no-customer", text: tn("chooseCustomerFirst"), href: undefined as string | undefined }]),
    ...data.issuerGaps.map((g) => ({
      key: `i-${g.field}`,
      text: `${t("issuerLabel")}: ${tI(`fields.${g.field}` as "fields.vatNumber")} — ${tI(`problems.${g.problem}`)}`,
      href: "/dashboard/settings/invoicing",
    })),
    ...customerProblems.map((g) => ({
      key: `c-${g.field}`,
      text: `${t("customerLabel")}: ${tI(`fields.${g.field}` as "fields.vatNumber")} — ${tI(`problems.${g.problem}`)}`,
      href: company ? `/dashboard/companies/${company.id}` : undefined,
    })),
    ...draftProblems(draftLines, num(discount), { mode: stampMode, note: stampNote }).map((p) => ({
      key: `d-${p.kind}-${"line" in p ? p.line : ""}`,
      text: t(`problems.${p.kind}`, { line: "line" in p ? p.line : 0 }),
      href: undefined,
    })),
  ];

  /** Picking an order fills the customer, the lines and the discount; everything stays editable. */
  const chooseOrder = async (value: string) => {
    if (value === NO_ORDER) {
      setOrderId("");
      return;
    }
    const picked = data.orders.find((o) => o.id === value);
    if (!picked) return;
    setLoadingOrder(true);
    try {
      const loaded = await getOrderForInvoice(value);
      if (!loaded) {
        toast.error(tn("orderGone"));
        return;
      }
      setOrderId(value);
      if (loaded.companyId) setCompanyId(loaded.companyId);
      setCurrency(loaded.currency);
      setDiscount(String(loaded.discountPercent));
      setLines(
        loaded.lines.length ? loaded.lines.map((l) => ({ ...blankLine(), ...editableFields(l) })) : [blankLine()],
      );
      toast.success(tn("orderLoaded", { number: picked.orderNumber, count: loaded.lines.length }));
    } finally {
      setLoadingOrder(false);
    }
  };

  const save = async (): Promise<{ id: string; revision: number } | null> => {
    if (!company) {
      toast.error(tn("chooseCustomerFirst"));
      return null;
    }
    const result = await createInvoice({
      companyId: company.id,
      orderId: orderId || null,
      currency,
      series,
      dueDate: dueDate || null,
      discountPercent: num(discount),
      stampDutyMode: stampMode,
      stampDutyNote: stampNote,
      paymentMethod,
      notes,
      lines: draftLines,
    });
    if (!result.ok) {
      if (result.existingId) {
        toast.error(tn("orderHasDraft"), {
          action: {
            label: tn("openDraft"),
            onClick: () => router.push(`/dashboard/sales/invoices/${result.existingId}`),
          },
        });
      } else {
        toast.error(result.error);
      }
      return null;
    }
    return result;
  };

  const onSaveDraft = async () => {
    setBusy("draft");
    try {
      const saved = await save();
      if (!saved) return;
      toast.success(t("saved"));
      router.push(`/dashboard/sales/invoices/${saved.id}`);
    } finally {
      setBusy(null);
    }
  };

  const onIssue = async () => {
    setConfirmIssue(false);
    setBusy("issue");
    try {
      const saved = await save();
      if (!saved) return;
      const issued = await issueInvoiceAction(saved.id, saved.revision);
      if (issued.ok) toast.success(t("issuedToast", { number: issued.documentNumber }));
      // Saved but refused: the draft exists, and its page lists what is missing.
      else toast.error(tn("savedNotIssued"));
      router.push(`/dashboard/sales/invoices/${saved.id}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── The bar that stays put ── */}
      <div className="-mx-4 md:-mx-6 sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-9 w-9 shrink-0">
            <Link href="/dashboard/sales/invoices" aria-label={t("back")}>
              <ChevronLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Receipt className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate font-bold text-lg tracking-tight">{t("newInvoice")}</h1>
            <p className="hidden truncate text-muted-foreground text-xs sm:block">{tn("subtitle")}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-2 flex items-baseline gap-2">
            <span className="text-muted-foreground text-xs uppercase tracking-wide">{t("total")}</span>
            <span className="font-bold text-base tabular-nums">{money(totals.total)}</span>
          </div>
          <Button variant={canIssue ? "outline" : "default"} onClick={onSaveDraft} disabled={busy !== null || !company}>
            {busy === "draft" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {tn("saveDraft")}
          </Button>
          {canIssue && (
            <Button onClick={() => setConfirmIssue(true)} disabled={busy !== null || problems.length > 0}>
              {busy === "issue" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t("issue")}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="min-w-0 space-y-6 xl:col-span-8">
          {/* ── Customer ── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="font-semibold text-muted-foreground text-sm uppercase tracking-wide">
                {tn("customerTitle")}
              </CardTitle>
              <CardDescription>{tn("customerHint")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>
                    {t("customer")}
                    <span className="ml-0.5 text-destructive">*</span>
                  </Label>
                  <SearchableSelect
                    options={data.companies.map((c) => ({
                      value: c.id,
                      label: c.name,
                      sublabel: c.vatNumber ?? undefined,
                    }))}
                    value={companyId}
                    onChange={(v) => {
                      setCompanyId(v);
                      if (order && order.companyId !== v) setOrderId("");
                    }}
                    placeholder={tn("chooseCustomer")}
                    searchPlaceholder={tn("searchCustomer")}
                    emptyText={tn("noCustomers")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{tn("fromOrder")}</Label>
                  <SearchableSelect
                    options={[
                      { value: NO_ORDER, label: tn("noOrder") },
                      ...ordersForCustomer.map((o) => ({
                        value: o.id,
                        label: `${o.orderNumber} — ${o.companyName ?? "—"}`,
                        sublabel: `${o.createdAt} · ${new Intl.NumberFormat("it-IT", { style: "currency", currency: o.currency }).format(Number(o.total))}${o.draftId ? ` · ${tn("hasDraft")}` : ""}`,
                      })),
                    ]}
                    value={orderId || NO_ORDER}
                    onChange={chooseOrder}
                    disabled={loadingOrder}
                    placeholder={tn("noOrder")}
                    searchPlaceholder={tn("searchOrder")}
                    emptyText={tn("noOrders")}
                  />
                  <p className="text-muted-foreground text-xs">
                    {loadingOrder ? tn("loadingOrder") : tn("fromOrderHint")}
                  </p>
                  {order?.draftId && (
                    <Link
                      href={`/dashboard/sales/invoices/${order.draftId}`}
                      className="inline-flex items-center gap-1 text-amber-700 text-xs underline dark:text-amber-400"
                    >
                      {tn("orderHasDraft")} {tn("openDraft")}
                    </Link>
                  )}
                </div>
              </div>

              {company && (
                <div className="rounded-md border bg-muted/30 p-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-0.5">
                      <p className="font-medium">{company.name}</p>
                      <p className="text-muted-foreground text-xs">
                        {[
                          company.vatNumber && `${tI("fields.vatNumber")} ${company.vatNumber}`,
                          company.fiscalCode && `${tI("fields.fiscalCode")} ${company.fiscalCode}`,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {[
                          company.street,
                          [company.zipCode, company.city].filter(Boolean).join(" "),
                          company.province,
                          company.country,
                        ]
                          .filter(Boolean)
                          .join(", ") || "—"}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {company.sdiCode
                          ? `${tI("fields.sdiCode")}: ${company.sdiCode}`
                          : company.pec
                            ? `${tI("fields.pec")}: ${company.pec}`
                            : "—"}
                      </p>
                    </div>
                    {customerProblems.length === 0 ? (
                      <Badge variant="secondary" className="gap-1">
                        <CheckCircle2 className="h-3 w-3" /> {tn("customerReady")}
                      </Badge>
                    ) : (
                      <Button asChild variant="outline" size="sm" className="gap-1">
                        <Link href={`/dashboard/companies/${company.id}`} target="_blank">
                          {tn("completeCustomer")} <ExternalLink className="h-3 w-3" />
                        </Link>
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Lines ── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="font-semibold text-muted-foreground text-sm uppercase tracking-wide">
                {t("lines")}
              </CardTitle>
              <CardDescription>{tn("linesHint")}</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <InvoiceLinesTable
                lines={lines}
                onChange={setLines}
                editable
                totals={totals}
                rechargeLine={rechargeLine}
                money={money}
                products={data.products}
              />
            </CardContent>
          </Card>

          {/* ── Payment and details ── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="font-semibold text-muted-foreground text-sm uppercase tracking-wide">
                {tn("paymentTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("paymentMethod")}</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PAYMENT_METHODS).map(([code, label]) => (
                      <SelectItem key={code} value={code}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-inv-due">{t("dueDate")}</Label>
                <Input id="new-inv-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-inv-discount">{t("documentDiscount")}</Label>
                <Input
                  id="new-inv-discount"
                  inputMode="decimal"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-inv-series">{t("series")}</Label>
                <Input
                  id="new-inv-series"
                  value={series}
                  placeholder={t("mainSeries")}
                  onChange={(e) => setSeries(e.target.value)}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="new-inv-notes">{t("notes")}</Label>
                <Textarea
                  id="new-inv-notes"
                  rows={2}
                  value={notes}
                  placeholder={tn("notesPlaceholder")}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── Summary: totals, stamp, what is missing ── */}
        <div className="min-w-0 space-y-6 xl:col-span-4">
          <div className="space-y-6 xl:sticky xl:top-20">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="font-semibold text-muted-foreground text-sm uppercase tracking-wide">
                  {tn("summaryTitle")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <InvoiceTotals totals={totals} money={money} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="font-semibold text-muted-foreground text-sm uppercase tracking-wide">
                    {t("stampTitle")}
                  </CardTitle>
                  <Badge variant={stamp.applied ? "secondary" : "outline"}>
                    {stamp.applied ? t("stampApplied") : t("stampNotApplied")}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-muted-foreground text-xs">
                  {t(`stampReasons.${stamp.reason}`, { base: money(stamp.base), exempt: money(stamp.exemptBase) })}
                </p>
                <Select value={stampMode} onValueChange={(v) => setStampMode(v as StampMode)}>
                  <SelectTrigger aria-label={t("stampTitle")} className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">{t("stampModes.auto")}</SelectItem>
                    <SelectItem value="force_on">{t("stampModes.force_on")}</SelectItem>
                    <SelectItem value="force_off">{t("stampModes.force_off")}</SelectItem>
                  </SelectContent>
                </Select>
                {stampMode !== "auto" && (
                  <Input
                    aria-label={t("stampReasonLabel")}
                    placeholder={t("stampReasonPlaceholder")}
                    value={stampNote}
                    onChange={(e) => setStampNote(e.target.value)}
                  />
                )}
                {stamp.applied && (
                  <p className="text-muted-foreground text-xs">
                    {data.rechargeStamp ? t("stampRecharged") : t("stampBorne")}
                  </p>
                )}
              </CardContent>
            </Card>

            <Card
              className={
                problems.length ? "border-amber-300 dark:border-amber-800" : "border-green-300 dark:border-green-800"
              }
            >
              <CardContent className="flex gap-3 p-4 text-sm">
                {problems.length ? (
                  <>
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <div className="min-w-0">
                      <p className="font-medium">{t("cannotIssue")}</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                        {problems.map((p) => (
                          <li key={p.key}>
                            {p.href ? (
                              <Link href={p.href} target="_blank" className="underline">
                                {p.text}
                              </Link>
                            ) : (
                              p.text
                            )}
                          </li>
                        ))}
                      </ul>
                      <p className="mt-2 text-muted-foreground text-xs">{tn("draftAnyway")}</p>
                    </div>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                    <p className="min-w-0">{canIssue ? tn("readyToIssue") : tn("readyNoPermission")}</p>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <AlertDialog open={confirmIssue} onOpenChange={setConfirmIssue}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("issueTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("issueDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={onIssue}>{t("issue")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
