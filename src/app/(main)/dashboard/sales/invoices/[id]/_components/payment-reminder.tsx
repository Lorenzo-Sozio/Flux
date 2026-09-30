"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { AlarmClockIcon, MailIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";

import { getInvoiceEmailDraftAction, previewInvoiceEmailAction, sendPaymentReminder } from "@/actions/invoices";
import { SendEmailModal } from "@/components/crm/send-email-modal";
import { Button } from "@/components/ui/button";

/**
 * An overdue invoice, said at the top of its page, with the reminder one click away (E4).
 *
 * The reminder opens in the CRM's email dialog, in the customer's language, on the text the
 * server writes from the receivables schedule's figures — editable, with the templates and the
 * copilot like any email. The courtesy PDF goes with it, and the server still decides that
 * something is overdue and refuses a second reminder within the hour, whatever the text says. When the customer was last reminded is shown, so nobody chases twice in a day.
 */
export function OverdueBanner({
  invoiceId,
  daysLate,
  overdueText,
  customerEmail,
  customer,
  remindedAt,
  reminderCount,
  canWrite,
}: {
  invoiceId: string;
  daysLate: number;
  /** "€ 500,00", formatted by the page in the invoice's currency. */
  overdueText: string;
  customerEmail: string | null;
  /** The company the invoice is to: its fields fill the text, the email lands on its timeline. */
  customer: { id: string | null; name: string | null };
  remindedAt: Date | string | null;
  reminderCount: number;
  canWrite: boolean;
}) {
  const t = useTranslations("invoices.reminder");
  const format = useFormatter();
  const router = useRouter();
  const [open, setOpen] = useState(false);

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
        <>
          <Button size="sm" variant="outline" className="shrink-0 gap-1.5" onClick={() => setOpen(true)}>
            <MailIcon className="size-3.5" aria-hidden /> {t("button")}
          </Button>
          <SendEmailModal
            entity={{ id: customer.id ?? "", name: customer.name, email: customerEmail }}
            entityType="company"
            trigger={null}
            open={open}
            onOpenChange={setOpen}
            document={{
              draftKey: `invoice-reminder:${invoiceId}`,
              title: t("title"),
              description: t("description", { amount: overdueText }),
              parts: [{ label: t("partPdf"), kind: "file" }],
              defaultTo: customerEmail,
              load: () => getInvoiceEmailDraftAction(invoiceId, "reminder"),
              send: (email) => sendPaymentReminder(invoiceId, email),
              preview: (email) => previewInvoiceEmailAction(invoiceId, email),
              submitLabel: t("send"),
              onSent: (to) => {
                toast.success(t("sent", { to }));
                router.refresh();
              },
            }}
          />
        </>
      )}
    </div>
  );
}
