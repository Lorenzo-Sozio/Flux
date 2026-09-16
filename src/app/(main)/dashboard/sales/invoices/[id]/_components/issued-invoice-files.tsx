"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { Archive, FileCode2, FileText, Loader2, Mail } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";

import { archiveInvoiceAction, sendInvoiceCopy } from "@/actions/invoices";
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

const when = (iso: string | null, locale: string) =>
  iso
    ? new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-GB", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Europe/Rome",
      }).format(new Date(iso))
    : null;

/**
 * What can be done with an issued invoice: download the courtesy PDF and the XML,
 * send the PDF to the customer, and see whether both files are kept.
 */
export function IssuedInvoiceFiles({
  invoiceId,
  archivedAt,
  emailedAt,
  emailedTo,
  customerEmail,
  canWrite,
}: {
  invoiceId: string;
  archivedAt: string | null;
  emailedAt: string | null;
  emailedTo: string | null;
  customerEmail: string | null;
  canWrite: boolean;
}) {
  const t = useTranslations("invoices.files");
  const router = useRouter();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(emailedTo ?? customerEmail ?? "");
  const [sending, setSending] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const send = async () => {
    setSending(true);
    try {
      const result = await sendInvoiceCopy(invoiceId, to);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("sent", { to: to.trim() }));
      setOpen(false);
      router.refresh();
    } finally {
      setSending(false);
    }
  };

  const archive = async () => {
    setArchiving(true);
    try {
      const result = await archiveInvoiceAction(invoiceId);
      if (result.ok) {
        toast.success(t("archivedToast"));
        router.refresh();
      } else {
        toast.error(result.error ?? t("archiveFailed"));
      }
    } finally {
      setArchiving(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-col items-start gap-2 sm:items-end">
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" className="gap-1.5">
          <a href={`/api/invoices/${invoiceId}/pdf`} download>
            <FileText className="h-4 w-4" /> {t("downloadPdf")}
          </a>
        </Button>
        <Button asChild variant="outline" className="gap-1.5">
          <a href={`/api/invoices/${invoiceId}/xml`} download>
            <FileCode2 className="h-4 w-4" /> {t("downloadXml")}
          </a>
        </Button>
        {canWrite && (
          <Button className="gap-1.5" onClick={() => setOpen(true)}>
            <Mail className="h-4 w-4" /> {t("send")}
          </Button>
        )}
      </div>
      <div className="space-y-0.5 text-muted-foreground text-xs sm:text-right">
        {archivedAt ? (
          <p className="flex items-center gap-1 sm:justify-end">
            <Archive className="h-3 w-3" /> {t("archivedOn", { when: when(archivedAt, locale) ?? "" })}
          </p>
        ) : (
          <p className="flex flex-wrap items-center gap-1 sm:justify-end">
            <Archive className="h-3 w-3" /> {t("notArchived")}
            {canWrite && (
              <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={archive} disabled={archiving}>
                {archiving ? <Loader2 className="h-3 w-3 animate-spin" /> : t("archiveNow")}
              </Button>
            )}
          </p>
        )}
        {emailedAt && emailedTo && <p>{t("emailedOn", { when: when(emailedAt, locale) ?? "", to: emailedTo })}</p>}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("sendTitle")}</DialogTitle>
            <DialogDescription>{t("sendDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="invoice-send-to">{t("recipient")}</Label>
            <Input
              id="invoice-send-to"
              type="email"
              value={to}
              placeholder={t("recipientPlaceholder")}
              onChange={(e) => setTo(e.target.value)}
            />
            {!customerEmail && <p className="text-muted-foreground text-xs">{t("noCustomerEmail")}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={send} disabled={sending || !to.trim()} className="gap-1.5">
              {sending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t("sendButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
