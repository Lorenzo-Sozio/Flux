"use client";

import React, { useState, useMemo, useTransition, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { format } from "date-fns";
import {
  Plus,
  Search,
  MoreHorizontal,
  Eye,
  Send,
  Pencil,
  Printer,
  Trash2,
  FileText,
  TrendingUp,
  CheckCircle2,
  Clock,
} from "lucide-react";
import Link from "next/link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getAllQuotes, deleteQuoteAction } from "@/actions/quotes";
import { QUOTE_STATUS_CONFIG } from "@/lib/quote-status";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

type Quote = Awaited<ReturnType<typeof getAllQuotes>>[number];


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

  useEffect(() => { fetchQuotes(); }, [fetchQuotes]);

  const filteredQuotes = useMemo(() => {
    if (!searchTerm) return quotes;
    const term = searchTerm.toLowerCase();
    return quotes.filter(
      (q) =>
        q.quoteNumber.toLowerCase().includes(term) ||
        q.company?.name?.toLowerCase().includes(term) ||
        q.deal?.name?.toLowerCase().includes(term) ||
        (q.contact
          ? `${q.contact.firstName} ${q.contact.lastName}`.toLowerCase().includes(term)
          : false)
    );
  }, [quotes, searchTerm]);

  const stats = useMemo(
    () => ({
      total:      quotes.length,
      sent:       quotes.filter((q) => q.status === "sent" || q.status === "viewed").length,
      accepted:   quotes.filter((q) => q.status === "accepted").length,
      totalValue: quotes.reduce((sum, q) => sum + parseFloat(q.totalAmount ?? "0"), 0),
    }),
    [quotes]
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
    <div className="p-6 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("quoteNumber")}
          </p>
        </div>
        <Link href="/dashboard/quotes/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            {t("newQuote")}
          </Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{tc("total")} {t("title")}</p>
                <p className="text-2xl font-bold mt-1">{stats.total}</p>
              </div>
              <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center">
                <FileText className="h-5 w-5 text-slate-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("statuses.sent")}</p>
                <p className="text-2xl font-bold mt-1 text-blue-600">{stats.sent}</p>
              </div>
              <div className="h-10 w-10 rounded-full bg-blue-50 flex items-center justify-center">
                <Clock className="h-5 w-5 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("statuses.accepted")}</p>
                <p className="text-2xl font-bold mt-1 text-green-600">{stats.accepted}</p>
              </div>
              <div className="h-10 w-10 rounded-full bg-green-50 flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{tc("value")} {tc("total")}</p>
                <p className="text-2xl font-bold mt-1">
                  ${stats.totalValue.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                </p>
              </div>
              <div className="h-10 w-10 rounded-full bg-violet-50 flex items-center justify-center">
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
                <CardDescription className="text-xs mt-0.5">
                  Searching for &ldquo;{searchTerm}&rdquo;
                </CardDescription>
              )}
            </div>
            <div className="flex gap-2 flex-1 sm:flex-none sm:min-w-[420px]">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder={`${tc("search")}…`}
                  className="pl-8 h-8 text-sm"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[150px] h-8 text-sm">
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
            <div className="text-center py-16">
              <FileText className="mx-auto h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="font-medium text-muted-foreground">{t("noQuotes")}</p>
              <p className="text-sm text-muted-foreground/70 mt-1 mb-5">
                {searchTerm || statusFilter !== "all"
                  ? tc("clearFilters")
                  : t("newQuote")}
              </p>
              {!searchTerm && statusFilter === "all" && (
                <Link href="/dashboard/quotes/new">
                  <Button variant="outline" size="sm">
                    <Plus className="mr-2 h-4 w-4" />
                    {t("newQuote")}
                  </Button>
                </Link>
              )}
            </div>
          ) : (
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="text-xs font-semibold">{t("columns.number")}</TableHead>
                    <TableHead className="text-xs font-semibold">{t("columns.customer")}</TableHead>
                    <TableHead className="text-xs font-semibold">{t("columns.deal")}</TableHead>
                    <TableHead className="text-xs font-semibold">{t("columns.status")}</TableHead>
                    <TableHead className="text-xs font-semibold text-right">{tc("amount")}</TableHead>
                    <TableHead className="text-xs font-semibold">{t("columns.issued")}</TableHead>
                    <TableHead className="text-xs font-semibold">{t("columns.expires")}</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredQuotes.map((quote) => {
                    const statusCfg = QUOTE_STATUS_CONFIG[quote.status] ?? QUOTE_STATUS_CONFIG.draft;
                    const contactName = quote.contact
                      ? `${quote.contact.firstName} ${quote.contact.lastName}`.trim()
                      : null;
                    const isExpired =
                      quote.expiresAt &&
                      quote.status !== "accepted" &&
                      new Date(quote.expiresAt) < new Date();

                    return (
                      <TableRow key={quote.id} className="group hover:bg-muted/30 transition-colors">
                        <TableCell className="font-mono text-sm font-medium">
                          <Link
                            href={`/dashboard/quotes/${quote.id}`}
                            className="text-primary hover:underline"
                          >
                            {quote.quoteNumber}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-sm leading-tight">{quote.company?.name ?? "—"}</div>
                          {contactName && (
                            <div className="text-xs text-muted-foreground mt-0.5">{contactName}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {quote.deal?.name ?? "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-xs font-medium ${statusCfg.className}`}>
                            {statusCfg.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-semibold text-sm tabular-nums">
                          {quote.currency}{" "}
                          {parseFloat(quote.totalAmount ?? "0").toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {format(new Date(quote.issuedAt), "MMM d, yyyy")}
                        </TableCell>
                        <TableCell className="text-sm">
                          {quote.expiresAt ? (
                            <span className={isExpired ? "text-destructive font-medium" : "text-muted-foreground"}>
                              {format(new Date(quote.expiresAt), "MMM d, yyyy")}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                              <DropdownMenuItem asChild>
                                <Link href={`/dashboard/quotes/${quote.id}`}>
                                  <Eye className="mr-2 h-3.5 w-3.5" />
                                  {tc("view")}
                                </Link>
                              </DropdownMenuItem>
                              {quote.status === "draft" && (
                                <>
                                  <DropdownMenuItem asChild>
                                    <Link href={`/dashboard/quotes/${quote.id}/edit`}>
                                      <Pencil className="mr-2 h-3.5 w-3.5" />
                                      {tc("edit")}
                                    </Link>
                                  </DropdownMenuItem>
                                  <DropdownMenuItem asChild>
                                    <Link href={`/dashboard/quotes/${quote.id}?send=1`}>
                                      <Send className="mr-2 h-3.5 w-3.5" />
                                      {t("sendQuote")}
                                    </Link>
                                  </DropdownMenuItem>
                                </>
                              )}
                              <DropdownMenuItem
                                onClick={() => window.open(`/api/quotes/${quote.id}`, "_blank")}
                              >
                                <Printer className="mr-2 h-3.5 w-3.5" />
                                Print / PDF
                              </DropdownMenuItem>
                              {quote.status === "draft" && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    onClick={() => setDeleteTarget({ id: quote.id, quoteNumber: quote.quoteNumber })}
                                  >
                                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                                    {tc("delete")}
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteQuote")}</AlertDialogTitle>
            <AlertDialogDescription>
              {tc("confirmDelete")}{" "}
              <span className="font-semibold">{deleteTarget?.quoteNumber}</span>
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
