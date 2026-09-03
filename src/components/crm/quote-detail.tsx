"use client";

import { useEffect, useState } from "react";

import { useRouter } from "next/navigation";

import { format } from "date-fns";
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
import { useTranslations } from "next-intl";
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
import { quoteStatusConfig } from "@/lib/quote-status";

import { SendQuoteEmailDialog } from "./send-quote-email-dialog";

type Quote = Awaited<ReturnType<typeof getQuoteById>>;

interface QuoteDetailProps {
  quote: Quote;
  autoOpenSend?: boolean;
  onStatusChange?: (newStatus: string) => void;
  userRole?: string;
}

const ACTIVITY_LABELS: Record<string, string> = {
  created: "Quote created",
  sent: "Quote sent",
  viewed: "Quote viewed",
  opened_email: "Email opened",
  clicked_email: "Link clicked",
  accepted: "Quote accepted",
  declined: "Quote declined",
  reminded: "Reminder sent",
  updated: "Quote updated",
  approval_requested: "Approvazione richiesta",
  approved: "Preventivo approvato",
  rejected: "Preventivo rifiutato",
};

export function QuoteDetail({ quote, autoOpenSend = false, onStatusChange, userRole = "user" }: QuoteDetailProps) {
  const router = useRouter();
  const { formatAmount } = useCurrency();
  const fmt = (amount: string | null) => formatAmount(parseFloat(amount ?? "0"));
  const [isLoading, setIsLoading] = useState(false);
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectNote, setRejectNote] = useState("");

  const isPrivileged = userRole === "admin" || userRole === "owner";

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
    if (autoOpenSend && quote.status === "draft") {
      setShowEmailDialog(true);
    }
  }, [autoOpenSend, quote.status]);

  const tq = useTranslations("quotes");
  const statusCfg = quoteStatusConfig(quote.status);
  const contactName = quote.contact ? `${quote.contact.firstName} ${quote.contact.lastName}`.trim() : null;

  async function handleStatusChange(newStatus: string) {
    await runAction(
      async () => {
        await updateQuoteAction(quote.id, { status: newStatus as "accepted" | "declined" });
        onStatusChange?.(newStatus);
      },
      `Quote marked as ${newStatus}`,
      "Failed to update status",
    );
  }

  const handleRequestApproval = () =>
    runAction(
      () => requestApprovalAction(quote.id),
      "Approvazione richiesta con successo.",
      "Errore nell'invio della richiesta.",
    );

  const handleApprove = () =>
    runAction(() => approveQuoteAction(quote.id), "Preventivo approvato.", "Errore nell'approvazione.");

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
      toast.success(`Order ${result.orderNumber} created from this quote.`);
      router.push(`/dashboard/sales/orders/${result.orderId}`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the order.");
    } finally {
      setIsLoading(false);
    }
  };

  async function handleReject() {
    await runAction(() => rejectQuoteAction(quote.id, rejectNote), "Preventivo rifiutato.", "Errore nel rifiuto.");
    setShowRejectDialog(false);
    setRejectNote("");
  }

  return (
    <div className="flex flex-col gap-6 md:flex-row">
      {/* Left column: Quote info + actions */}
      <div className="flex w-full flex-col gap-6 md:w-1/3">
        {/* Quote Details card */}
        <Card>
          <CardHeader className="flex flex-row items-start justify-between pb-3">
            <div className="space-y-1">
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
                  title="Edit quote"
                  onClick={() => router.push(`/dashboard/sales/quotes/${quote.id}/edit`)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            <div>
              <p className="mb-1 text-muted-foreground text-xs">Issued</p>
              <p className="flex items-center gap-1.5 font-medium text-sm">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                {format(new Date(quote.issuedAt), "MMM d, yyyy")}
              </p>
            </div>

            {quote.expiresAt && (
              <div>
                <p className="mb-1 text-muted-foreground text-xs">Expires</p>
                <p className="flex items-center gap-1.5 font-medium text-sm">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  {format(new Date(quote.expiresAt), "MMM d, yyyy")}
                </p>
              </div>
            )}

            {quote.deal && (
              <div>
                <p className="mb-1 text-muted-foreground text-xs">Deal</p>
                <p className="flex items-center gap-1.5 font-medium text-sm">
                  <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                  {quote.deal.name}
                </p>
              </div>
            )}

            {quote.company && (
              <div>
                <p className="mb-1 text-muted-foreground text-xs">Company</p>
                <p className="flex items-center gap-1.5 font-medium text-sm">
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                  {quote.company.name}
                </p>
              </div>
            )}

            {contactName && (
              <div>
                <p className="mb-1 text-muted-foreground text-xs">Contact</p>
                <p className="flex items-center gap-1.5 font-medium text-sm">
                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                  {contactName}
                </p>
              </div>
            )}

            {quote.owner && (
              <div>
                <p className="mb-1 text-muted-foreground text-xs">Owner</p>
                <p className="flex items-center gap-1.5 font-medium text-sm">
                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                  {quote.owner.name}
                </p>
              </div>
            )}

            <Separator />

            <div>
              <p className="mb-1 text-muted-foreground text-xs">Total Amount</p>
              <p className="flex items-center gap-1.5 font-bold text-xl tabular-nums">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                {fmt(quote.totalAmount)}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Actions card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="font-semibold text-muted-foreground text-sm uppercase tracking-wide">
              Actions
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {quote.status === "draft" && !isPrivileged && (
              <Button
                variant="outline"
                className="w-full justify-start border-orange-300 text-orange-700 hover:bg-orange-50"
                onClick={handleRequestApproval}
                disabled={isLoading}
              >
                <ShieldCheck className="mr-2 h-4 w-4" />
                Richiedi Approvazione
              </Button>
            )}

            {quote.status === "pending_approval" && isPrivileged && (
              <>
                <Button
                  className="w-full justify-start bg-green-600 hover:bg-green-700"
                  onClick={handleApprove}
                  disabled={isLoading}
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Approva Preventivo
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start border-red-300 text-red-700 hover:bg-red-50"
                  onClick={() => setShowRejectDialog(true)}
                  disabled={isLoading}
                >
                  <XCircle className="mr-2 h-4 w-4" />
                  Rifiuta con nota
                </Button>
              </>
            )}

            {quote.status === "pending_approval" && !isPrivileged && (
              <div className="flex items-start gap-2 rounded-md border border-orange-200 bg-orange-50 px-3 py-2.5 text-orange-700 text-xs">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>In attesa di approvazione da un amministratore.</span>
              </div>
            )}

            {quote.status === "draft" && (
              <Button className="w-full justify-start" onClick={() => setShowEmailDialog(true)}>
                <Mail className="mr-2 h-4 w-4" />
                Send Quote
              </Button>
            )}

            {quote.status === "accepted" && (
              <Button className="w-full justify-start" onClick={handleConvert} disabled={isLoading}>
                <Package className="mr-2 h-4 w-4" />
                Create Order
              </Button>
            )}

            {quote.status === "converted" && (
              <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-800 text-sm dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                <Package className="h-4 w-4 shrink-0" />
                <span>This quote has become an order.</span>
              </div>
            )}

            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => window.open(`/api/quotes/${quote.id}`, "_blank")}
            >
              <Printer className="mr-2 h-4 w-4" />
              Print / Preview
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => window.open(`/api/quotes/${quote.id}/pdf`, "_blank")}
            >
              <Download className="mr-2 h-4 w-4" />
              Download PDF
            </Button>

            {quote.publicToken && (
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => {
                  const url = `${window.location.origin}/q/${quote.publicToken}`;
                  navigator.clipboard.writeText(url).then(() => toast.success("Public link copied to clipboard"));
                }}
              >
                <Link2 className="mr-2 h-4 w-4" />
                Copy Public Link
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
                  Mark as Accepted
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start border-red-300 text-red-700 hover:bg-red-50"
                  onClick={() => handleStatusChange("declined")}
                  disabled={isLoading}
                >
                  <X className="mr-2 h-4 w-4" />
                  Mark as Declined
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
                <p className="font-medium text-orange-800 text-sm">Preventivo rifiutato</p>
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
                Timeline
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {quote.sentAt && (
                <div className="flex items-center gap-2 text-blue-600 text-sm">
                  <Mail className="h-3.5 w-3.5 shrink-0" />
                  <div>
                    <p className="font-medium leading-none">Sent</p>
                    <p className="mt-0.5 text-muted-foreground text-xs">
                      {format(new Date(quote.sentAt), "MMM d, yyyy HH:mm")}
                    </p>
                  </div>
                </div>
              )}
              {quote.viewedAt && (
                <div className="flex items-center gap-2 text-sm text-violet-600">
                  <Eye className="h-3.5 w-3.5 shrink-0" />
                  <div>
                    <p className="font-medium leading-none">Viewed</p>
                    <p className="mt-0.5 text-muted-foreground text-xs">
                      {format(new Date(quote.viewedAt), "MMM d, yyyy HH:mm")}
                    </p>
                  </div>
                </div>
              )}
              {quote.acceptedAt && (
                <div className="flex items-center gap-2 text-green-600 text-sm">
                  <Check className="h-3.5 w-3.5 shrink-0" />
                  <div>
                    <p className="font-medium leading-none">Accepted</p>
                    <p className="mt-0.5 text-muted-foreground text-xs">
                      {format(new Date(quote.acceptedAt), "MMM d, yyyy HH:mm")}
                    </p>
                  </div>
                </div>
              )}
              {quote.declinedAt && (
                <div className="flex items-center gap-2 text-red-600 text-sm">
                  <X className="h-3.5 w-3.5 shrink-0" />
                  <div>
                    <p className="font-medium leading-none">Declined</p>
                    <p className="mt-0.5 text-muted-foreground text-xs">
                      {format(new Date(quote.declinedAt), "MMM d, yyyy HH:mm")}
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
              Items ({quote.items.length})
            </TabsTrigger>
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="activity">Activity ({quote.activities.length})</TabsTrigger>
          </TabsList>

          {/* Items tab */}
          <TabsContent value="items" className="mt-4">
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="font-semibold text-xs">Description</TableHead>
                    <TableHead className="text-right font-semibold text-xs">Qty</TableHead>
                    <TableHead className="text-right font-semibold text-xs">Unit Price</TableHead>
                    <TableHead className="text-right font-semibold text-xs">Discount</TableHead>
                    <TableHead className="text-right font-semibold text-xs">Tax</TableHead>
                    <TableHead className="text-right font-semibold text-xs">Total</TableHead>
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
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="font-medium tabular-nums">{fmt(quote.subtotal)}</span>
                  </div>
                  {parseFloat(quote.discountAmount ?? "0") > 0 && (
                    <div className="flex justify-between text-amber-600 text-sm">
                      <span>Discount ({quote.discountPercent}%)</span>
                      <span className="font-medium tabular-nums">−{fmt(quote.discountAmount)}</span>
                    </div>
                  )}
                  {parseFloat(quote.taxAmount ?? "0") > 0 && (
                    <div className="flex justify-between text-slate-600 text-sm">
                      <span>Tax ({quote.taxPercent}%)</span>
                      <span className="font-medium tabular-nums">+{fmt(quote.taxAmount)}</span>
                    </div>
                  )}
                  <Separator />
                  <div className="flex justify-between">
                    <span className="font-semibold">Total</span>
                    <span className="font-bold text-lg tabular-nums">{fmt(quote.totalAmount)}</span>
                  </div>
                </div>

                {quote.notes && (
                  <div className="border-t pt-4">
                    <p className="mb-2 font-semibold text-muted-foreground text-xs uppercase tracking-wide">Notes</p>
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
                  <p className="py-8 text-center text-muted-foreground text-sm">No activity yet</p>
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
                            {ACTIVITY_LABELS[activity.type] ?? activity.type}
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
                          {format(new Date(activity.createdAt), "MMM d, HH:mm")}
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
        onSuccess={() => {
          setShowEmailDialog(false);
          toast.success("Quote sent successfully");
          router.refresh();
        }}
      />

      {/* Reject Dialog */}
      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rifiuta preventivo</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-muted-foreground text-sm">
              Il preventivo tornerà in stato bozza. Aggiungi una nota per il venditore (opzionale).
            </p>
            <Textarea
              placeholder="Motivo del rifiuto..."
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowRejectDialog(false)} disabled={isLoading}>
              Annulla
            </Button>
            <Button variant="destructive" onClick={handleReject} disabled={isLoading}>
              <XCircle className="mr-2 h-4 w-4" />
              Conferma rifiuto
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
