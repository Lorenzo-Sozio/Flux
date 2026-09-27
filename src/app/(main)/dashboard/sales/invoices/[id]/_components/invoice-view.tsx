"use client";

import { useMemo, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  BanknoteIcon,
  BuildingIcon,
  CalendarIcon,
  CircleAlert,
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
import { invoiceTotals } from "@/lib/fatturapa/totals";
import { italianToday, PAYMENT_METHODS } from "@/lib/invoice-draft";
import { draftProblems } from "@/lib/invoice-rules";
import { assessStampDuty, type StampMode, withStampRecharge } from "@/lib/stamp-duty";

import { asDraftLines, type EditableLine, num } from "../../_components/invoice-lines";
import { InvoiceLinesTable, InvoiceTotals } from "../../_components/invoice-parts";
import { CreditNoteButton, CreditNotesCard } from "./credit-notes";
import { InvoicePaymentsCard } from "./invoice-payments";
import { DownloadPdfButton, IssuedInvoiceFiles, SendInvoiceCopyButton } from "./issued-invoice-files";

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
}: {
  data: Data;
  canWrite: boolean;
  canIssue: boolean;
  /** The order this invoice was written from, by number, when there is one. */
  orderNumber: string | null;
  /** An issued invoice's payments and balance (I9); null for a draft or a credit note. */
  payments: Parameters<typeof InvoicePaymentsCard>[0]["data"] | null;
}) {
  const t = useTranslations("invoices");
  const say = useMessageText();
  const tI = useTranslations("invoicing");
  const tR = useTranslations("record");
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
  // A draft decides the stamp live from its lines; an issued invoice shows what was frozen.
  const stamp = assessStampDuty(draftLines, num(discount), stampMode);
  const stampApplied = isDraft ? stamp.applied : invoice.stampDuty;
  const rechargeLine = isDraft && stamp.applied && data.rechargeStamp;
  const totalledLines = isDraft
    ? withStampRecharge(
        draftLines.map((l) => ({ ...l, description: l.description })),
        stamp.applied,
        data.rechargeStamp,
      )
    : draftLines;
  const totals = invoiceTotals(totalledLines, num(discount));
  // The draft checks run on the screen as typed, so the list of what is missing moves with the edit.
  const isCredit = invoice.documentType === "TD04";
  const liveDraftProblems = isDraft
    ? draftProblems(draftLines, num(discount), { mode: stampMode, note: stampNote })
    : [];
  // A credit note cannot give back more than is left on its invoice; the issuing
  // statement enforces it, this says so while the lines are being edited.
  if (isDraft && isCredit) {
    if (!data.original) liveDraftProblems.push({ kind: "credit_without_original" });
    else if (totals.total > data.original.residual) liveDraftProblems.push({ kind: "credit_exceeds_residual" });
  }
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
    ? t(isCredit ? "credit.noteNumber" : "numberTitle", { number: invoice.documentNumber })
    : t(isCredit ? "credit.draftNote" : "draftTitle");

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
              <a href={`mailto:${data.customerEmail}`} className="break-all text-primary hover:underline">
                {data.customerEmail}
              </a>
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
                  emailedTo={invoice.emailedTo}
                  customerEmail={data.customerEmail}
                />
              )}
              {!isCredit && canWrite && <CreditNoteButton invoiceId={invoice.id} residual={residual} />}
            </>
          )
        }
      >
        <MetricStrip>
          <Metric label={t("total")}>{money(totals.total)}</Metric>
          <Metric label={t("vat")} hint={`${t("on")} ${money(totals.taxableAmount)}`}>
            {money(totals.taxAmount)}
          </Metric>
          <Metric label={t("dueDate")} hint={dueHint}>
            {calendarDay(shownDue) ?? tR("notSet")}
          </Metric>
          {!isDraft && !isCredit && credited > 0 && <Metric label={t("credit.residual")}>{money(residual)}</Metric>}
        </MetricStrip>

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
            <AlertDialogDescription>{t("issueDescription")}</AlertDialogDescription>
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
