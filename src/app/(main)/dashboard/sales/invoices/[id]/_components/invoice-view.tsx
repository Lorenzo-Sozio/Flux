"use client";

import { useMemo, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { CircleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import {
  deleteInvoiceDraft,
  type getInvoice,
  type IssueBlockers,
  issueInvoiceAction,
  saveInvoiceDraft,
} from "@/actions/invoices";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { invoiceTotals } from "@/lib/fatturapa/totals";
import { PAYMENT_METHODS } from "@/lib/invoice-draft";
import { draftProblems } from "@/lib/invoice-rules";
import { assessStampDuty, type StampMode, withStampRecharge } from "@/lib/stamp-duty";

import { asDraftLines, type EditableLine, num } from "../../_components/invoice-lines";
import { InvoiceLinesTable, InvoiceTotals } from "../../_components/invoice-parts";
import { IssuedInvoiceFiles } from "./issued-invoice-files";

type Data = NonNullable<Awaited<ReturnType<typeof getInvoice>>>;

export function InvoiceView({ data, canWrite, canIssue }: { data: Data; canWrite: boolean; canIssue: boolean }) {
  const t = useTranslations("invoices");
  const tI = useTranslations("invoicing");
  const router = useRouter();
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
  const liveDraftProblems = isDraft
    ? draftProblems(draftLines, num(discount), { mode: stampMode, note: stampNote })
    : [];
  const money = (n: number) =>
    new Intl.NumberFormat("it-IT", { style: "currency", currency: invoice.currency }).format(n);

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
      toast.error(result.error);
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

  const customer = invoice.customerSnapshot as { name?: string } | null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-muted-foreground text-xs">
            {t(`types.${invoice.documentType as "TD01" | "TD04"}`)}
          </p>
          <h1 className="font-bold text-2xl tracking-tight">
            {invoice.documentNumber ? t("numberTitle", { number: invoice.documentNumber }) : t("draftTitle")}
          </h1>
          <p className="text-muted-foreground text-sm">
            {(isDraft ? data.companyName : customer?.name) ?? "—"}
            {invoice.issueDate ? ` · ${invoice.issueDate}` : ""}
          </p>
          <Badge className="mt-2" variant={isDraft ? "outline" : "secondary"}>
            {t(`statuses.${invoice.status as "draft" | "issued"}`)}
          </Badge>
        </div>
        {!isDraft && (
          <IssuedInvoiceFiles
            invoiceId={invoice.id}
            archivedAt={invoice.archivedAt as unknown as string | null}
            emailedAt={invoice.emailedAt as unknown as string | null}
            emailedTo={invoice.emailedTo}
            customerEmail={data.customerEmail}
            canWrite={canWrite}
          />
        )}
        {isDraft && (
          <div className="flex flex-wrap gap-2">
            {canWrite && (
              <Button variant="ghost" className="text-destructive" onClick={onDelete}>
                {t("delete")}
              </Button>
            )}
            {canWrite && (
              <Button variant="outline" onClick={onSave} disabled={busy || !dirty}>
                {t("save")}
              </Button>
            )}
            {canIssue && (
              <Button onClick={() => setConfirmIssue(true)} disabled={busy || allProblems.length > 0}>
                {t("issue")}
              </Button>
            )}
          </div>
        )}
      </div>

      {isDraft && allProblems.length > 0 && (
        <Card className="border-amber-300 dark:border-amber-800">
          <CardContent className="flex gap-3 p-4 text-sm">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="min-w-0">
              <p className="font-medium">{t("cannotIssue")}</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                {allProblems.map((p) => (
                  <li key={p.key}>
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
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("lines")}</CardTitle>
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
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="inv-series">{t("series")}</Label>
              <Input
                id="inv-series"
                className="mt-1.5"
                value={series}
                disabled={!editable}
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
                disabled={!editable}
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
                disabled={!editable}
                onChange={(e) => touch(setDiscount)(e.target.value)}
              />
            </div>
            <div>
              <Label>{t("paymentMethod")}</Label>
              <Select value={paymentMethod} onValueChange={touch(setPaymentMethod)} disabled={!editable}>
                <SelectTrigger className="mt-1.5">
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
            <div className="space-y-2 rounded-md border p-3 sm:col-span-2">
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
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Select
                      value={stampMode}
                      onValueChange={(v) => touch(setStampMode)(v as StampMode)}
                      disabled={!editable}
                    >
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
                        disabled={!editable}
                        onChange={(e) => touch(setStampNote)(e.target.value)}
                      />
                    )}
                  </div>
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
            <div className="sm:col-span-2">
              <Label htmlFor="inv-notes">{t("notes")}</Label>
              <Textarea
                id="inv-notes"
                rows={2}
                className="mt-1.5"
                value={notes}
                disabled={!editable}
                onChange={(e) => touch(setNotes)(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <InvoiceTotals totals={totals} money={money} />
          </CardContent>
        </Card>
      </div>

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
    </div>
  );
}
