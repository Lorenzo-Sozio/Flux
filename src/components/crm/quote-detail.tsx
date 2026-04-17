"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";
import { Mail, Printer, Eye, Check, X, Clock, Calendar, Building2, User, Link2 } from "lucide-react";
import { toast } from "sonner";
import { updateQuoteAction, getQuoteById } from "@/actions/quotes";
import { SendQuoteEmailDialog } from "./send-quote-email-dialog";

type Quote = Awaited<ReturnType<typeof getQuoteById>>;

interface QuoteDetailProps {
  quote: Quote;
  autoOpenSend?: boolean;
  onStatusChange?: (newStatus: string) => void;
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  draft:     { label: "Draft",     className: "border-slate-300 text-slate-600" },
  sent:      { label: "Sent",      className: "border-blue-300 text-blue-600 bg-blue-50" },
  viewed:    { label: "Viewed",    className: "border-violet-300 text-violet-600 bg-violet-50" },
  accepted:  { label: "Accepted",  className: "border-green-300 text-green-600 bg-green-50" },
  declined:  { label: "Declined",  className: "border-red-300 text-red-600 bg-red-50" },
  expired:   { label: "Expired",   className: "border-amber-300 text-amber-600 bg-amber-50" },
  converted: { label: "Converted", className: "border-teal-300 text-teal-600 bg-teal-50" },
};

const ACTIVITY_LABELS: Record<string, string> = {
  created:       "Quote created",
  sent:          "Quote sent",
  viewed:        "Quote viewed",
  opened_email:  "Email opened",
  clicked_email: "Link clicked",
  accepted:      "Quote accepted",
  declined:      "Quote declined",
  reminded:      "Reminder sent",
  updated:       "Quote updated",
};

function fmt(amount: string | null, currency: string) {
  return `${currency} ${parseFloat(amount ?? "0").toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function QuoteDetail({ quote, autoOpenSend = false, onStatusChange }: QuoteDetailProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [showEmailDialog, setShowEmailDialog] = useState(false);

  // Auto-open the send dialog when navigated here with ?send=1
  useEffect(() => {
    if (autoOpenSend && quote.status === "draft") {
      setShowEmailDialog(true);
    }
  }, [autoOpenSend, quote.status]);

  const statusCfg = STATUS_CONFIG[quote.status] ?? STATUS_CONFIG.draft;
  const contactName = quote.contact
    ? `${quote.contact.firstName} ${quote.contact.lastName}`.trim()
    : null;

  async function handleStatusChange(newStatus: string) {
    setIsLoading(true);
    try {
      await updateQuoteAction(quote.id, { status: newStatus as "accepted" | "declined" });
      toast.success(`Quote marked as ${newStatus}`);
      onStatusChange?.(newStatus);
      router.refresh();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to update status");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Header card */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <CardTitle className="text-xl font-bold font-mono tracking-tight">
                  {quote.quoteNumber}
                </CardTitle>
                <Badge variant="outline" className={`text-xs font-medium ${statusCfg.className}`}>
                  {statusCfg.label}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  Issued {format(new Date(quote.issuedAt), "MMM d, yyyy")}
                </span>
                {quote.expiresAt && (
                  <span className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    Expires {format(new Date(quote.expiresAt), "MMM d, yyyy")}
                  </span>
                )}
                {quote.company && (
                  <span className="flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5" />
                    {quote.company.name}
                  </span>
                )}
                {contactName && (
                  <span className="flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5" />
                    {contactName}
                  </span>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 shrink-0">
              {quote.publicToken && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const url = `${window.location.origin}/q/${quote.publicToken}`;
                    navigator.clipboard.writeText(url).then(() => {
                      toast.success("Public link copied to clipboard");
                    });
                  }}
                >
                  <Link2 className="mr-2 h-4 w-4" />
                  Copy Link
                </Button>
              )}
              {(quote.status === "draft" || quote.status === "sent" || quote.status === "viewed") && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(`/api/quotes/${quote.id}`, "_blank")}
                >
                  <Printer className="mr-2 h-4 w-4" />
                  Print
                </Button>
              )}

              {quote.status === "draft" && (
                <Button size="sm" onClick={() => setShowEmailDialog(true)}>
                  <Mail className="mr-2 h-4 w-4" />
                  Send Quote
                </Button>
              )}

              {quote.status === "viewed" && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-green-300 text-green-700 hover:bg-green-50"
                    onClick={() => handleStatusChange("accepted")}
                    disabled={isLoading}
                  >
                    <Check className="mr-2 h-4 w-4" />
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-red-300 text-red-700 hover:bg-red-50"
                    onClick={() => handleStatusChange("declined")}
                    disabled={isLoading}
                  >
                    <X className="mr-2 h-4 w-4" />
                    Decline
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>

        {/* Timeline */}
        {(quote.sentAt || quote.viewedAt || quote.acceptedAt || quote.declinedAt) && (
          <>
            <Separator />
            <CardContent className="pt-4 pb-4">
              <div className="flex flex-wrap gap-4 text-sm">
                {quote.sentAt && (
                  <div className="flex items-center gap-2 text-blue-600">
                    <Mail className="h-3.5 w-3.5" />
                    <span>Sent {format(new Date(quote.sentAt), "MMM d, HH:mm")}</span>
                  </div>
                )}
                {quote.viewedAt && (
                  <div className="flex items-center gap-2 text-violet-600">
                    <Eye className="h-3.5 w-3.5" />
                    <span>Viewed {format(new Date(quote.viewedAt), "MMM d, HH:mm")}</span>
                  </div>
                )}
                {quote.acceptedAt && (
                  <div className="flex items-center gap-2 text-green-600">
                    <Check className="h-3.5 w-3.5" />
                    <span>Accepted {format(new Date(quote.acceptedAt), "MMM d, HH:mm")}</span>
                  </div>
                )}
                {quote.declinedAt && (
                  <div className="flex items-center gap-2 text-red-600">
                    <X className="h-3.5 w-3.5" />
                    <span>Declined {format(new Date(quote.declinedAt), "MMM d, HH:mm")}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </>
        )}
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="items">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="items">Items ({quote.items.length})</TabsTrigger>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        {/* Items */}
        <TabsContent value="items" className="mt-4">
          <Card className="border-0 shadow-sm overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="text-xs font-semibold">Description</TableHead>
                  <TableHead className="text-xs font-semibold text-right">Qty</TableHead>
                  <TableHead className="text-xs font-semibold text-right">Unit Price</TableHead>
                  <TableHead className="text-xs font-semibold text-right">Discount</TableHead>
                  <TableHead className="text-xs font-semibold text-right">Tax</TableHead>
                  <TableHead className="text-xs font-semibold text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quote.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="font-medium text-sm">{item.description}</div>
                      {item.product && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {item.product.name}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{item.quantity}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {fmt(item.unitPrice, quote.currency)}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-amber-600">
                      {parseFloat(item.discountPercent ?? "0") > 0
                        ? `${item.discountPercent}% (−${fmt(item.discountAmount, quote.currency)})`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-slate-600">
                      {parseFloat(item.taxPercent ?? "0") > 0
                        ? `${item.taxPercent}% (+${fmt(item.taxAmount, quote.currency)})`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm font-semibold tabular-nums">
                      {fmt(item.totalPrice, quote.currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        {/* Summary */}
        <TabsContent value="summary" className="mt-4">
          <Card className="border-0 shadow-sm">
            <CardContent className="pt-6">
              <div className="max-w-sm ml-auto space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-medium tabular-nums">{fmt(quote.subtotal, quote.currency)}</span>
                </div>

                {parseFloat(quote.discountAmount ?? "0") > 0 && (
                  <div className="flex justify-between text-sm text-amber-600">
                    <span>Discount ({quote.discountPercent}%)</span>
                    <span className="font-medium tabular-nums">
                      −{fmt(quote.discountAmount, quote.currency)}
                    </span>
                  </div>
                )}

                {parseFloat(quote.taxAmount ?? "0") > 0 && (
                  <div className="flex justify-between text-sm text-slate-600">
                    <span>Tax ({quote.taxPercent}%)</span>
                    <span className="font-medium tabular-nums">
                      +{fmt(quote.taxAmount, quote.currency)}
                    </span>
                  </div>
                )}

                <Separator />

                <div className="flex justify-between">
                  <span className="font-semibold">Total</span>
                  <span className="text-lg font-bold tabular-nums">
                    {fmt(quote.totalAmount, quote.currency)}
                  </span>
                </div>
              </div>

              {quote.notes && (
                <div className="mt-6 pt-5 border-t">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    Notes
                  </p>
                  <p className="text-sm whitespace-pre-wrap">{quote.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Activity */}
        <TabsContent value="activity" className="mt-4">
          <Card className="border-0 shadow-sm">
            <CardContent className="pt-6">
              {quote.activities.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No activity yet</p>
              ) : (
                <div className="space-y-0">
                  {quote.activities.map((activity, idx) => (
                    <div
                      key={activity.id}
                      className="relative flex gap-4 pb-4"
                    >
                      {/* Connector line */}
                      {idx < quote.activities.length - 1 && (
                        <div className="absolute left-[11px] top-7 bottom-0 w-px bg-border" />
                      )}

                      {/* Dot */}
                      <div className="mt-1.5 h-5 w-5 rounded-full border-2 border-border bg-background shrink-0 z-10" />

                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium leading-tight">
                          {ACTIVITY_LABELS[activity.type] ?? activity.type}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {activity.user?.name && (
                            <span className="text-xs text-muted-foreground">{activity.user.name}</span>
                          )}
                          {activity.email && (
                            <span className="text-xs text-muted-foreground">({activity.email})</span>
                          )}
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0 mt-0.5">
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
    </div>
  );
}
