"use client";

import { useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { Loader2, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { createCreditNote } from "@/actions/invoices";
import { Badge } from "@/components/ui/badge";
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
      <Button variant="outline" className="gap-1.5" onClick={() => setOpen(true)}>
        <Undo2 className="h-4 w-4" /> {t("button")}
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
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{t("cardTitle")}</CardTitle>
          <Badge variant={residual === 0 ? "secondary" : "outline"}>
            {residual === 0 ? t("fullyCredited") : t("partlyCredited")}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid grid-cols-1 gap-2 tabular-nums sm:grid-cols-3">
          <div>
            <p className="text-muted-foreground text-xs">{t("invoiced")}</p>
            <p className="font-medium">{formatMoney(total, currency)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">{t("credited")}</p>
            <p className="font-medium">{formatMoney(credited, currency)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">{t("residual")}</p>
            <p className="font-semibold">{formatMoney(residual, currency)}</p>
          </div>
        </div>
        <ul className="divide-y rounded-md border">
          {notes.map((n) => (
            <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <Link href={`/dashboard/sales/invoices/${n.id}`} className="min-w-0 font-medium hover:underline">
                {n.documentNumber ? t("noteNumber", { number: n.documentNumber }) : t("draftNote")}
                {n.issueDate ? <span className="ml-2 text-muted-foreground text-xs">{n.issueDate}</span> : null}
              </Link>
              <span className="flex items-center gap-2 tabular-nums">
                <Badge variant={n.status === "draft" ? "outline" : "secondary"}>
                  {tInv(`statuses.${n.status as "draft" | "issued"}`)}
                </Badge>
                {formatMoney(n.total, currency)}
              </span>
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
