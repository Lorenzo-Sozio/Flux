"use client";

import { useState } from "react";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { type ContractList, deleteContract } from "@/actions/contracts";
import { ListToolbar } from "@/components/crm/list-toolbar";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCurrency } from "@/hooks/use-currency";
import type { ContractPhase } from "@/lib/contract-terms";
import { cn } from "@/lib/utils";

const VIEWS = ["all", "renewal_due", "active", "expired", "cancelled"] as const;

const PHASE_STYLE: Record<ContractPhase, string> = {
  active: "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400",
  renewal_due:
    "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  expired: "border-rose-300 text-rose-700 dark:border-rose-800 dark:text-rose-400",
  upcoming: "border-sky-300 text-sky-700 dark:border-sky-800 dark:text-sky-400",
  draft: "text-muted-foreground",
  cancelled: "text-muted-foreground line-through",
};

export function ContractsClient({
  data,
  view,
  canWrite,
  canDelete,
}: {
  data: ContractList;
  view: string;
  canWrite: boolean;
  canDelete: boolean;
}) {
  const t = useTranslations("contracts");
  const router = useRouter();
  const { formatMoney } = useCurrency();
  const byCurrency = (factor: number) =>
    data.mrr.length
      ? data.mrr.map((m) => formatMoney(m.amount * factor, m.currency)).join(" · ")
      : formatMoney(0, "EUR");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const searchParams = useSearchParams();
  const rows = data.page.rows;
  const due = data.renewalsDue;
  const earning = data.earning;

  /** A view keeps the search and starts again at page one. */
  const viewHref = (v: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (v === "all") next.delete("view");
    else next.set("view", v);
    next.delete("page");
    const q = next.toString();
    return q ? `?${q}` : "?";
  };

  const remove = async () => {
    if (!deleteId) return;
    try {
      await deleteContract(deleteId);
      toast.success(t("deleted"));
      router.refresh();
    } catch {
      toast.error(t("failed"));
    } finally {
      setDeleteId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-bold text-2xl tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
        </div>
        {canWrite && (
          <Button asChild className="gap-2">
            <Link href="/dashboard/sales/contracts/new">
              <Plus className="h-4 w-4" />
              {t("newContract")}
            </Link>
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="font-medium text-muted-foreground text-sm">{t("mrr")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl tabular-nums">{byCurrency(1)}</div>
            <p className="mt-1 text-muted-foreground text-xs">{t("mrrDesc", { count: earning })}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="font-medium text-muted-foreground text-sm">{t("arr")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl tabular-nums">{byCurrency(12)}</div>
            <p className="mt-1 text-muted-foreground text-xs">{t("arrDesc")}</p>
          </CardContent>
        </Card>
        <Link href={viewHref("renewal_due")} className="group">
          <Card
            className={cn(
              "transition-shadow group-hover:shadow-md",
              due > 0 && "border-amber-300 dark:border-amber-800",
            )}
          >
            <CardHeader className="pb-2">
              <CardTitle className="font-medium text-muted-foreground text-sm">{t("renewalsDue")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-bold text-2xl tabular-nums">{due}</div>
              <p className="mt-1 text-muted-foreground text-xs">{t("renewalsDueDesc")}</p>
            </CardContent>
          </Card>
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {VIEWS.map((v) => (
            <Button key={v} asChild size="sm" variant={view === v ? "default" : "outline"}>
              <Link href={viewHref(v)} scroll={false}>
                {t(`views.${v}`)}
              </Link>
            </Button>
          ))}
        </div>
        <ListToolbar
          total={data.page.total}
          page={data.page.page}
          pageCount={data.page.pageCount}
          pageSize={data.page.pageSize}
          shown={rows.length}
          searchPlaceholder={t("searchPlaceholder")}
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="py-12 text-center text-muted-foreground text-sm">{t("empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("contract")}</TableHead>
                    <TableHead>{t("status")}</TableHead>
                    <TableHead className="text-right">{t("amount")}</TableHead>
                    <TableHead className="text-right">{t("monthly")}</TableHead>
                    <TableHead>{t("termEnd")}</TableHead>
                    <TableHead>{t("noticeBy")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="min-w-0">
                        <Link href={`/dashboard/sales/contracts/${row.id}`} className="font-medium hover:underline">
                          {row.title}
                        </Link>
                        <p className="text-muted-foreground text-xs">
                          {row.companyName ?? t("noCompany")}
                          {row.ownerName ? ` · ${row.ownerName}` : ""}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("whitespace-nowrap", PHASE_STYLE[row.phase])}>
                          {t(`phases.${row.phase}`)}
                        </Badge>
                        {row.autoRenew && <p className="mt-1 text-[11px] text-muted-foreground">{t("autoRenews")}</p>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">
                        {formatMoney(row.amount, row.currency)}
                        <span className="ml-1 text-muted-foreground text-xs">
                          / {t(`periods.${row.billingPeriod}`)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(row.monthly, row.currency)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">{row.termEnd ?? "—"}</TableCell>
                      <TableCell
                        className={cn(
                          "whitespace-nowrap tabular-nums",
                          row.phase === "renewal_due" && "font-medium text-amber-700 dark:text-amber-400",
                        )}
                      >
                        {row.noticeBy ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {canWrite && (
                            <Button asChild variant="ghost" size="icon" className="h-8 w-8">
                              <Link href={`/dashboard/sales/contracts/${row.id}`} aria-label={t("edit")}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Link>
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => setDeleteId(row.id)}
                              aria-label={t("delete")}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-xs">{t("footnote", { on: data.on })}</p>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("deleteDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={remove}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
