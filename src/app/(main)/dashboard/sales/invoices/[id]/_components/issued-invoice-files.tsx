"use client";

import { useState } from "react";

import { Archive, CheckCircle2, FileCode2, FileText, Loader2, Mail } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";

import {
  archiveInvoiceAction,
  getInvoiceEmailDraftAction,
  previewInvoiceEmailAction,
  sendInvoiceCopy,
} from "@/actions/invoices";
import { SendEmailModal } from "@/components/crm/send-email-modal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
  documentNumber,
  emailedTo,
  customerEmail,
  customer,
}: {
  invoiceId: string;
  documentNumber: string | null;
  emailedTo: string | null;
  customerEmail: string | null;
  /** The company the invoice is to: its fields fill the text, the email lands on its timeline. */
  customer: { id: string | null; name: string | null };
}) {
  const t = useTranslations("invoices.files");
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <Mail className="size-3.5" aria-hidden /> {t("send")}
      </Button>
      <SendEmailModal
        entity={{ id: customer.id ?? "", name: customer.name, email: customerEmail }}
        entityType="company"
        trigger={null}
        open={open}
        onOpenChange={setOpen}
        document={{
          draftKey: `invoice-copy:${invoiceId}`,
          title: t("sendTitle"),
          description: t("sendDescription"),
          parts: [{ label: t("partPdf", { number: documentNumber ?? "" }), kind: "file" }],
          defaultTo: emailedTo ?? customerEmail,
          load: () => getInvoiceEmailDraftAction(invoiceId, "copy"),
          send: (email) => sendInvoiceCopy(invoiceId, email),
          preview: (email) => previewInvoiceEmailAction(invoiceId, email),
          submitLabel: t("sendButton"),
          onSent: (to) => {
            toast.success(t("sent", { to }));
          },
        }}
      />
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
  const locale = useLocale();
  const [archiving, setArchiving] = useState(false);

  const archive = async () => {
    setArchiving(true);
    try {
      const result = await archiveInvoiceAction(invoiceId);
      if (result.ok) {
        toast.success(t("archivedToast"));
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
