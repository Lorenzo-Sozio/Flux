"use client";

import { type ReactNode, useEffect, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  AlertTriangle,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  CopyPlus,
  Download,
  ExternalLink,
  FileText,
  Handshake,
  History,
  Info,
  Link2,
  Mail,
  MoreHorizontal,
  Package,
  Pencil,
  Printer,
  ShieldCheck,
  User,
  UserRound,
  X,
  XCircle,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";

import { convertQuoteToOrderAction } from "@/actions/orders";
import {
  approveQuoteAction,
  createQuoteRevisionAction,
  type getQuoteById,
  previewQuoteEmailAction,
  rejectQuoteAction,
  requestApprovalAction,
  sendQuoteEmailAction,
  updateQuoteAction,
} from "@/actions/quotes";
import { EmailAddressButton } from "@/components/crm/email-address-button";
import {
  EmptyHint,
  Field,
  FieldList,
  MetaItem,
  Metric,
  MetricStrip,
  RecordHero,
  StatusBadge,
  type Tone,
} from "@/components/crm/record/record-page";
import { RecordSections } from "@/components/crm/record/record-sections";
import { type EmailDocument, SendEmailModal } from "@/components/crm/send-email-modal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useCurrency } from "@/hooks/use-currency";
import {
  type DocumentLanguage,
  fill,
  formatDocumentDate,
  formatDocumentMoney,
  QUOTE_TEXT,
} from "@/lib/document-language";
import { documentValues } from "@/lib/email-placeholders";
import { can } from "@/lib/permissions";
import { paragraphsToHtml } from "@/lib/plain-text-html";
import { whatToChase } from "@/lib/quote-followup";
import { quoteStatusConfig } from "@/lib/quote-status";
import { cn } from "@/lib/utils";

type Quote = Awaited<ReturnType<typeof getQuoteById>>;

interface QuoteDetailProps {
  quote: Quote;
  autoOpenSend?: boolean;
  onStatusChange?: (newStatus: string) => void;
  /** The **workspace** role. Never the platform one: see the two scales in CLAUDE.md. */
  tenantRole?: string | null;
  /** The language emails to this customer are drafted in. */
  customerLanguage?: DocumentLanguage;
  /** Follow-up subjects and bodies in that language, with `{quoteNumber}` and `{days}` to fill. */
  customerDrafts?: Record<string, { subject: string; body: string }>;
}

/** Activity types with a label under `quotes.detail.activity`; anything else shows its raw type. */
const ACTIVITY_TYPES = new Set([
  "created",
  "sent",
  "viewed",
  "opened_email",
  "clicked_email",
  "accepted",
  "declined",
  "reminded",
  "updated",
  "approval_requested",
  "approved",
  "rejected",
  "proposed",
]);

/**
 * The five shared tones, so a quote's green is the deal's green. Waiting on a
 * person is amber; an answer that went against us, or an offer that lapsed, is red.
 */
const STATUS_TONE: Record<string, Tone> = {
  draft: "neutral",
  pending_approval: "warning",
  approved: "info",
  sent: "info",
  viewed: "info",
  accepted: "success",
  converted: "success",
  declined: "danger",
  expired: "danger",
};

/** Statuses in which the expiry date still matters: nobody has answered yet. */
const AWAITING_ANSWER = new Set(["draft", "pending_approval", "approved", "sent", "viewed"]);

/** How many rows a list shows before the rest folds away behind "Show more". */
const VISIBLE_ROWS = 5;

const DAY = 86_400_000;
const DATE_FORMAT = { day: "numeric", month: "short", year: "numeric" } as const;
const DATE_TIME_FORMAT = { ...DATE_FORMAT, hour: "2-digit", minute: "2-digit" } as const;
const SHORT_DATE_TIME_FORMAT = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" } as const;

/**
 * Midnight UTC of a date, in days.
 *
 * ⚠️ UTC on purpose, not the local day the deal page uses. This component renders
 * on the server (UTC on Workers) and again in the browser, and a count of days
 * that disagreed between the two would be a hydration mismatch at every midnight
 * but one's own. The expiry is stored from a date input as UTC midnight anyway,
 * so UTC is also the day it actually means.
 */
const utcDay = (d: Date) => Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / DAY);

/**
 * One quote, laid out for whoever has to get it signed.
 *
 * The hero answers what it is, where it stands and what to press next — the
 * status decides which two actions those are, so a draft offers Send and Edit, an
 * accepted quote offers the order, and an approver sees Approve. The figures that
 * decide the chase (total, how long it stands, what was given away) sit under it.
 * The lines and the totals are the work column; who it is for, whether the
 * customer opened it, and what happened to it are reference beside them.
 *
 * ⚠️ Every action the previous layout had is still here, most of them where the
 * status makes them relevant; the rarely pressed ones (print, and the PDF when two
 * status actions already fill the row) are in "More", which opens no dialog.
 */
export function QuoteDetail({
  quote,
  autoOpenSend = false,
  onStatusChange,
  tenantRole,
  customerLanguage = "it",
  customerDrafts,
}: QuoteDetailProps) {
  const router = useRouter();
  const t = useTranslations("quotes.detail");
  const tq = useTranslations("quotes");
  const tf = useTranslations("quoteFollowUp");
  const tForm = useTranslations("quotes.form");
  const tR = useTranslations("record");
  const formatter = useFormatter();
  const { formatMoney } = useCurrency();
  // In the quote's own currency: the figure the customer was offered, not a conversion.
  const fmt = (amount: string | number | null) => formatMoney(amount, quote.currency);
  const [isLoading, setIsLoading] = useState(false);
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [showDeclineDialog, setShowDeclineDialog] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [showFollowUpDialog, setShowFollowUpDialog] = useState(false);
  const [rejectNote, setRejectNote] = useState("");

  // ⚠️ Asked as a capability, not compared as a string. This line used to read
  // the platform role, which is "user" for every customer, so no workspace admin
  // ever saw the approve button and a quote sent for approval could not be
  // approved from the interface at all — while `approveQuoteAction` would have
  // let them, because it asks the right question.
  const canApprove = can(tenantRole ?? null, "quote:approve");
  // A viewer reads the quote; the controls that would only answer "forbidden" are
  // not drawn for them. The same capabilities the actions ask for.
  const canWrite = can(tenantRole ?? null, "quote:write");
  const canOrder = can(tenantRole ?? null, "order:write");

  async function runAction(action: () => Promise<void>, successMsg: string, errorMsg: string) {
    setIsLoading(true);
    try {
      await action();
      toast.success(successMsg);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : errorMsg);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (autoOpenSend && (quote.status === "draft" || quote.status === "approved")) {
      setShowEmailDialog(true);
    }
  }, [autoOpenSend, quote.status]);

  // Whether this quote wants chasing, and about what. Decided by two dates and
  // nothing else, in a pure module that can be argued with in one place
  // (rilievo S-06). Null means there is nothing to say, and then nothing renders.
  const followUp = whatToChase(
    {
      quoteNumber: quote.quoteNumber,
      status: quote.status,
      sentAt: quote.sentAt ? new Date(quote.sentAt) : null,
      viewedAt: quote.viewedAt ? new Date(quote.viewedAt) : null,
      expiresAt: quote.expiresAt ? new Date(quote.expiresAt) : null,
    },
    Date.now(),
  );

  const FOLLOW_UP_KEYS = {
    "not-opened": "notOpened",
    "no-answer": "noAnswer",
    expiring: "expiring",
    expired: "expired",
  } as const;

  const followUpKey = followUp ? FOLLOW_UP_KEYS[followUp.kind] : null;
  const followUpVars = { quoteNumber: quote.quoteNumber, days: followUp?.days ?? 0 };
  const statusCfg = quoteStatusConfig(quote.status);
  const contactName = quote.contact ? `${quote.contact.firstName} ${quote.contact.lastName}`.trim() : null;

  // The email dialog every record uses, in its document mode: the quote's summary and link are
  // added by the server under whatever the person writes (sendQuoteEmailAction).
  const emailTo = quote.contact
    ? { entity: { ...quote.contact, companyName: quote.company?.name }, entityType: "contact" as const }
    : quote.company
      ? {
          entity: { id: quote.company.id, name: quote.company.name, email: quote.company.mainEmail },
          entityType: "company" as const,
        }
      : { entity: { id: "" }, entityType: undefined };
  const quoteEmail = (
    kind: "send" | "followUp",
    text: { subject: string; message: string },
    labels: { title: string; description: string; submit: string },
    onSent: () => void,
  ): EmailDocument => ({
    draftKey: `quote:${quote.id}:${kind}`,
    title: labels.title,
    description: labels.description,
    parts: [{ label: tq("sendEmail.partLink", { number: quote.quoteNumber }), kind: "link" }],
    defaultTo: quote.contact?.email ?? quote.company?.mainEmail ?? null,
    load: async () => ({
      ok: true,
      subject: text.subject,
      bodyHtml: paragraphsToHtml(text.message),
      // In the customer's language and the quote's currency, as the quote itself says them.
      fields: documentValues({
        quoteNumber: quote.quoteNumber,
        amount: formatDocumentMoney(quote.totalAmount, quote.currency, customerLanguage),
        dueDate: quote.expiresAt ? formatDocumentDate(quote.expiresAt, customerLanguage) : null,
      }),
    }),
    send: async (email) => {
      const r = await sendQuoteEmailAction(quote.id, email);
      return r.success ? { ok: true } : { ok: false, error: r.error };
    },
    preview: (email) => previewQuoteEmailAction(quote.id, email),
    signature: true,
    submitLabel: labels.submit,
    onSent,
  });
  const contactPhone = quote.contact?.mobile || quote.contact?.phone || null;

  async function handleStatusChange(newStatus: string, reason?: string) {
    await runAction(
      async () => {
        await updateQuoteAction(quote.id, {
          status: newStatus as "accepted" | "declined",
          ...(reason?.trim() ? { declineReason: reason.trim() } : {}),
        });
        onStatusChange?.(newStatus);
      },
      newStatus === "accepted" ? t("markedAccepted") : t("markedDeclined"),
      t("statusUpdateFailed"),
    );
  }

  // "The customer wants 5% less": a new draft at the next version, the old one superseded (§7.3).
  const handleRevision = async () => {
    setIsLoading(true);
    try {
      const result = await createQuoteRevisionAction(quote.id);
      toast.success(t("revisionCreated", { quoteNumber: result.quoteNumber }));
      router.push(`/dashboard/sales/quotes/${result.quoteId}/edit`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("revisionFailed"));
    } finally {
      setIsLoading(false);
    }
  };
  const canRevise = canWrite && ["sent", "viewed", "declined", "expired"].includes(quote.status);

  const handleRequestApproval = () =>
    runAction(() => requestApprovalAction(quote.id), t("approvalRequested"), t("approvalRequestFailed"));

  const handleApprove = () => runAction(() => approveQuoteAction(quote.id), t("approved"), t("approveFailed"));

  /**
   * The last manual re-typing in the sales month.
   *
   * An accepted quote already holds every figure the order needs, so it writes the
   * order itself and lands the user on it — and closes the deal behind the quote,
   * which is the step people forgot and which kept won business in the forecast.
   */
  const handleConvert = async () => {
    setIsLoading(true);
    try {
      const result = await convertQuoteToOrderAction(quote.id);
      toast.success(t("orderCreated", { orderNumber: result.orderNumber }));
      router.push(`/dashboard/sales/orders/${result.orderId}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("orderCreateFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  async function handleReject() {
    await runAction(() => rejectQuoteAction(quote.id, rejectNote), t("rejected"), t("rejectFailed"));
    setShowRejectDialog(false);
    setRejectNote("");
  }

  const copyPublicLink = () => {
    const url = `${window.location.origin}/q/${quote.publicToken}`;
    navigator.clipboard.writeText(url).then(() => toast.success(t("publicLinkCopied")));
  };
  const openPrint = () => window.open(`/api/quotes/${quote.id}`, "_blank");
  const openPdf = () => window.open(`/api/quotes/${quote.id}/pdf`, "_blank");

  // ── Derived figures ──
  const expiresAt = quote.expiresAt ? new Date(quote.expiresAt) : null;
  const daysLeft = expiresAt ? utcDay(expiresAt) - utcDay(new Date()) : null;
  const stillOpen = AWAITING_ANSWER.has(quote.status);
  const lapsed = quote.status === "expired" || (stillOpen && daysLeft != null && daysLeft < 0);
  const discountAmount = parseFloat(quote.discountAmount ?? "0");
  const emailOpens = quote.activities.filter((a) => a.type === "opened_email").length;
  const linkClicks = quote.activities.filter((a) => a.type === "clicked_email").length;

  // ── Hero actions: what the status makes the next step, at most two, then More ──
  const statusActions: ReactNode[] = [];
  if (canWrite && (quote.status === "draft" || quote.status === "approved")) {
    /*
      ⚠️ Also when approved, and this is the fix that matters. The `approved`
      status used to have NO command: whoever went through internal approval
      found a signed-off quote and no way to send it, and the only route that
      worked was to skip approval altogether and send from the draft. The state
      machine has always allowed approved → sent; it was the interface that did
      not offer it. A flow that stops at the end does not look like a bug: it
      looks like a button somebody forgot where they put.
    */
    statusActions.push(
      <Button key="send" size="sm" onClick={() => setShowEmailDialog(true)}>
        <Mail className="size-3.5" aria-hidden />
        {t("sendQuote")}
      </Button>,
    );
  }
  if (canWrite && quote.status === "draft") {
    statusActions.push(
      <Button key="edit" asChild size="sm" variant="outline">
        <Link href={`/dashboard/sales/quotes/${quote.id}/edit`}>
          <Pencil className="size-3.5" aria-hidden />
          {tR("edit")}
        </Link>
      </Button>,
    );
  }
  if (quote.status === "pending_approval" && canApprove) {
    statusActions.push(
      <Button
        key="approve"
        size="sm"
        className="bg-emerald-600 text-white hover:bg-emerald-700"
        onClick={handleApprove}
        disabled={isLoading}
      >
        <CheckCircle2 className="size-3.5" aria-hidden />
        {t("approveQuote")}
      </Button>,
      <Button
        key="reject"
        size="sm"
        variant="outline"
        className="text-destructive hover:text-destructive"
        onClick={() => setShowRejectDialog(true)}
        disabled={isLoading}
      >
        <XCircle className="size-3.5" aria-hidden />
        {t("rejectWithNote")}
      </Button>,
    );
  }
  // ⚠️ From `sent` too (§7.2): a customer who says yes on the phone without ever opening the
  // link is still a yes, and there was no way to record it.
  if (canWrite && (quote.status === "sent" || quote.status === "viewed")) {
    statusActions.push(
      <Button
        key="accepted"
        size="sm"
        variant="outline"
        className="text-emerald-700 hover:text-emerald-700 dark:text-emerald-400"
        onClick={() => handleStatusChange("accepted")}
        disabled={isLoading}
      >
        <Check className="size-3.5" aria-hidden />
        {t("markAccepted")}
      </Button>,
      <Button
        key="declined"
        size="sm"
        variant="outline"
        className="text-destructive hover:text-destructive"
        onClick={() => setShowDeclineDialog(true)}
        disabled={isLoading}
      >
        <X className="size-3.5" aria-hidden />
        {t("markDeclined")}
      </Button>,
    );
  }
  if (canOrder && quote.status === "accepted") {
    statusActions.push(
      <Button key="order" size="sm" onClick={handleConvert} disabled={isLoading}>
        <Package className="size-3.5" aria-hidden />
        {t("createOrder")}
      </Button>,
    );
  }
  // The PDF is what gets attached to an email by hand, so it is a button of its
  // own whenever the status leaves room for one.
  const pdfInRow = statusActions.length < 2;
  const requestApproval = canWrite && quote.status === "draft" && !canApprove;

  const heroActions = (
    <>
      {statusActions}
      {pdfInRow && (
        <Button size="sm" variant="outline" onClick={openPdf}>
          <Download className="size-3.5" aria-hidden />
          {t("downloadPdf")}
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline">
            <MoreHorizontal className="size-3.5" aria-hidden />
            {tR("more")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {requestApproval && (
            <>
              <DropdownMenuItem onSelect={handleRequestApproval} disabled={isLoading}>
                <ShieldCheck aria-hidden />
                {t("requestApproval")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem onSelect={openPrint}>
            <Printer aria-hidden />
            {t("printPreview")}
          </DropdownMenuItem>
          {!pdfInRow && (
            <DropdownMenuItem onSelect={openPdf}>
              <Download aria-hidden />
              {t("downloadPdf")}
            </DropdownMenuItem>
          )}
          {quote.publicToken && (
            <DropdownMenuItem onSelect={copyPublicLink}>
              <Link2 aria-hidden />
              {t("copyPublicLink")}
            </DropdownMenuItem>
          )}
          {canRevise && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={handleRevision} disabled={isLoading}>
                <CopyPlus aria-hidden />
                {t("newRevision")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  // ── Sections ──

  // What to chase, and why — nothing here is sent on its own (rilievo S-06).
  const followUpCard = followUp && followUpKey && (
    <Card className="border-amber-500/40 bg-amber-500/5">
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2.5 sm:min-w-64">
          <Clock className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          <div className="min-w-0">
            <p className="font-medium text-muted-foreground text-xs">{tf("title")}</p>
            <p className="font-medium text-sm">{tf(`${followUpKey}Badge`, followUpVars)}</p>
            <p className="mt-0.5 text-muted-foreground text-xs">{tf(`${followUpKey}Why`)}</p>
          </div>
        </div>
        {canWrite && (
          <Button variant="outline" size="sm" className="max-sm:w-full" onClick={() => setShowFollowUpDialog(true)}>
            <Mail className="size-3.5" aria-hidden />
            {tf("action")}
          </Button>
        )}
      </CardContent>
    </Card>
  );

  const renderLineCard = (item: Quote["items"][number]) => (
    <li key={item.id} className="flex items-start justify-between gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="break-words font-medium text-sm">{item.description}</p>
        {item.product && <p className="mt-0.5 text-muted-foreground text-xs">{item.product.name}</p>}
        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground text-xs tabular-nums">
          <span>
            {item.quantity} × {fmt(item.unitPrice)}
          </span>
          {parseFloat(item.discountPercent ?? "0") > 0 && (
            <span className="text-amber-700 dark:text-amber-400">{`${item.discountPercent}% (−${fmt(item.discountAmount)})`}</span>
          )}
          {parseFloat(item.taxPercent ?? "0") > 0 && <span>{`${item.taxPercent}% (+${fmt(item.taxAmount)})`}</span>}
        </p>
      </div>
      <span className="shrink-0 font-semibold text-sm tabular-nums">{fmt(item.totalPrice)}</span>
    </li>
  );

  const firstLines = quote.items.slice(0, VISIBLE_ROWS);
  const moreLines = quote.items.slice(VISIBLE_ROWS);

  const lines = (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">{tR("tabs.lines")}</CardTitle>
        <span className="text-muted-foreground text-xs tabular-nums">{quote.items.length}</span>
      </CardHeader>
      <CardContent className="space-y-4">
        {quote.items.length === 0 ? (
          <EmptyHint>{tR("nothingYet")}</EmptyHint>
        ) : (
          <>
            {/* Below `md` a line is a row of its own: what it is, then quantity ×
                price and any discount or tax, the total on the right. The first
                five are on screen; the rest fold away rather than making the
                totals a long scroll down. */}
            <div className="md:hidden">
              <ul className="-my-3 divide-y">{firstLines.map(renderLineCard)}</ul>
              {moreLines.length > 0 && (
                <details className="group/lines mt-3 rounded-md border">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-muted-foreground text-sm hover:text-foreground [&::-webkit-details-marker]:hidden">
                    <span>
                      <span className="group-open/lines:hidden">{tR("showMore")}</span>
                      <span className="hidden group-open/lines:inline">{tR("showLess")}</span>
                      <span className="ml-1 tabular-nums">({moreLines.length})</span>
                    </span>
                    <ChevronDown className="size-4 transition-transform group-open/lines:rotate-180" aria-hidden />
                  </summary>
                  <ul className="divide-y border-t px-3">{moreLines.map(renderLineCard)}</ul>
                </details>
              )}
            </div>
            <div className="-mx-6 hidden border-y md:block">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="pl-6 font-semibold text-xs">{t("description")}</TableHead>
                    <TableHead className="text-right font-semibold text-xs">{t("qty")}</TableHead>
                    <TableHead className="text-right font-semibold text-xs">{t("unitPrice")}</TableHead>
                    <TableHead className="text-right font-semibold text-xs">{t("discount")}</TableHead>
                    <TableHead className="text-right font-semibold text-xs">{t("tax")}</TableHead>
                    <TableHead className="pr-6 text-right font-semibold text-xs">{t("total")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quote.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="pl-6">
                        <div className="font-medium text-sm">{item.description}</div>
                        {item.product && (
                          <div className="mt-0.5 text-muted-foreground text-xs">{item.product.name}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{item.quantity}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{fmt(item.unitPrice)}</TableCell>
                      <TableCell className="text-right text-amber-700 text-sm tabular-nums dark:text-amber-400">
                        {parseFloat(item.discountPercent ?? "0") > 0
                          ? `${item.discountPercent}% (−${fmt(item.discountAmount)})`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground text-sm tabular-nums">
                        {parseFloat(item.taxPercent ?? "0") > 0 ? `${item.taxPercent}% (+${fmt(item.taxAmount)})` : "—"}
                      </TableCell>
                      <TableCell className="pr-6 text-right font-semibold text-sm tabular-nums">
                        {fmt(item.totalPrice)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}

        {/* The totals close the lines they add up, rather than living in a tab of their own. */}
        <div className="ml-auto max-w-sm space-y-2 pt-1">
          <div className="flex justify-between gap-3 text-sm">
            <span className="text-muted-foreground">{t("subtotal")}</span>
            <span className="font-medium tabular-nums">{fmt(quote.subtotal)}</span>
          </div>
          {discountAmount > 0 && (
            <div className="flex justify-between gap-3 text-amber-700 text-sm dark:text-amber-400">
              <span>{t("discountPercent", { percent: quote.discountPercent ?? "0" })}</span>
              <span className="font-medium tabular-nums">−{fmt(quote.discountAmount)}</span>
            </div>
          )}
          {parseFloat(quote.taxAmount ?? "0") > 0 && (
            <div className="flex justify-between gap-3 text-muted-foreground text-sm">
              <span>{t("taxPercent", { percent: quote.taxPercent ?? "0" })}</span>
              <span className="font-medium tabular-nums">+{fmt(quote.taxAmount)}</span>
            </div>
          )}
          <Separator />
          <div className="flex justify-between gap-3">
            <span className="font-semibold">{t("total")}</span>
            <span className="font-bold text-lg tabular-nums">{fmt(quote.totalAmount)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  const details = (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{tR("detailsTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <FieldList>
          <Field label={t("company")} always>
            {quote.company && (
              <Link href={`/dashboard/companies/${quote.company.id}`} className="text-primary hover:underline">
                {quote.company.name}
              </Link>
            )}
          </Field>
          <Field label={t("contact")} always>
            {quote.contact && contactName && (
              <div className="min-w-0 space-y-0.5">
                <Link href={`/dashboard/contacts/${quote.contact.id}`} className="text-primary hover:underline">
                  {contactName}
                </Link>
                {quote.contact.email && (
                  <EmailAddressButton
                    email={quote.contact.email}
                    entity={{ ...quote.contact, companyName: quote.company?.name }}
                    entityType="contact"
                    dealId={quote.dealId ?? undefined}
                    canSend={can(tenantRole ?? null, "record:write")}
                    className="block truncate text-muted-foreground text-xs hover:text-foreground"
                  />
                )}
                {contactPhone && (
                  <a href={`tel:${contactPhone}`} className="block text-muted-foreground text-xs hover:text-foreground">
                    {contactPhone}
                  </a>
                )}
              </div>
            )}
          </Field>
          <Field label={t("deal")}>
            {quote.deal && (
              <Link href={`/dashboard/pipeline/${quote.deal.id}`} className="text-primary hover:underline">
                {quote.deal.name}
              </Link>
            )}
          </Field>
          <Field label={t("owner")}>{quote.owner?.name}</Field>
          <Field label={t("issued")}>{formatter.dateTime(new Date(quote.issuedAt), DATE_FORMAT)}</Field>
          <Field label={t("expires")}>{expiresAt && formatter.dateTime(expiresAt, DATE_FORMAT)}</Field>
          <Field label={tForm("currency")}>{quote.currency}</Field>
          <Field label={tR("updated")}>{formatter.dateTime(new Date(quote.updatedAt), DATE_FORMAT)}</Field>
        </FieldList>

        {/* What the customer reads under the figures. */}
        <div className="border-t pt-3">
          <p className="mb-1 font-medium text-muted-foreground text-xs">{t("notes")}</p>
          {quote.notes ? (
            <p className="whitespace-pre-wrap break-words text-sm">{quote.notes}</p>
          ) : (
            <p className="text-muted-foreground text-sm">—</p>
          )}
        </div>
      </CardContent>
    </Card>
  );

  // Where the quote went and whether anybody opened it: the question behind every chase.
  const tracking = (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("trackingTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <FieldList>
          <Field label={t("sent")} always>
            {quote.sentAt ? (
              formatter.dateTime(new Date(quote.sentAt), DATE_TIME_FORMAT)
            ) : (
              <span className="text-muted-foreground">{t("notSentYet")}</span>
            )}
          </Field>
          {quote.sentAt && (
            <Field label={t("viewed")} always>
              {quote.viewedAt ? (
                formatter.dateTime(new Date(quote.viewedAt), DATE_TIME_FORMAT)
              ) : (
                <span className="text-muted-foreground">{t("notOpenedYet")}</span>
              )}
            </Field>
          )}
          <Field label={t("emailOpens")}>{emailOpens > 0 ? emailOpens : null}</Field>
          <Field label={t("linkClicks")}>{linkClicks > 0 ? linkClicks : null}</Field>
          <Field label={t("accepted")}>
            {quote.acceptedAt && (
              <span className="text-emerald-700 dark:text-emerald-400">
                {formatter.dateTime(new Date(quote.acceptedAt), DATE_TIME_FORMAT)}
              </span>
            )}
          </Field>
          <Field label={t("declined")}>
            {quote.declinedAt && (
              <span className="text-destructive">
                {formatter.dateTime(new Date(quote.declinedAt), DATE_TIME_FORMAT)}
              </span>
            )}
          </Field>
          <Field label={t("declineReason")}>{quote.declineReason}</Field>
        </FieldList>

        {/* The simple electronic signature (src/lib/quote-signature.ts): the record is its weight. */}
        {quote.signedName && (
          <div className="space-y-2 border-t pt-3">
            <p className="font-medium text-muted-foreground text-xs">{t("signatureTitle")}</p>
            <FieldList>
              <Field label={t("signedBy")}>{quote.signedName}</Field>
              <Field label={t("signedAt")}>
                {quote.signedAt ? formatter.dateTime(new Date(quote.signedAt), DATE_TIME_FORMAT) : null}
              </Field>
              <Field label={t("signedIp")}>{quote.signedIp}</Field>
              <Field label={t("signedFingerprint")}>
                {quote.signedPdfSha256 && (
                  <span className="break-all font-mono text-xs" title={quote.signedPdfSha256}>
                    {quote.signedPdfSha256}
                  </span>
                )}
              </Field>
            </FieldList>
            {quote.signedConsent && <p className="text-muted-foreground text-xs italic">«{quote.signedConsent}»</p>}
            {quote.signedPdfKey && (
              <Button asChild variant="outline" size="sm">
                <a href={`/api/quotes/${quote.id}/signed-pdf`}>
                  <Download className="size-3.5" aria-hidden />
                  {t("downloadSigned")}
                </a>
              </Button>
            )}
          </div>
        )}

        {quote.publicToken && (
          <div className="space-y-2 border-t pt-3">
            <p className="font-medium text-muted-foreground text-xs">{t("publicLink")}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <Button variant="outline" size="sm" onClick={copyPublicLink}>
                <Link2 className="size-3.5" aria-hidden />
                {t("copyPublicLink")}
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href={`/q/${quote.publicToken}`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="size-3.5" aria-hidden />
                  {t("openPublicPage")}
                </a>
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );

  const renderActivity = (activity: Quote["activities"][number], idx: number, all: Quote["activities"]) => (
    <li key={activity.id} className="relative flex gap-3 pb-4 last:pb-0">
      {idx < all.length - 1 && <div className="absolute top-6 bottom-0 left-[9px] w-px bg-border" aria-hidden />}
      <div className="z-10 mt-1 size-[18px] shrink-0 rounded-full border-2 border-border bg-background" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-sm leading-tight">
          {ACTIVITY_TYPES.has(activity.type) ? t(`activity.${activity.type}`) : activity.type}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-muted-foreground text-xs">
          <span className="shrink-0">{formatter.dateTime(new Date(activity.createdAt), SHORT_DATE_TIME_FORMAT)}</span>
          {activity.user?.name && <span className="truncate">{activity.user.name}</span>}
          {activity.email && <span className="break-all">({activity.email})</span>}
        </p>
      </div>
    </li>
  );

  const firstActivities = quote.activities.slice(0, VISIBLE_ROWS);
  const olderActivities = quote.activities.slice(VISIBLE_ROWS);

  const history = (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">{tR("tabs.history")}</CardTitle>
        <span className="text-muted-foreground text-xs tabular-nums">{quote.activities.length}</span>
      </CardHeader>
      <CardContent className="space-y-3">
        {quote.activities.length === 0 ? (
          <EmptyHint>{t("noActivity")}</EmptyHint>
        ) : (
          <>
            <ul>{firstActivities.map((a, i) => renderActivity(a, i, firstActivities))}</ul>
            {olderActivities.length > 0 && (
              <details className="group/history rounded-md border">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-muted-foreground text-sm hover:text-foreground [&::-webkit-details-marker]:hidden">
                  <span>
                    <span className="group-open/history:hidden">{tR("showMore")}</span>
                    <span className="hidden group-open/history:inline">{tR("showLess")}</span>
                    <span className="ml-1 tabular-nums">({olderActivities.length})</span>
                  </span>
                  <ChevronDown className="size-4 transition-transform group-open/history:rotate-180" aria-hidden />
                </summary>
                <ul className="border-t p-3">{olderActivities.map((a, i) => renderActivity(a, i, olderActivities))}</ul>
              </details>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );

  // ── Notices under the title: the state of the approval, or where the quote went ──
  const notices: ReactNode[] = [];
  if (quote.status === "pending_approval" && !canApprove) {
    notices.push(
      <Notice key="awaiting" tone="warning" icon={<AlertTriangle aria-hidden />}>
        {t("awaitingApproval")}
      </Notice>,
    );
  }
  if (quote.status === "draft" && quote.approvalNote) {
    notices.push(
      <Notice key="rejected" tone="warning" icon={<AlertTriangle aria-hidden />}>
        <span className="font-medium">{t("rejectedBanner")}</span>
        <span className="mt-0.5 block text-xs opacity-90">{quote.approvalNote}</span>
      </Notice>,
    );
  }
  if (quote.status === "converted") {
    notices.push(
      <Notice key="converted" tone="success" icon={<Package aria-hidden />}>
        {t("becameOrder")}
      </Notice>,
    );
  }

  return (
    <>
      <RecordHero
        badges={
          <StatusBadge tone={STATUS_TONE[quote.status] ?? "neutral"}>
            {tq(`statuses.${statusCfg.labelKey}`)}
          </StatusBadge>
        }
        title={<span className="font-mono tracking-tight">{quote.quoteNumber}</span>}
        meta={
          <>
            {quote.company && (
              <MetaItem icon={<Building2 aria-hidden />} href={`/dashboard/companies/${quote.company.id}`}>
                {quote.company.name}
              </MetaItem>
            )}
            {quote.contact && contactName && (
              <MetaItem icon={<User aria-hidden />} href={`/dashboard/contacts/${quote.contact.id}`}>
                {contactName}
              </MetaItem>
            )}
            {quote.deal && (
              <MetaItem icon={<Handshake aria-hidden />} href={`/dashboard/pipeline/${quote.deal.id}`}>
                {quote.deal.name}
              </MetaItem>
            )}
            {quote.owner?.name && (
              <MetaItem icon={<UserRound aria-hidden />}>{tR("assignedTo", { name: quote.owner.name })}</MetaItem>
            )}
          </>
        }
        actions={heroActions}
      >
        {/* The figures a chase is decided by. */}
        <MetricStrip>
          <Metric label={t("total")}>{fmt(quote.totalAmount)}</Metric>
          <Metric
            label={t("validUntil")}
            tone={lapsed ? "danger" : undefined}
            hint={
              expiresAt && daysLeft != null && (stillOpen || quote.status === "expired")
                ? daysLeft < 0
                  ? t("expiredAgo", { days: -daysLeft })
                  : daysLeft === 0
                    ? tR("today")
                    : tR("inDays", { days: daysLeft })
                : undefined
            }
          >
            {expiresAt ? formatter.dateTime(expiresAt, DATE_FORMAT) : t("noExpiry")}
          </Metric>
          {discountAmount > 0 && (
            <Metric label={t("discount")} hint={`${quote.discountPercent ?? "0"}%`}>
              −{fmt(quote.discountAmount)}
            </Metric>
          )}
        </MetricStrip>

        {notices.length > 0 && <div className="space-y-2">{notices}</div>}
      </RecordHero>

      <RecordSections
        label={tR("sectionsLabel")}
        tabs={[
          { id: "lines", label: tR("tabs.lines"), icon: <FileText aria-hidden />, count: quote.items.length },
          { id: "details", label: tR("tabs.details"), icon: <Info aria-hidden /> },
          { id: "history", label: tR("tabs.history"), icon: <History aria-hidden />, count: quote.activities.length },
        ]}
        sections={[
          ...(followUpCard ? [{ tab: "lines", column: "main" as const, node: followUpCard }] : []),
          { tab: "lines", column: "main", node: lines },
          { tab: "details", column: "side", node: details },
          { tab: "details", column: "side", node: tracking },
          { tab: "history", column: "side", node: history },
        ]}
      />

      {/* Email dialogs: the first send, and the follow-up drafted for this moment. */}
      <SendEmailModal
        {...emailTo}
        dealId={quote.dealId ?? undefined}
        trigger={null}
        open={showEmailDialog}
        onOpenChange={setShowEmailDialog}
        document={quoteEmail(
          "send",
          {
            subject: fill(QUOTE_TEXT[customerLanguage].emailSubject, { number: quote.quoteNumber }),
            message: QUOTE_TEXT[customerLanguage].emailDefaultMessage,
          },
          { title: tq("sendEmail.title"), description: tq("sendEmail.description"), submit: tq("sendEmail.submit") },
          () => {
            toast.success(t("sentSuccess"));
          },
        )}
      />

      {/* Follow-up draft — prefilled, fully editable, and sent only on a click. */}
      {followUp && followUpKey && (
        <SendEmailModal
          {...emailTo}
          dealId={quote.dealId ?? undefined}
          trigger={null}
          open={showFollowUpDialog}
          onOpenChange={setShowFollowUpDialog}
          document={quoteEmail(
            "followUp",
            customerDrafts?.[followUpKey]
              ? {
                  subject: fill(customerDrafts[followUpKey].subject, followUpVars),
                  message: fill(customerDrafts[followUpKey].body, followUpVars),
                }
              : {
                  subject: tf(`${followUpKey}Subject`, followUpVars),
                  message: tf(`${followUpKey}Body`, followUpVars),
                },
            { title: tf("dialogTitle"), description: tf("dialogDescription"), submit: tf("submitLabel") },
            () => {
              toast.success(tq("sendEmail.sent"));
            },
          )}
        />
      )}

      {/* Reject Dialog */}
      <Dialog open={showDeclineDialog} onOpenChange={setShowDeclineDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("declineTitle")}</DialogTitle>
          </DialogHeader>
          <Textarea
            value={declineReason}
            onChange={(e) => setDeclineReason(e.target.value)}
            placeholder={t("declineReasonPlaceholder")}
            aria-label={t("declineReasonPlaceholder")}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeclineDialog(false)}>
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={isLoading}
              onClick={async () => {
                await handleStatusChange("declined", declineReason);
                setShowDeclineDialog(false);
                setDeclineReason("");
              }}
            >
              {t("markDeclined")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("rejectTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-muted-foreground text-sm">{t("rejectDescription")}</p>
            <Textarea
              placeholder={t("rejectPlaceholder")}
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowRejectDialog(false)} disabled={isLoading}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" onClick={handleReject} disabled={isLoading}>
              <XCircle className="mr-2 h-4 w-4" />
              {t("confirmReject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const NOTICE_TONES = {
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
} as const;

/** A line of state under the figures, in the kit's tones: amber waits on somebody, green is done. */
function Notice({ tone, icon, children }: { tone: keyof typeof NOTICE_TONES; icon: ReactNode; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0",
        NOTICE_TONES[tone],
      )}
    >
      {icon}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
