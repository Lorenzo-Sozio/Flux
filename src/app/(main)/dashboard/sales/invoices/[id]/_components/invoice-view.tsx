"use client";

import { useMemo, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { CircleAlert, Plus, Trash2 } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { computeDocument } from "@/lib/document-totals";
import { PAYMENT_METHODS } from "@/lib/invoice-draft";
import { draftProblems, NATURE_CODES, suggestsStampDuty } from "@/lib/invoice-rules";

type Data = NonNullable<Awaited<ReturnType<typeof getInvoice>>>;

interface Line {
  key: string;
  productId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  taxPercent: string;
  nature: string;
}

const NO_NATURE = "none";
const num = (v: string) => Number(v.replace(",", ".")) || 0;

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
  const [stampDuty, setStampDuty] = useState(invoice.stampDuty);
  const [paymentMethod, setPaymentMethod] = useState(invoice.paymentMethod);
  const [notes, setNotes] = useState(invoice.notes ?? "");
  const [lines, setLines] = useState<Line[]>(() => {
    // An issued invoice is read from what was frozen when it was issued.
    const source = isDraft
      ? data.items.map((i) => ({ ...i, quantity: Number(i.quantity), unitPrice: Number(i.unitPrice) }))
      : ((invoice.linesSnapshot as Line[] | null) ?? []);
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

  const draftLines = useMemo(
    () =>
      lines.map((l) => ({
        description: l.description,
        quantity: num(l.quantity),
        unitPrice: num(l.unitPrice),
        discountPercent: num(l.discountPercent),
        taxPercent: num(l.taxPercent),
        nature: l.nature || null,
      })),
    [lines],
  );
  const totals = computeDocument({ lines: draftLines, discountPercent: num(discount) });
  // The draft checks run on the screen as typed, so the list of what is missing moves with the edit.
  const liveDraftProblems = isDraft ? draftProblems(draftLines, num(discount)) : [];
  const stampSuggested = suggestsStampDuty(draftLines, num(discount));
  const money = (n: number) =>
    new Intl.NumberFormat("it-IT", { style: "currency", currency: invoice.currency }).format(n);

  const touch =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setDirty(true);
    };
  const putLine = (i: number, patch: Partial<Line>) => {
    setLines((all) => all.map((l, j) => (j === i ? { ...l, ...patch } : l)));
    setDirty(true);
  };

  const save = async (): Promise<number | null> => {
    const result = await saveInvoiceDraft(invoice.id, revision, {
      series,
      dueDate: dueDate || null,
      discountPercent: num(discount),
      stampDuty,
      paymentMethod,
      notes,
      lines: lines.map((l) => ({
        productId: l.productId,
        description: l.description,
        quantity: num(l.quantity),
        unitPrice: num(l.unitPrice),
        discountPercent: num(l.discountPercent),
        taxPercent: num(l.taxPercent),
        nature: l.nature || null,
      })),
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
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-56">{t("description")}</TableHead>
                <TableHead className="w-24 text-right">{t("quantity")}</TableHead>
                <TableHead className="w-28 text-right">{t("unitPrice")}</TableHead>
                <TableHead className="w-20 text-right">{t("discount")}</TableHead>
                <TableHead className="w-20 text-right">{t("vat")}</TableHead>
                <TableHead className="w-40">{t("nature")}</TableHead>
                <TableHead className="w-28 text-right">{t("net")}</TableHead>
                {editable && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l, i) => (
                <TableRow key={l.key}>
                  <TableCell>
                    {editable ? (
                      <Input
                        aria-label={t("description")}
                        value={l.description}
                        onChange={(e) => putLine(i, { description: e.target.value })}
                      />
                    ) : (
                      l.description
                    )}
                  </TableCell>
                  {(["quantity", "unitPrice", "discountPercent", "taxPercent"] as const).map((f) => (
                    <TableCell key={f} className="text-right tabular-nums">
                      {editable ? (
                        <Input
                          aria-label={t(f === "discountPercent" ? "discount" : f === "taxPercent" ? "vat" : f)}
                          inputMode="decimal"
                          className="text-right"
                          value={l[f]}
                          onChange={(e) => putLine(i, { [f]: e.target.value })}
                        />
                      ) : (
                        l[f]
                      )}
                    </TableCell>
                  ))}
                  <TableCell>
                    {editable && num(l.taxPercent) === 0 ? (
                      <Select
                        value={l.nature || NO_NATURE}
                        onValueChange={(v) => putLine(i, { nature: v === NO_NATURE ? "" : v })}
                      >
                        <SelectTrigger aria-label={t("nature")} className="h-9 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_NATURE}>{t("chooseNature")}</SelectItem>
                          {Object.entries(NATURE_CODES).map(([code, label]) => (
                            <SelectItem key={code} value={code}>
                              {code} — {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="font-mono text-xs">{l.nature || "—"}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(totals.lines[i]?.net ?? 0)}</TableCell>
                  {editable && (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label={t("removeLine")}
                        onClick={() => {
                          setLines((all) => all.filter((_, j) => j !== i));
                          setDirty(true);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {editable && (
            <div className="p-3">
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() => {
                  setLines((all) => [
                    ...all,
                    {
                      key: `n${Date.now()}`,
                      productId: null,
                      description: "",
                      quantity: "1",
                      unitPrice: "0",
                      discountPercent: "0",
                      taxPercent: "22",
                      nature: "",
                    },
                  ]);
                  setDirty(true);
                }}
              >
                <Plus className="h-3.5 w-3.5" /> {t("addLine")}
              </Button>
            </div>
          )}
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
            <div className="sm:col-span-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="inv-stamp"
                  checked={stampDuty}
                  disabled={!editable}
                  onCheckedChange={(v) => touch(setStampDuty)(v === true)}
                />
                <Label htmlFor="inv-stamp" className="cursor-pointer">
                  {t("stampDuty")}
                </Label>
              </div>
              {isDraft && stampSuggested !== stampDuty && (
                <p className="mt-1 text-amber-700 text-xs dark:text-amber-400">
                  {stampSuggested ? t("stampSuggested") : t("stampNotSuggested")}
                </p>
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
          <CardContent className="space-y-2 p-4 text-sm tabular-nums">
            <div className="flex justify-between">
              <span>{t("subtotal")}</span>
              <span>{money(totals.subtotal)}</span>
            </div>
            {totals.discountAmount > 0 && (
              <div className="flex justify-between">
                <span>{t("documentDiscount")}</span>
                <span>−{money(totals.discountAmount)}</span>
              </div>
            )}
            {totals.taxBreakdown.map((r) => (
              <div key={r.rate} className="flex justify-between text-muted-foreground">
                <span>
                  {t("vat")} {r.rate}% {t("on")} {money(r.taxable)}
                </span>
                <span>{money(r.amount)}</span>
              </div>
            ))}
            <div className="flex justify-between border-t pt-2 font-semibold">
              <span>{t("total")}</span>
              <span>{money(totals.total)}</span>
            </div>
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
