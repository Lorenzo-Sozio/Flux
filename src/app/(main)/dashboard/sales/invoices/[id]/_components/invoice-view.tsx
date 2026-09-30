"use client";

import { useMemo, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  BanknoteIcon,
  BuildingIcon,
  CalendarIcon,
  CircleAlert,
  FileCode2,
  FileTextIcon,
  FolderIcon,
  InfoIcon,
  MoreHorizontal,
  ShoppingCartIcon,
  Trash2,
  Undo2Icon,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";

import {
  deleteInvoiceDraft,
  type getInvoice,
  type IssueBlockers,
  issueInvoiceAction,
  saveInvoiceDraft,
} from "@/actions/invoices";
import { PAYMENT_TONE } from "@/app/(main)/dashboard/sales/orders/[id]/_components/order-tones";
import { EmailAddressButton } from "@/components/crm/email-address-button";
import { PaymentTermsField } from "@/components/crm/payment-terms-field";
import {
  Field,
  FieldList,
  MetaItem,
  Metric,
  MetricStrip,
  RecordHero,
  StatusBadge,
} from "@/components/crm/record/record-page";
import { RecordSections } from "@/components/crm/record/record-sections";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCurrency } from "@/hooks/use-currency";
import { useMessageText } from "@/hooks/use-message-text";
import { type InvoiceLine, invoiceTotals } from "@/lib/fatturapa/totals";
import { italianToday, PAYMENT_METHODS } from "@/lib/invoice-draft";
import { draftProblems } from "@/lib/invoice-rules";
import { installmentStates, installmentsMatch, type PaymentTerms } from "@/lib/payment-terms";
import type { SdiChannel, SdiStatus } from "@/lib/sdi/types";
import { assessStampDuty, type StampMode, withStampRecharge } from "@/lib/stamp-duty";

import { asDraftLines, type EditableLine, num } from "../../_components/invoice-lines";
import { InvoiceLinesTable, InvoiceTotals } from "../../_components/invoice-parts";
import { CreditNoteButton, CreditNotesCard } from "./credit-notes";
import { InvoicePaymentsCard } from "./invoice-payments";
import { DownloadPdfButton, IssuedInvoiceFiles, SendInvoiceCopyButton } from "./issued-invoice-files";
import { OverdueBanner } from "./payment-reminder";
import { SdiPanel } from "./sdi-panel";

type Data = NonNullable<Awaited<ReturnType<typeof getInvoice>>>;

/** The customer as the invoice froze it at issue — see `customerSnapshot` in src/lib/invoice-draft.ts. */
interface CustomerSnapshot {
  name?: string | null;
  vatNumber?: string | null;
  fiscalCode?: string | null;
  sdiCode?: string | null;
  pec?: string | null;
  street?: string | null;
  zipCode?: string | null;
  city?: string | null;
  province?: string | null;
  country?: string | null;
}

const DAY = 86_400_000;

/**
 * One invoice or credit note, laid out as the other record pages are.
 *
 * ⚠️⚠️ Presentation only. Every figure on this screen comes from the same calls it
 * always did — `invoiceTotals` for the arithmetic, `assessStampDuty` and
 * `withStampRecharge` for the stamp, `draftProblems` for what blocks an issue — and
 * every write goes through the same actions (save, issue, delete, credit, archive,
 * send). The fiscal rules are in CLAUDE.md under "The FatturaPA file" and "Credit
 * notes"; nothing here decides any of them, it only decides where they are drawn.
 *
 * The hero says which document it is, whose, and what it is worth; the work column
 * holds the lines and the totals (and, on a draft, the fields still to fill in); the
 * side column holds the customer as frozen, the files and the credit notes.
 */
export function InvoiceView({
  data,
  canWrite,
  canIssue,
  orderNumber,
  payments,
  sdi,
}: {
  data: Data;
  canWrite: boolean;
  canIssue: boolean;
  /** The order this invoice was written from, by number, when there is one. */
  orderNumber: string | null;
  /** An issued invoice's payments and balance (I9); null for a draft or a credit note. */
  payments: Parameters<typeof InvoicePaymentsCard>[0]["data"] | null;
  /** How the workspace reaches SDI today (src/lib/sdi/). */
  sdi: { channel: SdiChannel; providerLabel: string | null };
}) {
  const t = useTranslations("invoices");
  const say = useMessageText();
  const tI = useTranslations("invoicing");
  const tR = useTranslations("record");
  const tT = useTranslations("invoices.terms");
  const tP = useTranslations("orders.payments");
  const format = useFormatter();
  const router = useRouter();
  const { formatMoney } = useCurrency();
  const { invoice } = data;
  const isDraft = invoice.status === "draft";
  const editable = isDraft && canWrite;

  const [revision, setRevision] = useState(invoice.revision);
  const [series, setSeries] = useState(invoice.series);
  const [dueDate, setDueDate] = useState(invoice.dueDate ?? "");
  const [discount, setDiscount] = useState(String(Number(invoice.discountPercent)));
  const [stampMode, setStampMode] = useState<StampMode>(invoice.stampDutyMode as StampMode);
  const [stampNote, setStampNote] = useState(invoice.stampDutyNote ?? "");
  const [paymentMethod, setPaymentMethod] = useState(invoice.paymentMethod);
  const [terms, setTerms] = useState<PaymentTerms | null>(invoice.paymentTerms ?? null);
  const [notes, setNotes] = useState(invoice.notes ?? "");
  const [lines, setLines] = useState<EditableLine[]>(() => {
    // An issued invoice is read from what was frozen when it was issued.
    const source = isDraft
      ? data.items.map((i) => ({ ...i, quantity: Number(i.quantity), unitPrice: Number(i.unitPrice) }))
      : ((invoice.linesSnapshot as EditableLine[] | null) ?? []);
    return source.map((l, i) => ({
      key: `l${i}`,
      productId: (l as { productId?: string | null }).productId ?? null,
      description: String(l.description ?? ""),
      quantity: String(Number(l.quantity)),
      unitPrice: String(Number(l.unitPrice)),
      discountPercent: String(Number(l.discountPercent ?? 0)),
      taxPercent: String(Number(l.taxPercent)),
      nature: (l.nature as string | null) ?? "",
    }));
  });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmIssue, setConfirmIssue] = useState(false);
  // What the server said when an issue was refused; otherwise the freshly loaded checks,
  // which router.refresh() replaces after the profile or the customer is fixed elsewhere.
  const [refused, setRefused] = useState<IssueBlockers | null>(null);
  const blockers = refused ?? data.blockers;

  const draftLines = useMemo(() => asDraftLines(lines), [lines]);
  // A balance invoice's deposits come off in generated lines (I11): part of the totals and the
  // stamp while it is a draft, frozen with the rest once issued.
  const deductions = isDraft ? data.deductions : [];
  // A draft decides the stamp live from its lines; an issued invoice shows what was frozen.
  const stamp = assessStampDuty([...draftLines, ...deductions], num(discount), stampMode);
  const stampApplied = isDraft ? stamp.applied : invoice.stampDuty;
  const rechargeLine = isDraft && stamp.applied && data.rechargeStamp;
  const totalledLines = isDraft
    ? withStampRecharge(
        [...draftLines, ...deductions].map((l) => ({ ...l, description: l.description ?? "" })),
        stamp.applied,
        data.rechargeStamp,
      )
    : // ⚠️⚠️ Issued: the frozen lines as they were totalled, stamp recharge and deductions marked.
      // Passed through the editable form they lost their marks, and the page applied the
      // document discount to the €2 stamp and to the deposits taken off: a total the XML, the
      // PDF and the customer never saw.
      ((invoice.linesSnapshot as InvoiceLine[] | null) ?? []).map((l) => ({ ...l, description: l.description ?? "" }));
  const totals = invoiceTotals(totalledLines, num(discount));
  // The draft checks run on the screen as typed, so the list of what is missing moves with the edit.
  const isCredit = invoice.documentType === "TD04";
  const isDeposit = invoice.documentType === "TD02";
  const liveDraftProblems = isDraft
    ? draftProblems(draftLines, num(discount), { mode: stampMode, note: stampNote }, deductions)
    : [];
  // A credit note cannot give back more than is left on its invoice; the issuing
  // statement enforces it, this says so while the lines are being edited.
  if (isDraft && isCredit) {
    if (!data.original) liveDraftProblems.push({ kind: "credit_without_original" });
    else if (totals.total > data.original.residual) liveDraftProblems.push({ kind: "credit_exceeds_residual" });
  }
  if (isDraft && invoice.currency !== "EUR") liveDraftProblems.push({ kind: "currency_not_eur" });
  if (isDraft && !isCredit && terms && "custom" in terms && terms.custom.some((i) => i.dueDate < italianToday()))
    liveDraftProblems.push({ kind: "installment_before_issue" });
  // Installments written by hand add up to the total as it is now, edit by edit (I12).
  if (isDraft && !isCredit && terms && "custom" in terms && !installmentsMatch(terms.custom, totals.total))
    liveDraftProblems.push({ kind: "installments_total" });
  const money = (n: number) => formatMoney(n, invoice.currency);

  const touch =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setDirty(true);
    };

  const save = async (): Promise<number | null> => {
    const result = await saveInvoiceDraft(invoice.id, revision, {
      series,
      dueDate: dueDate || null,
      discountPercent: num(discount),
      stampDutyMode: stampMode,
      stampDutyNote: stampNote,
      paymentMethod,
      paymentTerms: terms,
      notes,
      lines: draftLines,
    });
    if (!result.ok) {
      toast.error(say(result));
      return null;
    }
    setRevision(result.revision);
    setDirty(false);
    return result.revision;
  };

  const onSave = async () => {
    setBusy(true);
    try {
      if ((await save()) !== null) {
        toast.success(t("saved"));
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const onIssue = async () => {
    setBusy(true);
    try {
      const rev = dirty ? await save() : revision;
      if (rev === null) return;
      const result = await issueInvoiceAction(invoice.id, rev);
      if (!result.ok) {
        if (result.blockers) setRefused(result.blockers);
        toast.error(result.error);
        return;
      }
      setRefused(null);
      toast.success(t("issuedToast", { number: result.documentNumber }));
      router.refresh();
    } finally {
      setBusy(false);
      setConfirmIssue(false);
    }
  };

  const onDelete = async () => {
    if (!window.confirm(t("deleteConfirm"))) return;
    const r = await deleteInvoiceDraft(invoice.id);
    if (r.ok) router.replace("/dashboard/sales/invoices");
  };

  const allProblems = [
    ...blockers.issuer.map((g) => ({
      key: `i-${g.field}`,
      text: `${t("issuerLabel")}: ${tI(`fields.${g.field}` as "fields.vatNumber")} — ${tI(`problems.${g.problem}`)}`,
      href: "/dashboard/settings/invoicing",
    })),
    ...blockers.customer.map((g) => ({
      key: `c-${g.field}`,
      text: `${t("customerLabel")}: ${tI(`fields.${g.field}` as "fields.vatNumber")} — ${tI(`problems.${g.problem}`)}`,
      href: invoice.companyId ? `/dashboard/companies/${invoice.companyId}` : undefined,
    })),
    ...liveDraftProblems.map((p) => ({
      key: `d-${p.kind}-${"line" in p ? p.line : ""}`,
      text: t(`problems.${p.kind}`, { line: "line" in p ? p.line : 0 }),
      href: undefined,
    })),
  ];

  // ── Presentation helpers ──
  const customer = (invoice.customerSnapshot as CustomerSnapshot | null) ?? null;
  // A draft names the customer as the record is now; an issued invoice as it was frozen.
  const customerName = (isDraft ? data.companyName : customer?.name) ?? null;
  const companyHref = invoice.companyId ? `/dashboard/companies/${invoice.companyId}` : null;
  // A calendar date, not an instant: read at UTC midnight and written in UTC, so the
  // day does not move with the reader's zone and the server and browser agree.
  const calendarDay = (d: string | null | undefined) =>
    d ? format.dateTime(new Date(`${d}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" }) : null;

  const title = invoice.documentNumber
    ? t(isCredit ? "credit.noteNumber" : isDeposit ? "deposit.numberTitle" : "numberTitle", {
        number: invoice.documentNumber,
      })
    : t(isCredit ? "credit.draftNote" : isDeposit ? "deposit.draftTitle" : "draftTitle");

  // When it is due, on the Italian calendar the invoice itself is dated by. The hint
  // stays neutral: an invoice carries no payment record, so a date that has passed
  // says the term has run, not that the money is missing.
  const shownDue = dueDate || null;
  const daysToDue = shownDue
    ? Math.round((Date.parse(`${shownDue}T00:00:00Z`) - Date.parse(`${italianToday()}T00:00:00Z`)) / DAY)
    : null;
  const dueHint =
    daysToDue == null
      ? undefined
      : daysToDue === 0
        ? tR("today")
        : daysToDue > 0
          ? tR("inDays", { days: daysToDue })
          : tR("daysAgo", { days: -daysToDue });

  const credited = Number(invoice.creditedAmount);
  const residual = Math.max(0, Math.round((Number(invoice.total) - credited) * 100) / 100);

  // ── Where the customer's money stands (I9, I12) ──
  // Paid in parts: each installment with what it still owes, the earliest settled first — the
  // arithmetic the receivables schedule uses, so the page and Finance agree on what is late.
  const plan =
    !isDraft && payments && invoice.installments && invoice.installments.length > 1
      ? installmentStates(invoice.installments, payments.balance.due, payments.balance.paid)
      : null;
  const nextInstallment = plan?.find((i) => i.outstanding > 0) ?? null;
  const today = italianToday();
  const owedBy = nextInstallment?.dueDate ?? shownDue ?? invoice.issueDate;
  const outstanding = payments ? payments.balance.outstanding : 0;
  const daysLate =
    payments && outstanding > 0.005 && owedBy && owedBy < today
      ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${owedBy}T00:00:00Z`)) / DAY)
      : 0;
  // What is past due: the installments whose day has come, or all of it (the schedule's rule).
  const overdueAmount =
    daysLate > 0
      ? plan
        ? Math.round(plan.filter((i) => i.dueDate < today).reduce((s, i) => s + i.outstanding, 0) * 100) / 100
        : outstanding
      : 0;
  // Until the XML has been downloaded once, the page says the invoice still has to reach SDI.
  const [xmlTaken, setXmlTaken] = useState(Boolean(invoice.xmlDownloadedAt));

  // ── Sections ──
  const linesCard = (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">{t("lines")}</CardTitle>
        <span className="text-muted-foreground text-xs tabular-nums">{lines.length}</span>
      </CardHeader>
      <CardContent className="p-0">
        <InvoiceLinesTable
          lines={lines}
          onChange={(next) => {
            setLines(next);
            setDirty(true);
          }}
          editable={editable}
          totals={totals}
          rechargeLine={Boolean(rechargeLine)}
          money={money}
        />
        {deductions.length > 0 && (
          // Generated from the deposit invoices, not typed: shown, never edited.
          <ul className="divide-y border-t bg-muted/20 text-sm">
            {deductions.map((d) => (
              <li
                key={`${d.description}-${d.taxPercent}-${d.nature ?? ""}`}
                className="flex items-center justify-between gap-3 px-4 py-2 sm:px-6"
              >
                <span className="min-w-0 truncate">{d.description}</span>
                <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                  {t("deposit.rate", { rate: d.taxPercent })}
                </span>
                <span className="shrink-0 font-medium tabular-nums">{money(d.unitPrice)}</span>
              </li>
            ))}
          </ul>
        )}
        {/* The totals under the lines they add up, as on the document itself. */}
        <div className="border-t px-4 py-4 sm:px-6">
          <div className="sm:ml-auto sm:max-w-sm">
            <InvoiceTotals totals={totals} money={money} />
          </div>
        </div>
      </CardContent>
    </Card>
  );

  const stampBlock = (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-sm">{t("stampTitle")}</p>
        <Badge variant={stampApplied ? "secondary" : "outline"}>
          {stampApplied ? t("stampApplied") : t("stampNotApplied")}
        </Badge>
      </div>
      {isDraft ? (
        <>
          <p className="text-muted-foreground text-xs">
            {t(`stampReasons.${stamp.reason}`, {
              base: money(stamp.base),
              exempt: money(stamp.exemptBase),
            })}
          </p>
          {editable && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Select value={stampMode} onValueChange={(v) => touch(setStampMode)(v as StampMode)}>
                <SelectTrigger aria-label={t("stampTitle")} className="h-9 w-full">
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
                  onChange={(e) => touch(setStampNote)(e.target.value)}
                />
              )}
            </div>
          )}
          {!editable && stampMode !== "auto" && (
            <p className="text-muted-foreground text-xs">
              {t(`stampModes.${stampMode}`)}
              {stampNote ? ` — ${stampNote}` : ""}
            </p>
          )}
          {stamp.applied && (
            <p className="text-muted-foreground text-xs">
              {data.rechargeStamp ? t("stampRecharged") : t("stampBorne")}{" "}
              <Link href="/dashboard/settings/invoicing" className="underline">
                {t("stampChangeSetting")}
              </Link>
            </p>
          )}
        </>
      ) : (
        invoice.stampDutyNote && (
          <p className="text-muted-foreground text-xs">
            {t("stampReasonLabel")}: {invoice.stampDutyNote}
          </p>
        )
      )}
    </div>
  );

  // A draft somebody can edit: the fields still to fill in, in the work column.
  const draftForm = (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("new.paymentTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="inv-series">{t("series")}</Label>
          <Input
            id="inv-series"
            className="mt-1.5"
            value={series}
            onChange={(e) => touch(setSeries)(e.target.value)}
            placeholder={t("mainSeries")}
          />
        </div>
        {/* With terms, the due date comes from them at issue (I12). */}
        {!terms && (
          <div>
            <Label htmlFor="inv-due">{t("dueDate")}</Label>
            <Input
              id="inv-due"
              type="date"
              className="mt-1.5"
              value={dueDate}
              onChange={(e) => touch(setDueDate)(e.target.value)}
            />
          </div>
        )}
        <div>
          <Label htmlFor="inv-discount">{t("documentDiscount")}</Label>
          <Input
            id="inv-discount"
            inputMode="decimal"
            className="mt-1.5"
            value={discount}
            onChange={(e) => touch(setDiscount)(e.target.value)}
          />
        </div>
        <div>
          <Label>{t("paymentMethod")}</Label>
          <Select value={paymentMethod} onValueChange={touch(setPaymentMethod)}>
            <SelectTrigger className="mt-1.5 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PAYMENT_METHODS).map(([code, label]) => (
                <SelectItem key={code} value={code}>
                  {code} — {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {invoice.documentType !== "TD04" && (
          <div className="sm:col-span-2">
            <PaymentTermsField
              id="inv-terms"
              terms={terms}
              onChange={touch(setTerms)}
              total={totals.total}
              today={italianToday()}
              money={money}
            />
          </div>
        )}
        <div className="sm:col-span-2">{stampBlock}</div>
        <div className="sm:col-span-2">
          <Label htmlFor="inv-notes">{t("notes")}</Label>
          <Textarea
            id="inv-notes"
            rows={2}
            className="mt-1.5"
            value={notes}
            onChange={(e) => touch(setNotes)(e.target.value)}
          />
        </div>
      </CardContent>
    </Card>
  );

  // Issued, or a draft read by somebody who cannot edit it: the same fields as
  // reference, with no disabled inputs pretending to be a form.
  const detailsCard = (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{tR("detailsTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <FieldList>
          <Field label={t("series")} always>
            {series || t("mainSeries")}
          </Field>
          <Field label={t("date")}>{calendarDay(invoice.issueDate)}</Field>
          <Field label={t("dueDate")} always>
            {calendarDay(shownDue)}
          </Field>
          {invoice.installments && invoice.installments.length > 1 && (
            <Field label={tT("installments")} always>
              <ul className="space-y-0.5 tabular-nums">
                {(plan ?? invoice.installments).map((i, k) => {
                  const state = plan ? (i as (typeof plan)[number]) : null;
                  const late = state && state.outstanding > 0 && i.dueDate < today;
                  return (
                    <li key={i.dueDate}>
                      {tT("installment", { n: k + 1 })} · {calendarDay(i.dueDate)} · {money(i.amount)}
                      {state && (
                        <span
                          className={
                            state.outstanding <= 0
                              ? "ml-1 text-emerald-700 dark:text-emerald-400"
                              : late
                                ? "ml-1 text-destructive"
                                : "ml-1 text-muted-foreground"
                          }
                        >
                          ·{" "}
                          {state.outstanding <= 0
                            ? tT("installmentPaid")
                            : late
                              ? tT("installmentLate", { amount: money(state.outstanding) })
                              : state.paid > 0
                                ? tT("installmentPartly", { amount: money(state.outstanding) })
                                : tT("installmentOpen")}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Field>
          )}
          <Field label={t("documentDiscount")}>{num(discount) !== 0 ? `${num(discount)}%` : null}</Field>
          <Field label={t("paymentMethod")} always>
            {paymentMethod}
            {PAYMENT_METHODS[paymentMethod] ? ` — ${PAYMENT_METHODS[paymentMethod]}` : ""}
          </Field>
        </FieldList>
        {stampBlock}
        <div className="border-t pt-3">
          <p className="mb-1 font-medium text-muted-foreground text-xs">{t("notes")}</p>
          {notes ? (
            <p className="whitespace-pre-wrap break-words text-sm">{notes}</p>
          ) : (
            <p className="text-muted-foreground text-sm">—</p>
          )}
        </div>
      </CardContent>
    </Card>
  );

  const address = customer
    ? [
        customer.street,
        [customer.zipCode, customer.city, customer.province ? `(${customer.province})` : null]
          .filter(Boolean)
          .join(" "),
        customer.country,
      ]
        .filter(Boolean)
        .join(", ")
    : "";

  const customerCard = (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("customerLabel")}</CardTitle>
      </CardHeader>
      <CardContent>
        <FieldList>
          <Field label={tI("fields.name")} always>
            {customerName &&
              (companyHref ? (
                <Link href={companyHref} className="text-primary hover:underline">
                  {customerName}
                </Link>
              ) : (
                customerName
              ))}
          </Field>
          {/* Issued: what the XML says, frozen. A draft has no snapshot yet; its
              fiscal fields are on the company, and the blockers above say which
              are missing. */}
          {customer && (
            <>
              <Field label={tI("fields.vatNumber")}>{customer.vatNumber}</Field>
              <Field label={tI("fields.fiscalCode")}>{customer.fiscalCode}</Field>
              <Field label={tI("fields.street")}>{address}</Field>
              <Field label={tI("fields.sdiCode")}>
                {customer.sdiCode && <span className="font-mono">{customer.sdiCode}</span>}
              </Field>
              <Field label={tI("fields.pec")}>{customer.pec}</Field>
            </>
          )}
          <Field label={tI("fields.email")}>
            {data.customerEmail && (
              <EmailAddressButton
                email={data.customerEmail}
                entity={{ id: invoice.companyId ?? "", name: customerName }}
                entityType="company"
                canSend={canWrite && Boolean(invoice.companyId)}
                className="break-all text-primary hover:underline"
              />
            )}
          </Field>
        </FieldList>
      </CardContent>
    </Card>
  );

  const hasCreditNotes = !isCredit && data.creditNotes.length > 0;

  return (
    <>
      {/* ── Hero: which document, whose, what it is worth ── */}
      <RecordHero
        badges={
          <>
            <StatusBadge tone={isDraft ? "neutral" : "success"}>
              {t(`statuses.${invoice.status as "draft" | "issued"}`)}
            </StatusBadge>
            {!isDraft && !isCredit && credited > 0 && (
              <StatusBadge tone={residual === 0 ? "neutral" : "warning"}>
                <Undo2Icon aria-hidden />
                {residual === 0 ? t("credit.fullyCredited") : t("credit.partlyCredited")}
              </StatusBadge>
            )}
            {payments && residual > 0 && (
              <StatusBadge tone={daysLate > 0 ? "danger" : PAYMENT_TONE[payments.balance.state]}>
                {daysLate > 0 ? t("paymentBadge.overdue", { days: daysLate }) : tP(`state.${payments.balance.state}`)}
              </StatusBadge>
            )}
          </>
        }
        title={title}
        meta={
          <>
            <MetaItem icon={<BuildingIcon aria-hidden />} href={companyHref}>
              {customerName ?? "—"}
            </MetaItem>
            {invoice.issueDate && (
              <MetaItem icon={<CalendarIcon aria-hidden />}>{calendarDay(invoice.issueDate)}</MetaItem>
            )}
            {isCredit && data.original && (
              <MetaItem icon={<Undo2Icon aria-hidden />} href={`/dashboard/sales/invoices/${data.original.id}`}>
                {t("credit.creditsInvoice")} {t("numberTitle", { number: data.original.documentNumber ?? "" })}
                {data.original.issueDate ? ` · ${calendarDay(data.original.issueDate)}` : ""}
              </MetaItem>
            )}
            {data.deposits.length > 0 && (
              <MetaItem>
                {t("deposit.takesOff")}{" "}
                {data.deposits.map((d, i) => (
                  <span key={d.id}>
                    {i > 0 ? ", " : ""}
                    <a className="text-primary hover:underline" href={`/dashboard/sales/invoices/${d.id}`}>
                      {d.documentNumber ?? "—"}
                    </a>
                  </span>
                ))}
              </MetaItem>
            )}
            {isDeposit && data.deductedIn && (
              <MetaItem href={`/dashboard/sales/invoices/${data.deductedIn.id}`}>
                {t("deposit.takenOffIn", { number: data.deductedIn.documentNumber ?? "—" })}
              </MetaItem>
            )}
            {isCredit && data.original && isDraft && (
              <MetaItem>{t("credit.residualLeft", { amount: money(data.original.residual) })}</MetaItem>
            )}
            {invoice.orderId && orderNumber && (
              <MetaItem icon={<ShoppingCartIcon aria-hidden />} href={`/dashboard/sales/orders/${invoice.orderId}`}>
                {orderNumber}
              </MetaItem>
            )}
          </>
        }
        actions={
          isDraft ? (
            <>
              {canIssue && (
                <Button size="sm" onClick={() => setConfirmIssue(true)} disabled={busy || allProblems.length > 0}>
                  {t("issue")}
                </Button>
              )}
              {canWrite && (
                <Button size="sm" variant="outline" onClick={onSave} disabled={busy || !dirty}>
                  {t("save")}
                </Button>
              )}
              {canWrite && (
                // Deleting a draft is rare and destructive: out of the way, in the menu.
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" className="gap-1.5">
                      <MoreHorizontal className="size-3.5" aria-hidden />
                      {tR("more")}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem variant="destructive" className="max-md:min-h-11" onSelect={onDelete}>
                      <Trash2 aria-hidden />
                      {t("delete")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </>
          ) : (
            <>
              <DownloadPdfButton invoiceId={invoice.id} />
              {canWrite && (
                <SendInvoiceCopyButton
                  invoiceId={invoice.id}
                  documentNumber={invoice.documentNumber}
                  emailedTo={invoice.emailedTo}
                  customerEmail={data.customerEmail}
                  customer={{ id: invoice.companyId, name: customerName }}
                />
              )}
              {!isCredit && !data.deductedIn && canWrite && (
                <CreditNoteButton invoiceId={invoice.id} residual={residual} />
              )}
            </>
          )
        }
      >
        <MetricStrip>
          <Metric label={t("total")}>{money(totals.total)}</Metric>
          <Metric label={t("vat")} hint={`${t("on")} ${money(totals.taxableAmount)}`}>
            {money(totals.taxAmount)}
          </Metric>
          {nextInstallment ? (
            // Paid in parts: the date that matters is the next installment's, not the last one's.
            <Metric
              label={t("nextInstallment")}
              hint={tT("installmentOf", {
                n: (plan?.indexOf(nextInstallment) ?? 0) + 1,
                count: plan?.length ?? 0,
                amount: money(nextInstallment.outstanding),
              })}
            >
              {calendarDay(nextInstallment.dueDate)}
            </Metric>
          ) : (
            <Metric label={t("dueDate")} hint={dueHint}>
              {calendarDay(shownDue) ?? tR("notSet")}
            </Metric>
          )}
          {payments && residual > 0 ? (
            <Metric
              label={outstanding < 0 ? tP("credit") : tP("outstanding")}
              hint={daysLate > 0 ? t("paymentBadge.overdue", { days: daysLate }) : undefined}
            >
              <span className={daysLate > 0 ? "text-destructive" : undefined}>{money(Math.abs(outstanding))}</span>
            </Metric>
          ) : (
            !isDraft && !isCredit && credited > 0 && <Metric label={t("credit.residual")}>{money(residual)}</Metric>
          )}
        </MetricStrip>

        {daysLate > 0 && overdueAmount > 0 && (
          <OverdueBanner
            invoiceId={invoice.id}
            daysLate={daysLate}
            overdueText={money(overdueAmount)}
            customerEmail={data.customerEmail}
            customer={{ id: invoice.companyId, name: customerName }}
            remindedAt={invoice.remindedAt as unknown as string | null}
            reminderCount={invoice.reminderCount ?? 0}
            canWrite={canWrite}
          />
        )}

        {/* ⚠️⚠️ Issuing numbers the invoice; it reaches the customer only through SDI. Until it has,
            the page says what is missing — a numbered invoice never transmitted, or one SDI
            discarded, is one the customer's accountant never receives (src/lib/sdi/). */}
        {!isDraft && (
          <SdiPanel
            invoiceId={invoice.id}
            status={(invoice.sdiStatus ?? null) as SdiStatus | null}
            message={invoice.sdiMessage ?? null}
            channel={sdi.channel}
            providerLabel={sdi.providerLabel}
            xmlTaken={xmlTaken}
            onXmlTaken={() => setXmlTaken(true)}
            canIssue={canIssue}
            sentAt={(invoice.sdiSentAt as unknown as string | null) ?? null}
          />
        )}

        {/* What stands between this draft and a number, next to the Issue button it disables. */}
        {isDraft && allProblems.length > 0 && (
          <div className="flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
            <div className="min-w-0">
              <p className="font-medium">{t("cannotIssue")}</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                {allProblems.map((p) => (
                  <li key={p.key} className="break-words">
                    {p.href ? (
                      <Link href={p.href} className="underline">
                        {p.text}
                      </Link>
                    ) : (
                      p.text
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </RecordHero>

      <RecordSections
        label={tR("sectionsLabel")}
        tabs={[
          { id: "lines", label: tR("tabs.lines"), icon: <FileTextIcon aria-hidden />, count: lines.length },
          { id: "details", label: tR("tabs.details"), icon: <InfoIcon aria-hidden /> },
          ...(payments
            ? [
                {
                  id: "payments",
                  label: tR("tabs.payments"),
                  icon: <BanknoteIcon aria-hidden />,
                  count: payments.payments.length || undefined,
                },
              ]
            : []),
          {
            id: "documents",
            label: tR("tabs.documents"),
            icon: <FolderIcon aria-hidden />,
            count: hasCreditNotes ? data.creditNotes.length : undefined,
          },
        ]}
        sections={[
          { tab: "lines", column: "main", node: linesCard },
          editable
            ? { tab: "details", column: "main", node: draftForm }
            : { tab: "details", column: "side", node: detailsCard },
          { tab: "details", column: "side", node: customerCard },
          ...(payments
            ? [
                {
                  tab: "payments",
                  column: "side" as const,
                  node: (
                    <InvoicePaymentsCard
                      invoiceId={invoice.id}
                      currency={invoice.currency}
                      data={payments}
                      canWrite={canWrite}
                    />
                  ),
                },
              ]
            : []),
          ...(!isDraft
            ? [
                {
                  tab: "documents",
                  column: "side" as const,
                  node: (
                    <IssuedInvoiceFiles
                      invoiceId={invoice.id}
                      archivedAt={invoice.archivedAt as unknown as string | null}
                      emailedAt={invoice.emailedAt as unknown as string | null}
                      emailedTo={invoice.emailedTo}
                      canWrite={canWrite}
                    />
                  ),
                },
              ]
            : []),
          ...(hasCreditNotes
            ? [
                {
                  tab: "documents",
                  column: "side" as const,
                  node: (
                    <CreditNotesCard
                      currency={invoice.currency}
                      total={Number(invoice.total)}
                      credited={credited}
                      notes={data.creditNotes}
                    />
                  ),
                },
              ]
            : []),
        ]}
      />

      {/* On a phone the hero's Save is several screens up by the time a line has
          been edited; the bar keeps it, and the total it would save, in reach. Only
          while there is something to save. */}
      {editable && dirty && (
        <div
          data-bottom-bar=""
          className="-mx-4 sticky bottom-0 z-20 flex items-center justify-between gap-3 border-t bg-background px-4 py-3 after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-4 after:bg-background md:hidden"
        >
          <div className="min-w-0">
            <p className="truncate text-muted-foreground text-xs">{t("total")}</p>
            <p className="truncate font-bold tabular-nums">{money(totals.total)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" onClick={onSave} disabled={busy}>
              {t("save")}
            </Button>
            {canIssue && (
              <Button onClick={() => setConfirmIssue(true)} disabled={busy || allProblems.length > 0}>
                {t("issue")}
              </Button>
            )}
          </div>
        </div>
      )}

      <AlertDialog open={confirmIssue} onOpenChange={setConfirmIssue}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("issueTitle")}</AlertDialogTitle>
            {/* ⚠️ What is about to be fixed for good, read once more: an issued invoice is corrected
                only with a credit note. */}
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-md border bg-muted/20 p-3 text-foreground">
                  <dt className="text-muted-foreground">{t("issueSummary.document")}</dt>
                  <dd>
                    {t(`types.${invoice.documentType as "TD01" | "TD02" | "TD04"}`)} ·{" "}
                    {t("issueSummary.series", { series: series || t("mainSeries") })}
                  </dd>
                  <dt className="text-muted-foreground">{t("issueSummary.date")}</dt>
                  <dd>{calendarDay(italianToday())}</dd>
                  <dt className="text-muted-foreground">{t("issueSummary.customer")}</dt>
                  <dd className="break-words">{customerName ?? "—"}</dd>
                  {isCredit && data.original && (
                    <>
                      <dt className="text-muted-foreground">{t("credit.creditsInvoice")}</dt>
                      <dd>{t("numberTitle", { number: data.original.documentNumber ?? "—" })}</dd>
                    </>
                  )}
                  <dt className="text-muted-foreground">{t("issueSummary.total")}</dt>
                  <dd className="font-semibold tabular-nums">{money(totals.total)}</dd>
                  {!isCredit && (
                    <>
                      <dt className="text-muted-foreground">{t("dueDate")}</dt>
                      <dd>{terms ? t("issueSummary.fromTerms") : (calendarDay(shownDue) ?? tR("notSet"))}</dd>
                      <dt className="text-muted-foreground">{t("paymentMethod")}</dt>
                      <dd>{PAYMENT_METHODS[paymentMethod] ?? paymentMethod}</dd>
                    </>
                  )}
                </dl>
                <p>{t("issueDescription")}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={onIssue} disabled={busy}>
              {t("issue")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
