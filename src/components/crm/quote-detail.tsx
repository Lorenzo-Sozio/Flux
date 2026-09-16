"use client";

import { useEffect, useState } from "react";

import { useRouter } from "next/navigation";

import {
  AlertTriangle,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  DollarSign,
  Download,
  Eye,
  FileText,
  Hash,
  Link2,
  Mail,
  Package,
  Pencil,
  Printer,
  ShieldCheck,
  User,
  X,
  XCircle,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";

import { convertQuoteToOrderAction } from "@/actions/orders";
import {
  approveQuoteAction,
  type getQuoteById,
  rejectQuoteAction,
  requestApprovalAction,
  updateQuoteAction,
} from "@/actions/quotes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useCurrency } from "@/hooks/use-currency";
import { type DocumentLanguage, fill, QUOTE_TEXT } from "@/lib/document-language";
import { can } from "@/lib/permissions";
import { whatToChase } from "@/lib/quote-followup";
import { quoteStatusConfig } from "@/lib/quote-status";

import { SendQuoteEmailDialog } from "./send-quote-email-dialog";

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
]);

const DATE_FORMAT = { day: "numeric", month: "short", year: "numeric" } as const;
const DATE_TIME_FORMAT = { ...DATE_FORMAT, hour: "2-digit", minute: "2-digit" } as const;
const SHORT_DATE_TIME_FORMAT = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" } as const;

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
  const formatter = useFormatter();
  const { formatMoney } = useCurrency();
  // In the quote's own currency: the figure the customer was offered, not a conversion.
  const fmt = (amount: string | null) => formatMoney(amount, quote.currency);
  const [isLoading, setIsLoading] = useState(false);
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [showFollowUpDialog, setShowFollowUpDialog] = useState(false);
  const [rejectNote, setRejectNote] = useState("");

  // ⚠️ Asked as a capability, not compared as a string. This line used to read
  // the platform role, which is "user" for every customer, so no workspace admin
  // ever saw the approve button and a quote sent for approval could not be
  // approved from the interface at all — while `approveQuoteAction` would have
  // let them, because it asks the right question.
  const canApprove = can(tenantRole ?? null, "quote:approve");

  async function runAction(action: () => Promise<void>, successMsg: string, errorMsg: string) {
    setIsLoading(true);
    try {
      await action();
      toast.success(successMsg);
      router.refresh();
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

  const tq = useTranslations("quotes");
  const tf = useTranslations("quoteFollowUp");

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

  async function handleStatusChange(newStatus: string) {
    await runAction(
      async () => {
        await updateQuoteAction(quote.id, { status: newStatus as "accepted" | "declined" });
        onStatusChange?.(newStatus);
      },
      newStatus === "accepted" ? t("markedAccepted") : t("markedDeclined"),
      t("statusUpdateFailed"),
    );
  }

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
      router.refresh();
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

  return (
    <div className="flex flex-col gap-6 md:flex-row">
      {/* Left column: Quote info + actions */}
      <div className="flex w-full flex-col gap-6 md:w-1/3">
        {/* Quote Details card */}
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
            <div className="min-w-0 space-y-1">
              <CardTitle className="font-mono tracking-tight">{quote.quoteNumber}</CardTitle>
              <Badge variant="outline" className={`font-medium text-xs ${statusCfg.className}`}>
                {tq(`statuses.${statusCfg.labelKey}`)}
              </Badge>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {quote.status === "draft" && (
                <Button
                  variant="ghost"
                  size="icon"
                  title={t("editQuote")}
                  onClick={() => router.push(`/dashboard/sales/quotes/${quote.id}/edit`)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            <div>
              <p className="mb-1 text-muted-foreground text-xs">{t("issued")}</p>
              <p className="flex items-center gap-1.5 font-medium text-sm">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                {formatter.dateTime(new Date(quote.issuedAt), DATE_FORMAT)}
              </p>
            </div>

            {quote.expiresAt && (
              <div>
                <p className="mb-1 text-muted-foreground text-xs">{t("expires")}</p>
                <p className="flex items-center gap-1.5 font-medium text-sm">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  {formatter.dateTime(new Date(quote.expiresAt), DATE_FORMAT)}
                </p>
              </div>
            )}

            {quote.deal && (
              <div>
                <p className="mb-1 text-muted-foreground text-xs">{t("deal")}</p>
                <p className="flex items-center gap-1.5 font-medium text-sm">
                  <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                  {quote.deal.name}
                </p>
              </div>
            )}

            {quote.company && (
              <div>
                <p className="mb-1 text-muted-foreground text-xs">{t("company")}</p>
                <p className="flex items-center gap-1.5 font-medium text-sm">
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                  {quote.company.name}
                </p>
              </div>
            )}

            {contactName && (
              <div>
                <p className="mb-1 text-muted-foreground text-xs">{t("contact")}</p>
                <p className="flex items-center gap-1.5 font-medium text-sm">
                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                  {contactName}
                </p>
              </div>
            )}

            {quote.owner && (
              <div>
                <p className="mb-1 text-muted-foreground text-xs">{t("owner")}</p>
                <p className="flex items-center gap-1.5 font-medium text-sm">
                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                  {quote.owner.name}
                </p>
              </div>
            )}

            <Separator />

            <div>
              <p className="mb-1 text-muted-foreground text-xs">{t("totalAmount")}</p>
              <p className="flex items-center gap-1.5 font-bold text-xl tabular-nums">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                {fmt(quote.totalAmount)}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* What to chase, and why — nothing here is sent on its own (rilievo S-06). */}
        {followUp && followUpKey && (
          <Card className="border-amber-500/40 bg-amber-500/5">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 font-semibold text-muted-foreground text-sm uppercase tracking-wide">
                <Clock className="h-4 w-4 text-amber-600" />
                {tf("title")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="font-medium text-sm">{tf(`${followUpKey}Badge`, followUpVars)}</p>
                <p className="mt-1 text-muted-foreground text-xs">{tf(`${followUpKey}Why`)}</p>
              </div>
              <Button variant="outline" className="w-full justify-start" onClick={() => setShowFollowUpDialog(true)}>
                <Mail className="mr-2 h-4 w-4" />
                {tf("action")}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Actions card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="font-semibold text-muted-foreground text-sm uppercase tracking-wide">
              {t("actions")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {quote.status === "draft" && !canApprove && (
              <Button
                variant="outline"
                className="w-full justify-start border-orange-300 text-orange-700 hover:bg-orange-50"
                onClick={handleRequestApproval}
                disabled={isLoading}
              >
                <ShieldCheck className="mr-2 h-4 w-4" />
                {t("requestApproval")}
              </Button>
            )}

            {quote.status === "pending_approval" && canApprove && (
              <>
                <Button
                  className="w-full justify-start bg-green-600 hover:bg-green-700"
                  onClick={handleApprove}
                  disabled={isLoading}
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  {t("approveQuote")}
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start border-red-300 text-red-700 hover:bg-red-50"
                  onClick={() => setShowRejectDialog(true)}
                  disabled={isLoading}
                >
                  <XCircle className="mr-2 h-4 w-4" />
                  {t("rejectWithNote")}
                </Button>
              </>
            )}

            {quote.status === "pending_approval" && !canApprove && (
              <div className="flex items-start gap-2 rounded-md border border-orange-200 bg-orange-50 px-3 py-2.5 text-orange-700 text-xs">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{t("awaitingApproval")}</span>
              </div>
            )}

            {/*
              ⚠️ Anche da approvato, e questa è la correzione che conta. Lo stato
              `approved` non aveva NESSUN comando: chi passava dall'approvazione
              interna si trovava un preventivo firmato e nessun modo di spedirlo,
              e l'unica strada che funzionava era saltare del tutto
              l'approvazione e inviare dalla bozza. La macchina a stati il
              passaggio approved → sent lo prevede da sempre; era l'interfaccia a
              non offrirlo. Un flusso che si interrompe alla fine non somiglia a
              un errore: somiglia a un pulsante che qualcuno ha dimenticato dove.
            */}
            {(quote.status === "draft" || quote.status === "approved") && (
              <Button className="w-full justify-start" onClick={() => setShowEmailDialog(true)}>
                <Mail className="mr-2 h-4 w-4" />
                {t("sendQuote")}
              </Button>
            )}

            {quote.status === "accepted" && (
              <Button className="w-full justify-start" onClick={handleConvert} disabled={isLoading}>
                <Package className="mr-2 h-4 w-4" />
                {t("createOrder")}
              </Button>
            )}

            {quote.status === "converted" && (
              <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-800 text-sm dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                <Package className="h-4 w-4 shrink-0" />
                <span>{t("becameOrder")}</span>
              </div>
            )}

            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => window.open(`/api/quotes/${quote.id}`, "_blank")}
            >
              <Printer className="mr-2 h-4 w-4" />
              {t("printPreview")}
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => window.open(`/api/quotes/${quote.id}/pdf`, "_blank")}
            >
              <Download className="mr-2 h-4 w-4" />
              {t("downloadPdf")}
            </Button>

            {quote.publicToken && (
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => {
                  const url = `${window.location.origin}/q/${quote.publicToken}`;
                  navigator.clipboard.writeText(url).then(() => toast.success(t("publicLinkCopied")));
                }}
              >
                <Link2 className="mr-2 h-4 w-4" />
                {t("copyPublicLink")}
              </Button>
            )}

            {quote.status === "viewed" && (
              <>
                <Button
                  variant="outline"
                  className="w-full justify-start border-green-300 text-green-700 hover:bg-green-50"
                  onClick={() => handleStatusChange("accepted")}
                  disabled={isLoading}
                >
                  <Check className="mr-2 h-4 w-4" />
                  {t("markAccepted")}
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start border-red-300 text-red-700 hover:bg-red-50"
                  onClick={() => handleStatusChange("declined")}
                  disabled={isLoading}
                >
                  <X className="mr-2 h-4 w-4" />
                  {t("markDeclined")}
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        {/* Approval note banner */}
        {quote.status === "draft" && quote.approvalNote && (
          <Card className="border-orange-200 bg-orange-50">
            <CardContent className="flex items-start gap-2 p-4">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />
              <div>
                <p className="font-medium text-orange-800 text-sm">{t("rejectedBanner")}</p>
                <p className="mt-0.5 text-orange-700 text-xs">{quote.approvalNote}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Status timeline card */}
        {(quote.sentAt || quote.viewedAt || quote.acceptedAt || quote.declinedAt) && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="font-semibold text-muted-foreground text-sm uppercase tracking-wide">
                {t("timeline")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {quote.sentAt && (
                <div className="flex items-center gap-2 text-blue-600 text-sm">
                  <Mail className="h-3.5 w-3.5 shrink-0" />
                  <div>
                    <p className="font-medium leading-none">{t("sent")}</p>
                    <p className="mt-0.5 text-muted-foreground text-xs">
                      {formatter.dateTime(new Date(quote.sentAt), DATE_TIME_FORMAT)}
                    </p>
                  </div>
                </div>
              )}
              {quote.viewedAt && (
                <div className="flex items-center gap-2 text-sm text-violet-600">
                  <Eye className="h-3.5 w-3.5 shrink-0" />
                  <div>
                    <p className="font-medium leading-none">{t("viewed")}</p>
                    <p className="mt-0.5 text-muted-foreground text-xs">
                      {formatter.dateTime(new Date(quote.viewedAt), DATE_TIME_FORMAT)}
                    </p>
                  </div>
                </div>
              )}
              {quote.acceptedAt && (
                <div className="flex items-center gap-2 text-green-600 text-sm">
                  <Check className="h-3.5 w-3.5 shrink-0" />
                  <div>
                    <p className="font-medium leading-none">{t("accepted")}</p>
                    <p className="mt-0.5 text-muted-foreground text-xs">
                      {formatter.dateTime(new Date(quote.acceptedAt), DATE_TIME_FORMAT)}
                    </p>
                  </div>
                </div>
              )}
              {quote.declinedAt && (
                <div className="flex items-center gap-2 text-red-600 text-sm">
                  <X className="h-3.5 w-3.5 shrink-0" />
                  <div>
                    <p className="font-medium leading-none">{t("declined")}</p>
                    <p className="mt-0.5 text-muted-foreground text-xs">
                      {formatter.dateTime(new Date(quote.declinedAt), DATE_TIME_FORMAT)}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Right column: Items, Summary, Activity */}
      <div className="flex w-full flex-col gap-6 md:w-2/3">
        <Tabs defaultValue="items">
          <TabsList>
            <TabsTrigger value="items">
              <FileText className="mr-1.5 h-3.5 w-3.5" />
              {t("itemsTab", { count: quote.items.length })}
            </TabsTrigger>
            <TabsTrigger value="summary">{t("summaryTab")}</TabsTrigger>
            <TabsTrigger value="activity">{t("activityTab", { count: quote.activities.length })}</TabsTrigger>
          </TabsList>

          {/* Items tab */}
          <TabsContent value="items" className="mt-4">
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="font-semibold text-xs">{t("description")}</TableHead>
                    <TableHead className="text-right font-semibold text-xs">{t("qty")}</TableHead>
                    <TableHead className="text-right font-semibold text-xs">{t("unitPrice")}</TableHead>
                    <TableHead className="text-right font-semibold text-xs">{t("discount")}</TableHead>
                    <TableHead className="text-right font-semibold text-xs">{t("tax")}</TableHead>
                    <TableHead className="text-right font-semibold text-xs">{t("total")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quote.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="font-medium text-sm">{item.description}</div>
                        {item.product && (
                          <div className="mt-0.5 text-muted-foreground text-xs">{item.product.name}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{item.quantity}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{fmt(item.unitPrice)}</TableCell>
                      <TableCell className="text-right text-amber-600 text-sm tabular-nums">
                        {parseFloat(item.discountPercent ?? "0") > 0
                          ? `${item.discountPercent}% (−${fmt(item.discountAmount)})`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right text-slate-600 text-sm tabular-nums">
                        {parseFloat(item.taxPercent ?? "0") > 0 ? `${item.taxPercent}% (+${fmt(item.taxAmount)})` : "—"}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-sm tabular-nums">
                        {fmt(item.totalPrice)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          {/* Summary tab */}
          <TabsContent value="summary" className="mt-4">
            <Card>
              <CardContent className="space-y-6 pt-6">
                <div className="ml-auto max-w-sm space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t("subtotal")}</span>
                    <span className="font-medium tabular-nums">{fmt(quote.subtotal)}</span>
                  </div>
                  {parseFloat(quote.discountAmount ?? "0") > 0 && (
                    <div className="flex justify-between text-amber-600 text-sm">
                      <span>{t("discountPercent", { percent: quote.discountPercent ?? "0" })}</span>
                      <span className="font-medium tabular-nums">−{fmt(quote.discountAmount)}</span>
                    </div>
                  )}
                  {parseFloat(quote.taxAmount ?? "0") > 0 && (
                    <div className="flex justify-between text-slate-600 text-sm">
                      <span>{t("taxPercent", { percent: quote.taxPercent ?? "0" })}</span>
                      <span className="font-medium tabular-nums">+{fmt(quote.taxAmount)}</span>
                    </div>
                  )}
                  <Separator />
                  <div className="flex justify-between">
                    <span className="font-semibold">{t("total")}</span>
                    <span className="font-bold text-lg tabular-nums">{fmt(quote.totalAmount)}</span>
                  </div>
                </div>

                {quote.notes && (
                  <div className="border-t pt-4">
                    <p className="mb-2 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
                      {t("notes")}
                    </p>
                    <p className="whitespace-pre-wrap text-sm">{quote.notes}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Activity tab */}
          <TabsContent value="activity" className="mt-4">
            <Card>
              <CardContent className="pt-6">
                {quote.activities.length === 0 ? (
                  <p className="py-8 text-center text-muted-foreground text-sm">{t("noActivity")}</p>
                ) : (
                  <div className="space-y-0">
                    {quote.activities.map((activity, idx) => (
                      <div key={activity.id} className="relative flex gap-4 pb-4">
                        {idx < quote.activities.length - 1 && (
                          <div className="absolute top-7 bottom-0 left-[11px] w-px bg-border" />
                        )}
                        <div className="z-10 mt-1.5 h-5 w-5 shrink-0 rounded-full border-2 border-border bg-background" />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm leading-tight">
                            {ACTIVITY_TYPES.has(activity.type) ? t(`activity.${activity.type}`) : activity.type}
                          </p>
                          <div className="mt-0.5 flex items-center gap-2">
                            {activity.user?.name && (
                              <span className="text-muted-foreground text-xs">{activity.user.name}</span>
                            )}
                            {activity.email && (
                              <span className="text-muted-foreground text-xs">({activity.email})</span>
                            )}
                          </div>
                        </div>
                        <span className="mt-0.5 shrink-0 text-muted-foreground text-xs">
                          {formatter.dateTime(new Date(activity.createdAt), SHORT_DATE_TIME_FORMAT)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Email Dialog */}
      <SendQuoteEmailDialog
        open={showEmailDialog}
        onOpenChange={setShowEmailDialog}
        quoteId={quote.id}
        defaultTo={quote.contact?.email ?? quote.company?.mainEmail ?? ""}
        defaultSubject={fill(QUOTE_TEXT[customerLanguage].emailSubject, { number: quote.quoteNumber })}
        defaultMessage={QUOTE_TEXT[customerLanguage].emailDefaultMessage}
        onSuccess={() => {
          setShowEmailDialog(false);
          toast.success(t("sentSuccess"));
          router.refresh();
        }}
      />

      {/* Follow-up draft — prefilled, fully editable, and sent only on a click. */}
      {followUp && followUpKey && (
        <SendQuoteEmailDialog
          open={showFollowUpDialog}
          onOpenChange={setShowFollowUpDialog}
          quoteId={quote.id}
          defaultTo={quote.contact?.email ?? ""}
          defaultSubject={
            customerDrafts?.[followUpKey]
              ? fill(customerDrafts[followUpKey].subject, followUpVars)
              : tf(`${followUpKey}Subject`, followUpVars)
          }
          defaultMessage={
            customerDrafts?.[followUpKey]
              ? fill(customerDrafts[followUpKey].body, followUpVars)
              : tf(`${followUpKey}Body`, followUpVars)
          }
          title={tf("dialogTitle")}
          descriptionText={tf("dialogDescription")}
          submitLabel={tf("submitLabel")}
          onSuccess={() => {
            setShowFollowUpDialog(false);
            router.refresh();
          }}
        />
      )}

      {/* Reject Dialog */}
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
    </div>
  );
}
