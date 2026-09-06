"use client";

import { useEffect, useState, useTransition } from "react";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { CheckCircle2, Clock, ExternalLink, Plus, ShoppingCart, Trash2, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { deleteOrder, type OrderStatus, updateOrderStatus } from "@/actions/orders";
import { EmptyState } from "@/components/crm/empty-state";
import { ListToolbar } from "@/components/crm/list-toolbar";
import { RecordCards, ResponsiveRecordList } from "@/components/crm/record-cards";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCurrency } from "@/hooks/use-currency";
import type { Page } from "@/lib/pagination";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type Order = {
  id: string;
  orderNumber: string;
  status: string;
  totalAmount: string;
  orderDate: Date;
  createdAt: Date;
  companyId: string | null;
  contactId: string | null;
  ownerId: string | null;
  companyName: string | null;
  contactFirstName: string | null;
  contactLastName: string | null;
  contactEmail: string | null;
  ownerName: string | null;
};

type Stats = {
  total: number;
  draft: number;
  processing: number;
  completed: number;
  cancelled: number;
  revenue: number;
};

// ── Status CSS classes (no labels — translated in render) ─────────────────────

const STATUS_CLASS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  processing: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  cancelled: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

function formatDate(date: Date | string) {
  return new Date(date).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * The orders list.
 *
 * ⚠️ Search, status and paging are decided on the server now. This component used
 * to receive every order the workspace had ever taken and narrow them in the
 * browser, so the first paint waited for the whole history and the line at the
 * bottom was the only thing that ever mentioned how much of it there was.
 */
export function OrdersClient({
  page,
  stats: initialStats,
  status,
}: {
  page: Page<Order>;
  stats: Stats;
  status: string;
}) {
  const t = useTranslations("orders");
  const te = useTranslations("emptyStates");
  const tc = useTranslations("common");
  const { formatAmount } = useCurrency();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [orders, setOrders] = useState(page.rows);
  const [stats] = useState(initialStats);

  // A new page arrives as a new prop, and `useState` reads its argument once —
  // without this, paging or searching left the previous rows on screen.
  useEffect(() => setOrders(page.rows), [page.rows]);

  const search = searchParams.get("q") ?? "";

  /** Moves the status filter into the URL, back to page one. */
  const setFilterStatus = (value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value === "all") next.delete("status");
    else next.set("status", value);
    next.delete("page");
    const q = next.toString();
    startTransition(() => router.push(q ? `${pathname}?${q}` : pathname));
  };

  const handleStatusChange = (id: string, status: OrderStatus) => {
    startTransition(async () => {
      await updateOrderStatus(id, status);
      setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)));
      toast.success(tc("updateSuccess"));
    });
  };

  const handleDelete = (id: string) => {
    if (!confirm(tc("confirmDelete"))) return;
    startTransition(async () => {
      await deleteOrder(id);
      setOrders((prev) => prev.filter((o) => o.id !== id));
      toast.success(t("deleteSuccess"));
    });
  };

  const STAT_CARDS = [
    { labelKey: "stats.totalOrders", value: stats.total, filter: "all", icon: ShoppingCart, color: "text-primary" },
    {
      labelKey: "stats.processing",
      value: stats.processing,
      filter: "processing",
      icon: Clock,
      color: "text-blue-500",
    },
    {
      labelKey: "stats.completed",
      value: stats.completed,
      filter: "completed",
      icon: CheckCircle2,
      color: "text-emerald-500",
    },
    {
      labelKey: "stats.revenue",
      value: formatAmount(stats.revenue ?? 0),
      filter: null,
      icon: TrendingUp,
      color: "text-violet-500",
    },
  ] as const;

  const STATUS_KEYS = ["draft", "processing", "completed", "cancelled"] as const;

  const customerOf = (order: (typeof orders)[number]) =>
    order.contactFirstName
      ? `${order.contactFirstName} ${order.contactLastName ?? ""}`.trim()
      : (order.companyName ?? "—");

  const emptyState =
    search || status !== "all" ? (
      <EmptyState icon={ShoppingCart} title={te("filteredTitle")} description={te("filteredDescription")} />
    ) : (
      <EmptyState
        icon={ShoppingCart}
        title={te("orders.title")}
        description={te("orders.description")}
        action={
          <Button asChild size="sm">
            <Link href="/dashboard/sales/orders/new">
              <Plus className="h-4 w-4" /> {t("newOrder")}
            </Link>
          </Button>
        }
      />
    );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-bold text-2xl tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
        </div>
        {/*
          Writing an order used to happen in a 560-pixel dialog that could not say
          who it was for and could not carry a line that is not in the catalogue.
          It is a page now.
        */}
        <Button asChild className="gap-1.5">
          <Link href="/dashboard/sales/orders/new">
            <Plus className="h-4 w-4" /> {t("newOrder")}
          </Link>
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {STAT_CARDS.map(({ labelKey, value, filter, icon: Icon, color }) => (
          <button
            key={labelKey}
            type="button"
            onClick={() => filter && setFilterStatus(filter)}
            className={cn(
              "flex items-center gap-3 rounded-lg border bg-card px-4 py-3 text-left transition-colors",
              filter && status === filter ? "border-primary bg-primary/5" : "hover:bg-muted/30",
              !filter && "cursor-default",
            )}
          >
            <Icon className={cn("h-5 w-5 shrink-0", color)} />
            <div>
              <p className="font-bold text-xl leading-none">{value}</p>
              <p className="mt-0.5 text-muted-foreground text-xs">{t(labelKey)}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <ListToolbar
          total={page.total}
          page={page.page}
          pageCount={page.pageCount}
          pageSize={page.pageSize}
          shown={orders.length}
          searchPlaceholder={t("searchPlaceholder")}
        />
        <Select value={status} onValueChange={setFilterStatus}>
          <SelectTrigger className="h-8 w-36 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allStatuses")}</SelectItem>
            {STATUS_KEYS.map((v) => (
              <SelectItem key={v} value={v}>
                {t(`statuses.${v}` as Parameters<typeof t>[0])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {orders.length === 0 ? (
        emptyState
      ) : (
        <ResponsiveRecordList
          cards={
            <RecordCards
              items={orders.map((order) => ({
                id: order.id,
                href: `/dashboard/sales/orders/${order.id}`,
                title: <span className="font-mono">{order.orderNumber}</span>,
                subtitle: customerOf(order),
                badge: (
                  <span className="font-semibold text-sm tabular-nums">{formatAmount(Number(order.totalAmount))}</span>
                ),
                fields: [
                  { label: t("columns.date"), value: formatDate(order.orderDate) },
                  { label: t("columns.owner"), value: order.ownerName },
                ],
                // The row actions on the desktop table appear on hover, which on
                // a touchscreen means never. Here they are simply visible.
                actions: (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleDelete(order.id)}
                    aria-label={tc("delete")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ),
                // Changing a status is the one thing this list is opened to do,
                // and it cannot live inside the card's link.
                footer: (
                  <Select value={order.status} onValueChange={(v) => handleStatusChange(order.id, v as OrderStatus)}>
                    <SelectTrigger className="h-9 w-full text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_KEYS.map((v) => (
                        <SelectItem key={v} value={v} className="text-xs">
                          {t(`statuses.${v}` as Parameters<typeof t>[0])}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ),
              }))}
            />
          }
          table={
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-muted-foreground text-xs">
                    <th className="px-4 py-2.5 text-left font-medium">{t("columns.number")}</th>
                    <th className="hidden px-4 py-2.5 text-left font-medium md:table-cell">{t("columns.customer")}</th>
                    <th className="hidden px-4 py-2.5 text-left font-medium sm:table-cell">{t("columns.date")}</th>
                    <th className="px-4 py-2.5 text-left font-medium">{t("columns.status")}</th>
                    <th className="px-4 py-2.5 text-right font-medium">{tc("amount")}</th>
                    <th className="w-20 px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {orders.map((order) => {
                    const statusClass = STATUS_CLASS[order.status] ?? STATUS_CLASS.draft;
                    const statusLabel = t(
                      `statuses.${order.status as "draft" | "processing" | "completed" | "cancelled"}`,
                    );
                    const customer = customerOf(order);

                    return (
                      <tr key={order.id} className="group transition-colors hover:bg-muted/30">
                        <td className="px-4 py-3">
                          <Link
                            href={`/dashboard/sales/orders/${order.id}`}
                            className="font-mono font-semibold text-xs transition-colors hover:text-primary"
                          >
                            {order.orderNumber}
                          </Link>
                        </td>
                        <td className="hidden px-4 py-3 md:table-cell">
                          <span className="text-sm">{customer}</span>
                          {order.ownerName && (
                            <span className="block text-muted-foreground text-xs">{order.ownerName}</span>
                          )}
                        </td>
                        <td className="hidden px-4 py-3 sm:table-cell">
                          <span className="text-muted-foreground text-xs">{formatDate(order.orderDate)}</span>
                        </td>
                        <td className="px-4 py-3">
                          <Select
                            value={order.status}
                            onValueChange={(v) => handleStatusChange(order.id, v as OrderStatus)}
                          >
                            <SelectTrigger className="h-7 w-32 border-0 px-2 text-xs">
                              <Badge variant="outline" className={cn("h-5 px-1.5 py-0 text-[10px]", statusClass)}>
                                {statusLabel}
                              </Badge>
                            </SelectTrigger>
                            <SelectContent>
                              {STATUS_KEYS.map((v) => (
                                <SelectItem key={v} value={v} className="text-xs">
                                  {t(`statuses.${v}` as Parameters<typeof t>[0])}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-semibold tabular-nums">{formatAmount(Number(order.totalAmount))}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                            <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                              <Link href={`/dashboard/sales/orders/${order.id}`}>
                                <ExternalLink className="h-3.5 w-3.5" />
                              </Link>
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => handleDelete(order.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          }
        />
      )}
    </div>
  );
}
