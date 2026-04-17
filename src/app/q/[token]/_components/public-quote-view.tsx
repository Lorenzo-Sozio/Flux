"use client";

import { useState } from "react";

import { format } from "date-fns";
import { Building2, Calendar, Check, Clock, User, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

// Mirror the type from the API response
interface QuoteItem {
  id: string;
  description: string | null;
  quantity: number;
  unitPrice: string;
  discountPercent: string | null;
  discountAmount: string | null;
  taxPercent: string | null;
  taxAmount: string | null;
  totalPrice: string;
  product: { name: string } | null;
}

interface PublicQuote {
  id: string;
  quoteNumber: string;
  status: string;
  currency: string;
  subtotal: string;
  discountAmount: string | null;
  taxAmount: string | null;
  totalAmount: string;
  notes: string | null;
  issuedAt: string;
  expiresAt: string | null;
  sentAt: string | null;
  viewedAt: string | null;
  acceptedAt: string | null;
  declinedAt: string | null;
  items: QuoteItem[];
  company: { name: string } | null;
  contact: { firstName: string; lastName: string } | null;
  owner: { name: string | null; email: string } | null;
}

interface Props {
  quote: PublicQuote;
  token: string;
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "border-slate-300 text-slate-600" },
  sent: { label: "Sent", className: "border-blue-300 text-blue-600 bg-blue-50" },
  viewed: { label: "Viewed", className: "border-violet-300 text-violet-600 bg-violet-50" },
  accepted: { label: "Accepted", className: "border-green-400 text-green-700 bg-green-50" },
  declined: { label: "Declined", className: "border-red-300 text-red-600 bg-red-50" },
  expired: { label: "Expired", className: "border-amber-300 text-amber-600 bg-amber-50" },
};

function fmt(amount: string | null, currency: string) {
  return `${currency} ${parseFloat(amount ?? "0").toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function PublicQuoteView({ quote, token }: Props) {
  const [status, setStatus] = useState(quote.status);
  const [loading, setLoading] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [showDeclineForm, setShowDeclineForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const statusCfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.sent;
  const contactName = quote.contact
    ? `${quote.contact.firstName} ${quote.contact.lastName}`.trim()
    : null;
  const canAct = ["sent", "viewed"].includes(status);

  async function handleAction(action: "accepted" | "declined") {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/quotes/public", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action, reason: declineReason || undefined }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Something went wrong");
        return;
      }
      setStatus(action);
      setShowDeclineForm(false);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-muted/30 py-10 px-4">
      <div className="mx-auto max-w-3xl space-y-6">
        {/* Branding header */}
        <div className="text-center space-y-1">
          <p className="text-sm text-muted-foreground">You have received a quote from</p>
          {quote.owner && (
            <p className="font-semibold text-lg">{quote.owner.name ?? quote.owner.email}</p>
          )}
        </div>

        {/* Main quote card */}
        <Card className="shadow-md">
          <CardHeader className="pb-4">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <span className="text-xl font-bold font-mono tracking-tight">{quote.quoteNumber}</span>
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
            </div>
          </CardHeader>

          <Separator />

          {/* Line items */}
          <CardContent className="pt-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-xs uppercase tracking-wide">
                    <th className="text-left py-2 font-medium">Description</th>
                    <th className="text-right py-2 font-medium">Qty</th>
                    <th className="text-right py-2 font-medium">Unit Price</th>
                    <th className="text-right py-2 font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {quote.items.map((item) => (
                    <tr key={item.id}>
                      <td className="py-3 pr-4">
                        <p className="font-medium">{item.description ?? item.product?.name ?? "—"}</p>
                        {item.product && item.description && (
                          <p className="text-xs text-muted-foreground mt-0.5">{item.product.name}</p>
                        )}
                      </td>
                      <td className="py-3 text-right tabular-nums">{item.quantity}</td>
                      <td className="py-3 text-right tabular-nums">{fmt(item.unitPrice, quote.currency)}</td>
                      <td className="py-3 text-right font-semibold tabular-nums">
                        {fmt(item.totalPrice, quote.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>

          <Separator />

          {/* Totals */}
          <CardContent className="pt-4">
            <div className="ml-auto max-w-xs space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{fmt(quote.subtotal, quote.currency)}</span>
              </div>
              {parseFloat(quote.discountAmount ?? "0") > 0 && (
                <div className="flex justify-between text-sm text-amber-600">
                  <span>Discount</span>
                  <span>−{fmt(quote.discountAmount, quote.currency)}</span>
                </div>
              )}
              {parseFloat(quote.taxAmount ?? "0") > 0 && (
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Tax</span>
                  <span>+{fmt(quote.taxAmount, quote.currency)}</span>
                </div>
              )}
              <Separator />
              <div className="flex justify-between font-bold text-base">
                <span>Total</span>
                <span>{fmt(quote.totalAmount, quote.currency)}</span>
              </div>
            </div>
          </CardContent>

          {/* Notes */}
          {quote.notes && (
            <>
              <Separator />
              <CardContent className="pt-4">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Notes</p>
                <p className="text-sm whitespace-pre-wrap">{quote.notes}</p>
              </CardContent>
            </>
          )}
        </Card>

        {/* Action area */}
        {canAct && (
          <Card className="shadow-md border-primary/20">
            <CardContent className="pt-6 pb-6 space-y-4">
              {!showDeclineForm ? (
                <>
                  <p className="text-sm text-center text-muted-foreground">
                    Please review the quote above and accept or decline it.
                  </p>
                  <div className="flex gap-3 justify-center">
                    <Button
                      className="min-w-28 bg-green-600 hover:bg-green-700"
                      disabled={loading}
                      onClick={() => handleAction("accepted")}
                    >
                      <Check className="h-4 w-4 mr-2" />
                      Accept Quote
                    </Button>
                    <Button
                      variant="outline"
                      className="min-w-28 border-red-300 text-red-600 hover:bg-red-50"
                      disabled={loading}
                      onClick={() => setShowDeclineForm(true)}
                    >
                      <X className="h-4 w-4 mr-2" />
                      Decline
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium">Reason for declining (optional)</p>
                  <Textarea
                    placeholder="Let us know why you're declining this quote…"
                    value={declineReason}
                    onChange={(e) => setDeclineReason(e.target.value)}
                    rows={3}
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowDeclineForm(false)}
                      disabled={loading}
                    >
                      Back
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={loading}
                      onClick={() => handleAction("declined")}
                    >
                      Confirm Decline
                    </Button>
                  </div>
                </>
              )}
              {error && <p className="text-xs text-red-500 text-center">{error}</p>}
            </CardContent>
          </Card>
        )}

        {/* Accepted / Declined feedback */}
        {status === "accepted" && (
          <Card className="shadow-md border-green-300 bg-green-50 dark:bg-green-950/20">
            <CardContent className="pt-6 pb-6 text-center space-y-1">
              <div className="flex justify-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                  <Check className="h-6 w-6 text-green-600" />
                </span>
              </div>
              <p className="font-semibold text-green-700 dark:text-green-400">Quote Accepted</p>
              <p className="text-sm text-muted-foreground">Thank you! We'll be in touch shortly to proceed.</p>
            </CardContent>
          </Card>
        )}

        {status === "declined" && (
          <Card className="shadow-md border-red-200 bg-red-50 dark:bg-red-950/20">
            <CardContent className="pt-6 pb-6 text-center space-y-1">
              <div className="flex justify-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
                  <X className="h-6 w-6 text-red-600" />
                </span>
              </div>
              <p className="font-semibold text-red-600 dark:text-red-400">Quote Declined</p>
              <p className="text-sm text-muted-foreground">We've recorded your response. Feel free to reach out if you'd like to discuss.</p>
            </CardContent>
          </Card>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground">
          Powered by Flux CRM · This quote was sent to you directly by {quote.owner?.name ?? quote.owner?.email ?? "the sender"}
        </p>
      </div>
    </div>
  );
}
