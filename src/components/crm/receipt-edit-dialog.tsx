"use client";

import { useState, useTransition } from "react";

import { Loader2, Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { updateReceiptAction } from "@/actions/receipts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { isRecordablePayment } from "@/lib/order-payment";

/**
 * Corrects money recorded by hand (I10): the day, the amount, the method, the bank's
 * reference, a note. It used to be delete and type again — and the second time nobody wrote
 * the reference, which is what finds the transfer on the statement.
 *
 * A receipt that paid several documents keeps its shares; the server refuses an amount below
 * what it has already paid, and says so.
 */
export function ReceiptEditDialog({
  receipt,
}: {
  receipt: {
    id: string;
    amount: string | number;
    receivedAt: Date | string;
    method: string | null;
    reference: string | null;
    note: string | null;
  };
}) {
  const t = useTranslations("receipts");
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState(String(receipt.amount));
  const [day, setDay] = useState(() => new Date(receipt.receivedAt).toLocaleDateString("en-CA"));
  const [method, setMethod] = useState(receipt.method ?? "");
  const [reference, setReference] = useState(receipt.reference ?? "");
  const [note, setNote] = useState(receipt.note ?? "");

  function save() {
    if (!isRecordablePayment(amount)) {
      toast.error(t("amountInvalid"));
      return;
    }
    startTransition(async () => {
      const result = await updateReceiptAction(receipt.id, { amount, paidAt: day, method, reference, note });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("saved"));
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-10 shrink-0 text-muted-foreground md:size-8"
          aria-label={t("edit")}
          title={t("edit")}
        >
          <Pencil className="size-3.5" aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("editTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`receipt-amount-${receipt.id}`}>{t("amount")}</Label>
              <Input
                id={`receipt-amount-${receipt.id}`}
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
              <Label htmlFor={`receipt-day-${receipt.id}`}>{t("date")}</Label>
              <Input
                id={`receipt-day-${receipt.id}`}
                type="date"
                value={day}
                onChange={(e) => setDay(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`receipt-method-${receipt.id}`}>{t("method")}</Label>
              <Input
                id={`receipt-method-${receipt.id}`}
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                placeholder={t("methodPlaceholder")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`receipt-reference-${receipt.id}`}>{t("reference")}</Label>
              <Input
                id={`receipt-reference-${receipt.id}`}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder={t("referencePlaceholder")}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`receipt-note-${receipt.id}`}>{t("note")}</Label>
            <Textarea
              id={`receipt-note-${receipt.id}`}
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            {t("cancel")}
          </Button>
          <Button type="button" onClick={save} disabled={pending} className="gap-1.5">
            {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
