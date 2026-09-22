"use client";

import { useEffect, useState, useTransition } from "react";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Loader2, Pencil, Plus, Tags, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { deletePriceList } from "@/actions/price-lists";
import { EmptyState } from "@/components/crm/empty-state";
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
import { Button } from "@/components/ui/button";
import { useOpenOnNew } from "@/hooks/use-open-on-new";
import type { Page } from "@/lib/pagination";
import { cn } from "@/lib/utils";

import { AdjustmentText } from "./adjustment-text";
import { PriceListDialog, type PriceListFields } from "./price-list-dialog";

// ── Types ─────────────────────────────────────────────────────────────────────

export type PriceListRow = {
  id: string;
  name: string;
  description: string | null;
  adjustmentPercent: string;
  isActive: boolean;
  updatedAt: Date;
  priceCount: number;
  companyCount: number;
};

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  page: Page<PriceListRow>;
  filter: string;
  /**
   * ⚠️ Computed on the server from `product:manage`. A price list is a commercial
   * decision, so a reader who may see one may not necessarily change it.
   */
  canManage: boolean;
}

/**
 * The price lists: what a group of customers pays instead of the catalogue.
 *
 * Search, the active/inactive filter and the page are all decided on the server,
 * like the catalogue behind it — a workspace that imported a supplier's lists has
 * more of these than a screen should ever hold at once.
 */
export function PriceListsClient({ page, filter, canManage }: Props) {
  const t = useTranslations("priceLists");
  const te = useTranslations("emptyStates");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [rows, setRows] = useState(page.rows);

  // A new page arrives as a new prop, and `useState` reads its argument once —
  // without this, paging or searching would leave the previous rows on screen.
  useEffect(() => setRows(page.rows), [page.rows]);

  const search = searchParams.get("q") ?? "";

  /** Moves the active/inactive filter into the URL, back to page one. */
  const setFilter = (value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value === "all") next.delete("state");
    else next.set("state", value);
    next.delete("page");
    const query = next.toString();
    startTransition(() => router.push(query ? `${pathname}?${query}` : pathname));
  };

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PriceListRow | undefined>(undefined);
  // ⚠️ Only when the reader may actually create one: `?new=true` arrives from the
  // command palette, and opening a form that every save would refuse is worse
  // than the link not working.
  useOpenOnNew(canManage, setDialogOpen);

  const [deleteTarget, setDeleteTarget] = useState<PriceListRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleOpenCreate = () => {
    setEditing(undefined);
    setDialogOpen(true);
  };
  const handleOpenEdit = (row: PriceListRow) => {
    setEditing(row);
    setDialogOpen(true);
  };

  /**
   * ⚠️ The two counts are not part of what the dialog saves, and an edit does not
   * change them: merging keeps the row's own figures rather than showing zeroes
   * until the next load.
   */
  const handleSaved = (saved: PriceListFields) => {
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], ...saved };
        return next;
      }
      return [{ ...saved, updatedAt: new Date(), priceCount: 0, companyCount: 0 }, ...prev];
    });
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deletePriceList(deleteTarget.id);
      setRows((prev) => prev.filter((r) => r.id !== deleteTarget.id));
      toast.success(t("deleteSuccess"));
    } catch {
      toast.error(t("deleteFailed"));
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* ⚠️ Wrapping, not shrinking: `min-w-0` alone would leave three lines of
          caption squeezed beside a button on a phone. The button drops to its
          own line and the sentence keeps the width it was written for. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-bold text-2xl tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
        </div>
        {canManage && (
          <Button onClick={handleOpenCreate} className="gap-1.5">
            <Plus className="h-4 w-4" />
            {t("newPriceList")}
          </Button>
        )}
      </div>

      {/* Active / inactive */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { key: "all", label: t("filters.all") },
          { key: "active", label: t("filters.active") },
          { key: "inactive", label: t("filters.inactive") },
        ].map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={cn(
              "rounded-lg border px-4 py-2.5 text-center font-medium text-sm transition-colors",
              filter === key ? "border-primary bg-primary/5" : "bg-card hover:bg-muted/30",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <ListToolbar
        total={page.total}
        page={page.page}
        pageCount={page.pageCount}
        pageSize={page.pageSize}
        shown={rows.length}
        searchPlaceholder={t("searchPlaceholder")}
      />

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-muted-foreground text-xs">
              <th className="px-4 py-2.5 text-left font-medium">{t("columns.name")}</th>
              <th className="px-4 py-2.5 text-left font-medium">{t("columns.adjustment")}</th>
              <th className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">{t("columns.prices")}</th>
              <th className="hidden px-4 py-2.5 text-right font-medium md:table-cell">{t("columns.customers")}</th>
              <th className="px-4 py-2.5 text-center font-medium">{t("columns.active")}</th>
              <th className="w-20 px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-0">
                  {search || filter !== "all" ? (
                    <EmptyState icon={Tags} title={te("filteredTitle")} description={te("filteredDescription")} />
                  ) : (
                    <EmptyState
                      icon={Tags}
                      title={t("empty.title")}
                      description={t("empty.description")}
                      action={
                        canManage ? (
                          <Button size="sm" onClick={handleOpenCreate}>
                            {t("newPriceList")}
                          </Button>
                        ) : undefined
                      }
                    />
                  )}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="group transition-colors hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/sales/price-lists/${row.id}`} className="block min-w-0">
                      <p className={cn("font-medium hover:underline", !row.isActive && "text-muted-foreground")}>
                        {row.name}
                      </p>
                      {row.description && <p className="truncate text-muted-foreground text-xs">{row.description}</p>}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <AdjustmentText adjustmentPercent={row.adjustmentPercent} />
                  </td>
                  <td className="hidden px-4 py-3 text-right tabular-nums sm:table-cell">{Number(row.priceCount)}</td>
                  <td className="hidden px-4 py-3 text-right tabular-nums md:table-cell">{Number(row.companyCount)}</td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2 py-0.5 text-xs",
                        row.isActive
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {row.isActive ? t("filters.active") : t("filters.inactive")}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {canManage && (
                      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleOpenEdit(row)}
                          title={t("edit")}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(row)}
                          title={t("deletePriceList")}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {canManage && (
        <PriceListDialog open={dialogOpen} onOpenChange={setDialogOpen} priceList={editing} onSaved={handleSaved} />
      )}

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(v) => {
          if (!v) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.name}</strong> {t("deleteDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("deletePriceList")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
