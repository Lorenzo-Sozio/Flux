"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";

import Link from "next/link";

import { format } from "date-fns";
import {
  CheckCircle2,
  Clock,
  Eye,
  FileText,
  MoreHorizontal,
  Pencil,
  Plus,
  Printer,
  Search,
  Send,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { deleteQuoteAction, getAllQuotes } from "@/actions/quotes";
import { RecordCards, ResponsiveRecordList } from "@/components/crm/record-cards";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { quoteStatusConfig } from "@/lib/quote-status";
import { cn } from "@/lib/utils";

type Quote = Awaited<ReturnType<typeof getAllQuotes>>[number];

/** A quote total, in the currency the quote itself was written in. */
function quoteAmount(quote: Quote): string {
  return parseFloat(quote.totalAmount ?? "0").toLocaleString(undefined, {
    style: "currency",
    currency: quote.currency || "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * The actions on one quote.
 *
 * Lifted out of the table row so the card list can use the same menu. On the
 * table it appears on hover, which is fine with a mouse and means "never" on a
 * touchscreen — hence `alwaysVisible`, which the cards pass.
 */
function QuoteRowMenu({
  quote,
  onDelete,
  alwaysVisible = false,
  t,
  tc,
}: {
  readonly quote: Quote;
  readonly onDelete: (target: { id: string; quoteNumber: string }) => void;
  readonly alwaysVisible?: boolean;
  readonly t: ReturnType<typeof useTranslations<"quotes">>;
  readonly tc: ReturnType<typeof useTranslations<"common">>;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn("h-7 w-7 p-0", !alwaysVisible && "opacity-0 transition-opacity group-hover:opacity-100")}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem asChild>
          <Link href={`/dashboard/sales/quotes/${quote.id}`}>
            <Eye className="mr-2 h-3.5 w-3.5" />
            {tc("view")}
          </Link>
        </DropdownMenuItem>
        {quote.status === "draft" && (
          <>
            <DropdownMenuItem asChild>
              <Link href={`/dashboard/sales/quotes/${quote.id}/edit`}>
                <Pencil className="mr-2 h-3.5 w-3.5" />
                {tc("edit")}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/dashboard/sales/quotes/${quote.id}?send=1`}>
                <Send className="mr-2 h-3.5 w-3.5" />
                {t("sendQuote")}
              </Link>
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuItem onClick={() => window.open(`/api/quotes/${quote.id}`, "_blank")}>
          <Printer className="mr-2 h-3.5 w-3.5" />
          Print / PDF
        </DropdownMenuItem>
        {quote.status === "draft" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => onDelete({ id: quote.id, quoteNumber: quote.quoteNumber })}
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" />
              {tc("delete")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function QuotesPage() {
  const t = useTranslations("quotes");
  const tc = useTranslations("common");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; quoteNumber: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const fetchQuotes = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await getAllQuotes({
        status: statusFilter === "all" ? undefined : statusFilter,
      });
      setQuotes(data);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load quotes");
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchQuotes();
  }, [fetchQuotes]);

  const filteredQuotes = useMemo(() => {
    if (!searchTerm) return quotes;
    const term = searchTerm.toLowerCase();
    return quotes.filter(
      (q) =>
        q.quoteNumber.toLowerCase().includes(term) ||
        q.company?.name?.toLowerCase().includes(term) ||
        q.deal?.name?.toLowerCase().includes(term) ||
        (q.contact ? `${q.contact.firstName} ${q.contact.lastName}`.toLowerCase().includes(term) : false),
    );
  }, [quotes, searchTerm]);

  const stats = useMemo(
    () => ({
      total: quotes.length,
      sent: quotes.filter((q) => q.status === "sent" || q.status === "viewed").length,
      accepted: quotes.filter((q) => q.status === "accepted").length,
      totalValue: quotes.reduce((sum, q) => sum + parseFloat(q.totalAmount ?? "0"), 0),
    }),
    [quotes],
  );

  function handleDelete() {
    if (!deleteTarget) return;
    startTransition(async () => {
      try {
        await deleteQuoteAction(deleteTarget.id);
        toast.success(t("deleteSuccess"));
        setQuotes((prev) => prev.filter((q) => q.id !== deleteTarget.id));
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : tc("deleteError"));
      } finally {
        setDeleteTarget(null);
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-bold text-2xl tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-muted-foreground text-sm">{t("quoteNumber")}</p>
        </div>
        <Link href="/dashboard/sales/quotes/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            {t("newQuote")}
          </Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                  {tc("total")} {t("title")}
                </p>
                <p className="mt-1 font-bold text-2xl">{stats.total}</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100">
                <FileText className="h-5 w-5 text-slate-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                  {t("statuses.sent")}
                </p>
                <p className="mt-1 font-bold text-2xl text-blue-600">{stats.sent}</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50">
                <Clock className="h-5 w-5 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                  {t("statuses.accepted")}
                </p>
                <p className="mt-1 font-bold text-2xl text-green-600">{stats.accepted}</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-50">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                  {tc("value")} {tc("total")}
                </p>
                <p className="mt-1 font-bold text-2xl">
                  ${stats.totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-50">
                <TrendingUp className="h-5 w-5 text-violet-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Table card */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">
                {isLoading ? t("title") : `${filteredQuotes.length} ${t("title")}`}
              </CardTitle>
              {searchTerm && (
                <CardDescription className="mt-0.5 text-xs">Searching for &ldquo;{searchTerm}&rdquo;</CardDescription>
              )}
            </div>
            <div className="flex flex-1 gap-2 sm:min-w-[420px] sm:flex-none">
              <div className="relative flex-1">
                <Search className="-translate-y-1/2 absolute top-1/2 left-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder={`${tc("search")}…`}
                  className="h-8 pl-8 text-sm"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-8 w-[150px] text-sm">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{tc("all")}</SelectItem>
                  <SelectItem value="draft">{t("statuses.draft")}</SelectItem>
                  <SelectItem value="pending_approval">{t("statuses.pending_approval")}</SelectItem>
                  <SelectItem value="sent">{t("statuses.sent")}</SelectItem>
                  <SelectItem value="viewed">{tc("view")}</SelectItem>
                  <SelectItem value="accepted">{t("statuses.accepted")}</SelectItem>
                  <SelectItem value="declined">{t("statuses.declined")}</SelectItem>
                  <SelectItem value="expired">{t("statuses.expired")}</SelectItem>
                  <SelectItem value="converted">{tc("completed")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-md" />
              ))}
            </div>
          ) : filteredQuotes.length === 0 ? (
            <div className="py-16 text-center">
              <FileText className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
              <p className="font-medium text-muted-foreground">{t("noQuotes")}</p>
              <p className="mt-1 mb-5 text-muted-foreground/70 text-sm">
                {searchTerm || statusFilter !== "all" ? tc("clearFilters") : t("newQuote")}
              </p>
              {!searchTerm && statusFilter === "all" && (
                <Link href="/dashboard/sales/quotes/new">
                  <Button variant="outline" size="sm">
                    <Plus className="mr-2 h-4 w-4" />
                    {t("newQuote")}
                  </Button>
                </Link>
              )}
            </div>
          ) : (
            <ResponsiveRecordList
              cards={
                <RecordCards
                  items={filteredQuotes.map((quote) => {
                    const statusCfg = quoteStatusConfig(quote.status);
                    const contactName = quote.contact
                      ? `${quote.contact.firstName} ${quote.contact.lastName}`.trim()
                      : null;
                    const expired =
                      quote.expiresAt && quote.status !== "accepted" && new Date(quote.expiresAt) < new Date();

                    return {
                      id: quote.id,
                      href: `/dashboard/sales/quotes/${quote.id}`,
                      title: <span className="font-mono">{quote.quoteNumber}</span>,
                      subtitle: [quote.company?.name, contactName].filter(Boolean).join(" · ") || undefined,
                      badge: <span className="font-semibold text-sm tabular-nums">{quoteAmount(quote)}</span>,
                      fields: [
                        {
                          label: t("columns.status"),
                          value: (
                            <Badge variant="outline" className={`font-medium text-xs ${statusCfg.className}`}>
                              {t(`statuses.${statusCfg.labelKey}`)}
                            </Badge>
                          ),
                        },
                        {
                          label: t("columns.expires"),
                          value: quote.expiresAt ? (
                            <span className={expired ? "font-medium text-destructive" : undefined}>
                              {format(new Date(quote.expiresAt), "MMM d, yyyy")}
                            </span>
                          ) : null,
                        },
                      ],
                      actions: <QuoteRowMenu quote={quote} onDelete={setDeleteTarget} alwaysVisible t={t} tc={tc} />,
                    };
                  })}
                />
              }
              table={
                <div className="overflow-hidden rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40 hover:bg-muted/40">
                        <TableHead className="font-semibold text-xs">{t("columns.number")}</TableHead>
                        <TableHead className="font-semibold text-xs">{t("columns.customer")}</TableHead>
                        <TableHead className="font-semibold text-xs">{t("columns.deal")}</TableHead>
                        <TableHead className="font-semibold text-xs">{t("columns.status")}</TableHead>
                        <TableHead className="text-right font-semibold text-xs">{tc("amount")}</TableHead>
                        <TableHead className="font-semibold text-xs">{t("columns.issued")}</TableHead>
                        <TableHead className="font-semibold text-xs">{t("columns.expires")}</TableHead>
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredQuotes.map((quote) => {
                        const statusCfg = quoteStatusConfig(quote.status);
                        const contactName = quote.contact
                          ? `${quote.contact.firstName} ${quote.contact.lastName}`.trim()
                          : null;
                        const isExpired =
                          quote.expiresAt && quote.status !== "accepted" && new Date(quote.expiresAt) < new Date();

                        return (
                          <TableRow key={quote.id} className="group transition-colors hover:bg-muted/30">
                            <TableCell className="font-medium font-mono text-sm">
                              <Link
                                href={`/dashboard/sales/quotes/${quote.id}`}
                                className="text-primary hover:underline"
                              >
                                {quote.quoteNumber}
                              </Link>
                            </TableCell>
                            <TableCell>
                              <div className="font-medium text-sm leading-tight">{quote.company?.name ?? "—"}</div>
                              {contactName && <div className="mt-0.5 text-muted-foreground text-xs">{contactName}</div>}
                            </TableCell>
                            <TableCell className="text-muted-foreground text-sm">{quote.deal?.name ?? "—"}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={`font-medium text-xs ${statusCfg.className}`}>
                                {t(`statuses.${statusCfg.labelKey}`)}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-semibold text-sm tabular-nums">
                              {quoteAmount(quote)}
                            </TableCell>
                            <TableCell className="text-muted-foreground text-sm">
                              {format(new Date(quote.issuedAt), "MMM d, yyyy")}
                            </TableCell>
                            <TableCell className="text-sm">
                              {quote.expiresAt ? (
                                <span className={isExpired ? "font-medium text-destructive" : "text-muted-foreground"}>
                                  {format(new Date(quote.expiresAt), "MMM d, yyyy")}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <QuoteRowMenu quote={quote} onDelete={setDeleteTarget} t={t} tc={tc} />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              }
            />
          )}
        </CardContent>
      </Card>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteQuote")}</AlertDialogTitle>
            <AlertDialogDescription>
              {tc("confirmDelete")} <span className="font-semibold">{deleteTarget?.quoteNumber}</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isPending ? "…" : tc("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
