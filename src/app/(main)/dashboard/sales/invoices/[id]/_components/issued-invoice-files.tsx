"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { Archive, CheckCircle2, FileCode2, FileText, Loader2, Mail } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";

import { archiveInvoiceAction, sendInvoiceCopy } from "@/actions/invoices";
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
 * Sends the courtesy PDF to the customer: the button and the dialog that asks where.
 *
 * Split from the files card so the everyday action on an issued invoice can sit in
 * the hero, first thing on a phone, while the downloads and the archive state stay
 * with the rest of the reference material. Same action, same dialog as before.
 */
export function SendInvoiceCopyButton({
  invoiceId,
  emailedTo,
  customerEmail,
}: {
  invoiceId: string;
  emailedTo: string | null;
  customerEmail: string | null;
}) {
  const t = useTranslations("invoices.files");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(emailedTo ?? customerEmail ?? "");
  const [sending, setSending] = useState(false);

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

  return (
    <>
      <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <Mail className="size-3.5" aria-hidden /> {t("send")}
      </Button>
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
              {sending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              {t("sendButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The courtesy PDF as a hero button: the file somebody asks for most. */
export function DownloadPdfButton({ invoiceId }: { invoiceId: string }) {
  const t = useTranslations("invoices.files");
  return (
    <Button asChild size="sm" variant="outline" className="gap-1.5">
      <a href={`/api/invoices/${invoiceId}/pdf`} download>
        <FileText className="size-3.5" aria-hidden /> {t("downloadPdf")}
      </a>
    </Button>
  );
}

/**
 * The files of an issued invoice: download the courtesy PDF and the XML, and see
 * whether both are kept and whether a copy went to the customer.
 */
export function IssuedInvoiceFiles({
  invoiceId,
  archivedAt,
  emailedAt,
  emailedTo,
  canWrite,
}: {
  invoiceId: string;
  archivedAt: string | null;
  emailedAt: string | null;
  emailedTo: string | null;
  canWrite: boolean;
}) {
  const t = useTranslations("invoices.files");
  const tR = useTranslations("record");
  const router = useRouter();
  const locale = useLocale();
  const [archiving, setArchiving] = useState(false);

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
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{tR("tabs.files")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <Button asChild variant="outline" className="justify-start gap-2">
            <a href={`/api/invoices/${invoiceId}/pdf`} download>
              <FileText className="size-4" aria-hidden /> {t("downloadPdf")}
            </a>
          </Button>
          <Button asChild variant="outline" className="justify-start gap-2">
            <a href={`/api/invoices/${invoiceId}/xml`} download>
              <FileCode2 className="size-4" aria-hidden /> {t("downloadXml")}
            </a>
          </Button>
        </div>

        <div className="space-y-2 border-t pt-3 text-muted-foreground text-xs">
          {archivedAt ? (
            <p className="flex items-start gap-1.5">
              <Archive className="mt-px size-3.5 shrink-0" aria-hidden />
              {t("archivedOn", { when: when(archivedAt, locale) ?? "" })}
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="flex items-start gap-1.5">
                <Archive className="mt-px size-3.5 shrink-0" aria-hidden />
                {t("notArchived")}
              </p>
              {canWrite && (
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto min-h-9 p-0 text-xs"
                  onClick={archive}
                  disabled={archiving}
                >
                  {archiving ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : t("archiveNow")}
                </Button>
              )}
            </div>
          )}
          {emailedAt && emailedTo && (
            <p className="flex items-start gap-1.5 break-words">
              <CheckCircle2 className="mt-px size-3.5 shrink-0" aria-hidden />
              <span className="min-w-0">{t("emailedOn", { when: when(emailedAt, locale) ?? "", to: emailedTo })}</span>
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
