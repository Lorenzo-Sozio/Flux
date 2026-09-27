"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { Loader2, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { createCreditNote } from "@/actions/invoices";
import { RelatedRow, StatusBadge } from "@/components/crm/record/record-page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useCurrency } from "@/hooks/use-currency";
import { cn } from "@/lib/utils";

export interface CreditNoteRow {
  id: string;
  status: string;
  documentNumber: string | null;
  issueDate: string | null;
  total: string;
}

/** The button that starts a credit note on an issued invoice. */
export function CreditNoteButton({ invoiceId, residual }: { invoiceId: string; residual: number }) {
  const t = useTranslations("invoices.credit");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"full" | "partial">("full");
  const [busy, setBusy] = useState(false);

  if (residual <= 0) return null;

  const create = async () => {
    setBusy(true);
    try {
      const result = await createCreditNote(invoiceId, mode);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setOpen(false);
      router.push(`/dashboard/sales/invoices/${result.id}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setOpen(true)}>
        <Undo2 className="size-3.5" aria-hidden /> {t("button")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as "full" | "partial")} className="gap-2">
            {(["full", "partial"] as const).map((m) => (
              <label
                key={m}
                htmlFor={`credit-${m}`}
                className={cn(
                  "flex cursor-pointer gap-3 rounded-md border p-3",
                  mode === m && "border-primary bg-primary/5",
                )}
              >
                <RadioGroupItem id={`credit-${m}`} value={m} className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block font-medium text-sm">{t(`${m}Title`)}</span>
                  <span className="block text-muted-foreground text-xs">{t(`${m}Hint`)}</span>
                </span>
              </label>
            ))}
          </RadioGroup>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={create} disabled={busy} className="gap-1.5">
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t("create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** On an issued invoice: what has been credited, by which notes, and what is left. */
export function CreditNotesCard({
  currency,
  total,
  credited,
  notes,
}: {
  currency: string;
  total: number;
  credited: number;
  notes: CreditNoteRow[];
}) {
  const t = useTranslations("invoices.credit");
  const tInv = useTranslations("invoices");
  const { formatMoney } = useCurrency();
  if (notes.length === 0) return null;
  const residual = Math.max(0, Math.round((total - credited) * 100) / 100);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">{t("cardTitle")}</CardTitle>
        <StatusBadge tone={residual === 0 ? "neutral" : "warning"}>
          {residual === 0 ? t("fullyCredited") : t("partlyCredited")}
        </StatusBadge>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {/* Label and figure on one line each: the side column is a third of the
            width, and three figures side by side in it truncate to "€1.2…". */}
        <dl className="space-y-1.5 tabular-nums">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">{t("invoiced")}</dt>
            <dd>{formatMoney(total, currency)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">{t("credited")}</dt>
            <dd>{formatMoney(credited, currency)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3 font-semibold">
            <dt>{t("residual")}</dt>
            <dd>{formatMoney(residual, currency)}</dd>
          </div>
        </dl>
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id}>
              <RelatedRow
                href={`/dashboard/sales/invoices/${n.id}`}
                title={n.documentNumber ? t("noteNumber", { number: n.documentNumber }) : t("draftNote")}
                sub={n.issueDate ?? undefined}
                aside={
                  <>
                    <span className="font-semibold tabular-nums">{formatMoney(n.total, currency)}</span>
                    <StatusBadge tone={n.status === "draft" ? "neutral" : "success"} className="text-[11px]">
                      {tInv(`statuses.${n.status as "draft" | "issued"}`)}
                    </StatusBadge>
                  </>
                }
              />
            </li>
          ))}
        </ul>
        {notes.some((n) => n.status === "draft") && (
          <p className="text-muted-foreground text-xs">{t("draftsDontCount")}</p>
        )}
      </CardContent>
    </Card>
  );
}
