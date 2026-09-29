"use client";

import { useTransition } from "react";

import { useRouter } from "next/navigation";

import { CheckCircle2, CircleAlert, FileCode2, Loader2, RefreshCw, Send, XCircle } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";

import { markSentManually, refreshInvoiceSdiStatus, sendInvoiceToSdi } from "@/actions/sdi";
import { Button } from "@/components/ui/button";
import { maySend } from "@/lib/sdi/status";
import type { SdiChannel, SdiStatus } from "@/lib/sdi/types";

/**
 * Where an issued invoice stands with SDI, and the one thing to do next (src/lib/sdi/).
 *
 * ⚠️⚠️ Issuing numbers an invoice; only SDI makes it one for the tax authority. So the page says,
 * until it is done, what is missing: sending it (through the intermediary, or by hand), SDI's
 * answer, or — when SDI discarded it — that for the Agenzia it was never issued.
 */
export function SdiPanel({
  invoiceId,
  status,
  message,
  channel,
  providerLabel,
  xmlTaken,
  onXmlTaken,
  canIssue,
  sentAt,
}: {
  invoiceId: string;
  status: SdiStatus | null;
  message: string | null;
  /** How the workspace reaches SDI today. */
  channel: SdiChannel;
  providerLabel: string | null;
  xmlTaken: boolean;
  onXmlTaken: () => void;
  canIssue: boolean;
  sentAt: string | null;
}) {
  const t = useTranslations("invoices.sdi");
  const format = useFormatter();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) {
    startTransition(async () => {
      const r = await action().catch(() => null);
      if (!r?.ok) toast.error(r && !r.ok ? r.error : t("failed"));
      else toast.success(done);
      router.refresh();
    });
  }

  const send = () => run(() => sendInvoiceToSdi(invoiceId), t("sent", { provider: providerLabel ?? "" }));
  const refresh = () => run(() => refreshInvoiceSdiStatus(invoiceId), t("refreshed"));
  const manual = () => run(() => markSentManually(invoiceId), t("markedManual"));
  const spinner = pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null;
  // The intermediary's words, except the reasons Flux itself gives (src/lib/sdi/fattureincloud.ts),
  // which are said in the reader's language.
  const detail =
    !message || message === "interrupted"
      ? null
      : message.startsWith("totals:")
        ? t("reasons.totals", { detail: message.slice("totals:".length) })
        : message.startsWith("vat:")
          ? t("reasons.vat", { detail: message.slice("vat:".length) })
          : message === "TD02"
            ? t("reasons.deposit")
            : message;
  const when = sentAt ? format.dateTime(new Date(sentAt), { dateStyle: "medium", timeStyle: "short" }) : null;

  const download = (
    <Button asChild size="sm" variant="outline" className="shrink-0 gap-1.5">
      <a href={`/api/invoices/${invoiceId}/xml`} download onClick={onXmlTaken}>
        <FileCode2 className="size-3.5" aria-hidden /> {t("downloadXml")}
      </a>
    </Button>
  );
  const markButton = canIssue && (
    <Button size="sm" variant="ghost" className="shrink-0" onClick={manual} disabled={pending}>
      {t("markManual")}
    </Button>
  );

  // Nothing valid reached SDI yet: send it — through the intermediary, or by hand.
  if (maySend(status)) {
    if (channel === "manual") {
      // Invoices downloaded before this panel existed are not nagged about for ever.
      if (xmlTaken && status === null) return null;
      return (
        <Box tone="info" icon={<FileCode2 className="size-4 shrink-0 text-blue-600" aria-hidden />}>
          <p className="min-w-0 flex-1">{t("manualReminder")}</p>
          <div className="flex flex-wrap gap-2">
            {download}
            {markButton}
          </div>
        </Box>
      );
    }
    return (
      <Box
        tone={status ? "danger" : "info"}
        icon={
          status ? (
            <CircleAlert className="size-4 shrink-0 text-red-600" aria-hidden />
          ) : (
            <Send className="size-4 shrink-0 text-blue-600" aria-hidden />
          )
        }
      >
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium">
            {status === "send_failed"
              ? message === "interrupted"
                ? t("interrupted", { provider: providerLabel ?? "" })
                : t("sendFailed", { provider: providerLabel ?? "" })
              : status === "error"
                ? t("providerError", { provider: providerLabel ?? "" })
                : t("toSend", { provider: providerLabel ?? "" })}
          </p>
          {detail && <p className="break-words text-muted-foreground text-xs">{detail}</p>}
          {/* ⚠️ Downloaded already: it may have gone to SDI another way, and a second copy is discarded. */}
          {xmlTaken && <p className="text-amber-800 text-xs dark:text-amber-300">{t("downloadedWarning")}</p>}
        </div>
        {canIssue && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="shrink-0 gap-1.5" onClick={send} disabled={pending}>
              {spinner ?? <Send className="size-3.5" aria-hidden />} {status ? t("retry") : t("send")}
            </Button>
            {markButton}
          </div>
        )}
      </Box>
    );
  }

  if (status === "sending" || status === "pending") {
    return (
      <Box tone="info" icon={<Loader2 className="size-4 shrink-0 animate-spin text-blue-600" aria-hidden />}>
        <p className="min-w-0 flex-1">
          {t("waiting", { provider: providerLabel ?? "" })}
          {when ? ` · ${t("sentAt", { when })}` : ""}
        </p>
        <Button size="sm" variant="outline" className="shrink-0 gap-1.5" onClick={refresh} disabled={pending}>
          {spinner ?? <RefreshCw className="size-3.5" aria-hidden />} {t("refresh")}
        </Button>
      </Box>
    );
  }

  if (status === "rejected" || status === "refused") {
    return (
      <Box tone="danger" icon={<XCircle className="size-4 shrink-0 text-red-600" aria-hidden />}>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium">{status === "rejected" ? t("rejected") : t("refused")}</p>
          {detail && <p className="break-words text-xs">{detail}</p>}
          <p className="text-muted-foreground text-xs">
            {status === "rejected" ? t("rejectedHint") : t("refusedHint")}
          </p>
        </div>
      </Box>
    );
  }

  if (status === "not_delivered") {
    return (
      <Box tone="warning" icon={<CircleAlert className="size-4 shrink-0 text-amber-600" aria-hidden />}>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium">{t("notDelivered")}</p>
          <p className="text-muted-foreground text-xs">{t("notDeliveredHint")}</p>
        </div>
      </Box>
    );
  }

  // Delivered, accepted, past the terms, or sent by hand: a line, not a banner.
  return (
    <p className="flex items-center gap-1.5 text-emerald-700 text-sm dark:text-emerald-400">
      <CheckCircle2 className="size-4 shrink-0" aria-hidden />
      {t(`done.${status as "delivered" | "accepted" | "expired" | "sent_manually"}`)}
      {when && status !== "sent_manually" ? ` · ${t("sentAt", { when })}` : ""}
    </p>
  );
}

function Box({
  tone,
  icon,
  children,
}: {
  tone: "info" | "warning" | "danger";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const border =
    tone === "danger"
      ? "border-red-500/40 bg-red-500/5"
      : tone === "warning"
        ? "border-amber-500/40 bg-amber-500/5"
        : "border-blue-500/40 bg-blue-500/5";
  return (
    <div className={`flex flex-wrap items-start gap-3 rounded-lg border p-3 text-sm ${border}`}>
      {icon}
      {children}
    </div>
  );
}
