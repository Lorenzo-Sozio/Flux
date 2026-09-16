"use client";

import { useState } from "react";

import { Building2, Calendar, Check, Clock, User, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  type DocumentLanguage,
  formatDocumentDate,
  formatDocumentMoney,
  QUOTE_TEXT,
  quoteStatusText,
} from "@/lib/document-language";

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
  /** The customer's language, decided by the API from their record. */
  language: DocumentLanguage;
  sellerName: string;
}

interface Props {
  quote: PublicQuote;
  token: string;
}

const STATUS_STYLE: Record<string, string> = {
  draft: "border-slate-300 text-slate-600",
  sent: "border-blue-300 text-blue-600 bg-blue-50",
  viewed: "border-violet-300 text-violet-600 bg-violet-50",
  accepted: "border-green-400 text-green-700 bg-green-50",
  declined: "border-red-300 text-red-600 bg-red-50",
  expired: "border-amber-300 text-amber-600 bg-amber-50",
};

export function PublicQuoteView({ quote, token }: Props) {
  const [status, setStatus] = useState(quote.status);
  const [loading, setLoading] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [showDeclineForm, setShowDeclineForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The customer's language, not the browser's: the same quote reads the same for
  // everyone it is forwarded to.
  const lang = quote.language ?? "it";
  const tx = QUOTE_TEXT[lang];
  const fmt = (amount: string | null) => formatDocumentMoney(amount, quote.currency, lang);
  const statusClass = STATUS_STYLE[status] ?? STATUS_STYLE.sent;
  const contactName = quote.contact ? `${quote.contact.firstName} ${quote.contact.lastName}`.trim() : null;
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
        const data = (await res.json().catch(() => ({}))) as { code?: string };
        setError(
          data.code === "expired"
            ? tx.expired
            : data.code === "not_actionable"
              ? tx.notActionable
              : res.status === 404
                ? tx.notFound
                : tx.somethingWrong,
        );
        return;
      }
      setStatus(action);
      setShowDeclineForm(false);
    } catch {
      setError(tx.networkError);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-dvh bg-muted/30 py-10 px-4">
      <div className="mx-auto max-w-3xl space-y-6">
        {/* Branding header */}
        <div className="text-center space-y-1">
          <p className="text-sm text-muted-foreground">{tx.receivedFrom}</p>
          <p className="font-semibold text-lg">{quote.sellerName || quote.owner?.name || quote.owner?.email}</p>
        </div>

        {/* Main quote card */}
        <Card className="shadow-md">
          <CardHeader className="pb-4">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <span className="text-xl font-bold font-mono tracking-tight">{quote.quoteNumber}</span>
                  <Badge variant="outline" className={`text-xs font-medium ${statusClass}`}>
                    {quoteStatusText(status, lang)}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" />
                    {tx.issued} {formatDocumentDate(quote.issuedAt, lang)}
                  </span>
                  {quote.expiresAt && (
                    <span className="flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" />
                      {tx.expires} {formatDocumentDate(quote.expiresAt, lang)}
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
                    <th className="text-left py-2 font-medium">{tx.description}</th>
                    <th className="text-right py-2 font-medium">{tx.quantity}</th>
                    <th className="text-right py-2 font-medium">{tx.unitPrice}</th>
                    <th className="text-right py-2 font-medium">{tx.lineTotal}</th>
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
                      <td className="py-3 text-right tabular-nums">{fmt(item.unitPrice)}</td>
                      <td className="py-3 text-right font-semibold tabular-nums">{fmt(item.totalPrice)}</td>
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
                <span className="text-muted-foreground">{tx.subtotal}</span>
                <span>{fmt(quote.subtotal)}</span>
              </div>
              {parseFloat(quote.discountAmount ?? "0") > 0 && (
                <div className="flex justify-between text-sm text-amber-600">
                  <span>{tx.discountOn}</span>
                  <span>−{fmt(quote.discountAmount)}</span>
                </div>
              )}
              {parseFloat(quote.taxAmount ?? "0") > 0 && (
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>{tx.taxOn}</span>
                  <span>+{fmt(quote.taxAmount)}</span>
                </div>
              )}
              <Separator />
              <div className="flex justify-between font-bold text-base">
                <span>{tx.total}</span>
                <span>{fmt(quote.totalAmount)}</span>
              </div>
            </div>
          </CardContent>

          {/* Notes */}
          {quote.notes && (
            <>
              <Separator />
              <CardContent className="pt-4">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">{tx.notes}</p>
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
                  <p className="text-sm text-center text-muted-foreground">{tx.reviewPrompt}</p>
                  <div className="flex gap-3 justify-center">
                    <Button
                      className="min-w-28 bg-green-600 hover:bg-green-700"
                      disabled={loading}
                      onClick={() => handleAction("accepted")}
                    >
                      <Check className="h-4 w-4 mr-2" />
                      {tx.accept}
                    </Button>
                    <Button
                      variant="outline"
                      className="min-w-28 border-red-300 text-red-600 hover:bg-red-50"
                      disabled={loading}
                      onClick={() => setShowDeclineForm(true)}
                    >
                      <X className="h-4 w-4 mr-2" />
                      {tx.decline}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium">{tx.declineReason}</p>
                  <Textarea
                    placeholder={tx.declinePlaceholder}
                    value={declineReason}
                    onChange={(e) => setDeclineReason(e.target.value)}
                    rows={3}
                  />
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setShowDeclineForm(false)} disabled={loading}>
                      {tx.back}
                    </Button>
                    <Button size="sm" variant="destructive" disabled={loading} onClick={() => handleAction("declined")}>
                      {tx.confirmDecline}
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
              <p className="font-semibold text-green-700 dark:text-green-400">{tx.acceptedTitle}</p>
              <p className="text-sm text-muted-foreground">{tx.acceptedBody}</p>
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
              <p className="font-semibold text-red-600 dark:text-red-400">{tx.declinedTitle}</p>
              <p className="text-sm text-muted-foreground">{tx.declinedBody}</p>
            </CardContent>
          </Card>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground">
          {tx.sentBy.replace("{name}", quote.sellerName || quote.owner?.name || quote.owner?.email || "")}
        </p>
      </div>
    </div>
  );
}
