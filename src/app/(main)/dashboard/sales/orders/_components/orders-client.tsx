"use client";

import { useState, useTransition } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { CheckCircle2, Clock, ExternalLink, Plus, Search, ShoppingCart, Trash2, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { deleteOrder, type OrderStatus, updateOrderStatus } from "@/actions/orders";
import { EmptyState } from "@/components/crm/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCurrency } from "@/hooks/use-currency";
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

export function OrdersClient({ orders: initial, stats: initialStats }: { orders: Order[]; stats: Stats }) {
  const t = useTranslations("orders");
  const te = useTranslations("emptyStates");
  const tc = useTranslations("common");
  const { formatAmount } = useCurrency();
  const _router = useRouter();
  const [, startTransition] = useTransition();
  const [orders, setOrders] = useState(initial);
  const [stats] = useState(initialStats);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const filtered = orders.filter((o) => {
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      o.orderNumber.toLowerCase().includes(q) ||
      (o.companyName ?? "").toLowerCase().includes(q) ||
      `${o.contactFirstName ?? ""} ${o.contactLastName ?? ""}`.trim().toLowerCase().includes(q);
    const matchStatus = filterStatus === "all" || o.status === filterStatus;
    return matchSearch && matchStatus;
  });

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

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
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
              filter && filterStatus === filter ? "border-primary bg-primary/5" : "hover:bg-muted/30",
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
        <div className="relative max-w-xs flex-1">
          <Search className="-translate-y-1/2 absolute top-1/2 left-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-sm"
          />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
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

      {/* Table */}
      <div className="overflow-hidden rounded-md border">
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
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-0">
                  {search || filterStatus !== "all" ? (
                    <EmptyState
                      icon={ShoppingCart}
                      title={te("filteredTitle")}
                      description={te("filteredDescription")}
                    />
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
                  )}
                </td>
              </tr>
            ) : (
              filtered.map((order) => {
                const statusClass = STATUS_CLASS[order.status] ?? STATUS_CLASS.draft;
                const statusLabel = t(`statuses.${order.status as "draft" | "processing" | "completed" | "cancelled"}`);
                const customer = order.contactFirstName
                  ? `${order.contactFirstName} ${order.contactLastName ?? ""}`.trim()
                  : (order.companyName ?? "—");

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
              })
            )}
          </tbody>
        </table>
      </div>

      {filtered.length > 0 && (
        <p className="text-right text-muted-foreground text-xs">
          {t("countOrders", { count: filtered.length, total: orders.length })}
        </p>
      )}
    </div>
  );
}
