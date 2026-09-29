"use client";

import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { AlarmClockIcon, Loader2, MailIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";

import { sendPaymentReminder } from "@/actions/invoices";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * An overdue invoice, said at the top of its page, with the reminder one click away (E4).
 *
 * The reminder goes to the customer in their language with the courtesy PDF; the server
 * decides what is overdue (the receivables schedule's figures) and refuses a second one within
 * the hour. When the customer was last reminded is shown, so nobody chases twice in a day.
 */
export function OverdueBanner({
  invoiceId,
  daysLate,
  overdueText,
  customerEmail,
  remindedAt,
  reminderCount,
  canWrite,
}: {
  invoiceId: string;
  daysLate: number;
  /** "€ 500,00", formatted by the page in the invoice's currency. */
  overdueText: string;
  customerEmail: string | null;
  remindedAt: Date | string | null;
  reminderCount: number;
  canWrite: boolean;
}) {
  const t = useTranslations("invoices.reminder");
  const format = useFormatter();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(customerEmail ?? "");
  const [pending, startTransition] = useTransition();

  function send() {
    startTransition(async () => {
      const r = await sendPaymentReminder(invoiceId, to).catch(() => null);
      if (!r?.ok) {
        toast.error(r && !r.ok ? r.error : t("failed"));
        return;
      }
      toast.success(t("sent", { to }));
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-sm">
      <AlarmClockIcon className="size-4 shrink-0 text-red-600" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{t("overdue", { days: daysLate, amount: overdueText })}</p>
        {remindedAt && (
          <p className="text-muted-foreground text-xs">
            {t("lastReminder", {
              when: format.dateTime(new Date(remindedAt), { dateStyle: "medium", timeStyle: "short" }),
              count: reminderCount,
            })}
          </p>
        )}
      </div>
      {canWrite && (
        <Button size="sm" variant="outline" className="shrink-0 gap-1.5" onClick={() => setOpen(true)}>
          <MailIcon className="size-3.5" aria-hidden /> {t("button")}
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description", { amount: overdueText })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reminder-to">{t("recipient")}</Label>
            <Input
              id="reminder-to"
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="amministrazione@cliente.it"
            />
            {!customerEmail && <p className="text-muted-foreground text-xs">{t("noCustomerEmail")}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              {t("cancel")}
            </Button>
            <Button onClick={send} disabled={pending || !to.trim()} className="gap-1.5">
              {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              {t("send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
