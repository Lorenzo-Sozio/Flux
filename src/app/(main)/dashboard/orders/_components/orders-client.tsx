"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import {
  ShoppingCart,
  Plus,
  Trash2,
  Search,
  Loader2,
  ExternalLink,
  TrendingUp,
  Clock,
  CheckCircle2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { createOrder, updateOrderStatus, deleteOrder, type OrderStatus } from "@/actions/orders";

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

type Product = {
  id: string;
  name: string;
  sku: string | null;
  price: string;
  isActive: boolean;
};

// ── Status CSS classes (no labels — translated in render) ─────────────────────

const STATUS_CLASS: Record<string, string> = {
  draft:      "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  processing: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  completed:  "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  cancelled:  "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

// ── New order form schema ─────────────────────────────────────────────────────

const newOrderSchema = z.object({
  status:    z.enum(["draft", "processing", "completed", "cancelled"]).default("draft"),
  orderDate: z.string().optional(),
  items: z.array(z.object({
    productId: z.string().min(1, "Select a product"),
    quantity:  z.coerce.number().int().min(1),
    unitPrice: z.coerce.number().min(0),
  })).min(1, "Add at least one item"),
});
type NewOrderValues = z.infer<typeof newOrderSchema>;

function formatCurrency(amount: string | number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(amount));
}

function formatDate(date: Date | string) {
  return new Date(date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// ── New Order Dialog ──────────────────────────────────────────────────────────

function NewOrderDialog({
  products,
  onCreated,
}: {
  products: Product[];
  onCreated: (order: Order) => void;
}) {
  const t = useTranslations("orders");
  const tc = useTranslations("common");
  const [open, setOpen]             = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const activeProducts = products.filter((p) => p.isActive);

  const form = useForm<NewOrderValues>({
    resolver: zodResolver(newOrderSchema),
    defaultValues: {
      status:    "draft",
      orderDate: new Date().toISOString().slice(0, 10),
      items: [{ productId: "", quantity: 1, unitPrice: 0 }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "items" });

  const watchItems = form.watch("items");
  const total = watchItems.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0), 0);

  const handleProductChange = (idx: number, productId: string) => {
    const product = activeProducts.find((p) => p.id === productId);
    if (product) {
      form.setValue(`items.${idx}.productId`, productId);
      form.setValue(`items.${idx}.unitPrice`, Number(product.price));
    }
  };

  const onSubmit = async (data: NewOrderValues) => {
    setSubmitting(true);
    try {
      const created = await createOrder(data);
      onCreated(created as unknown as Order);
      toast.success(`${t("newOrder")} ${created.orderNumber} ${tc("createSuccess").toLowerCase()}`);
      setOpen(false);
      form.reset();
    } catch (e: any) {
      toast.error(e.message ?? tc("createError"));
    } finally {
      setSubmitting(false);
    }
  };

  const STATUS_KEYS = ["draft", "processing", "completed", "cancelled"] as const;

  return (
    <>
      <Button onClick={() => setOpen(true)} className="gap-1.5">
        <Plus className="h-4 w-4" /> {t("newOrder")}
      </Button>

      <Dialog open={open} onOpenChange={(v) => { if (!submitting) { setOpen(v); if (!v) form.reset(); } }}>
        <DialogContent className="sm:max-w-[560px] p-0 gap-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b">
            <DialogTitle className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-primary" />
              {t("dialog.title")}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={form.handleSubmit(onSubmit)}>
            <div className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>{t("dialog.status")}</Label>
                  <Select
                    value={form.watch("status")}
                    onValueChange={(v) => form.setValue("status", v as any)}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_KEYS.map((v) => (
                        <SelectItem key={v} value={v}>{t(`statuses.${v}` as any)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>{t("dialog.orderDate")}</Label>
                  <Input type="date" {...form.register("orderDate")} className="h-9" />
                </div>
              </div>

              <div className="space-y-2">
                <Label>{t("dialog.lineItems")} <span className="text-destructive">*</span></Label>
                <div className="space-y-2">
                  {fields.map((field, idx) => (
                    <div key={field.id} className="grid grid-cols-[1fr_80px_100px_32px] gap-2 items-start">
                      <div>
                        <Select
                          value={form.watch(`items.${idx}.productId`)}
                          onValueChange={(v) => handleProductChange(idx, v)}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder={t("dialog.selectProduct")} />
                          </SelectTrigger>
                          <SelectContent>
                            {activeProducts.map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.name}{p.sku ? ` (${p.sku})` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {form.formState.errors.items?.[idx]?.productId && (
                          <p className="text-[10px] text-destructive mt-0.5">
                            {form.formState.errors.items[idx]?.productId?.message}
                          </p>
                        )}
                      </div>
                      <Input
                        type="number"
                        min="1"
                        {...form.register(`items.${idx}.quantity`)}
                        placeholder={t("dialog.qty")}
                        className="h-8 text-xs"
                      />
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        {...form.register(`items.${idx}.unitPrice`)}
                        placeholder={t("dialog.price")}
                        className="h-8 text-xs font-mono"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => remove(idx)}
                        disabled={fields.length === 1}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() => append({ productId: "", quantity: 1, unitPrice: 0 })}
                >
                  <Plus className="h-3 w-3" /> {t("dialog.addItem")}
                </Button>
                {form.formState.errors.items?.root && (
                  <p className="text-xs text-destructive">{form.formState.errors.items.root.message}</p>
                )}
              </div>

              <div className="flex items-center justify-end border-t pt-3">
                <span className="text-sm text-muted-foreground mr-3">{t("dialog.total")}</span>
                <span className="text-lg font-bold tabular-nums">{formatCurrency(total)}</span>
              </div>
            </div>

            <DialogFooter className="px-6 py-4 border-t bg-muted/10">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
                {tc("cancel")}
              </Button>
              <Button type="submit" disabled={submitting} className="gap-2">
                {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {t("dialog.createOrder")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function OrdersClient({
  orders: initial,
  stats: initialStats,
  products,
}: {
  orders: Order[];
  stats: Stats;
  products: Product[];
}) {
  const t = useTranslations("orders");
  const tc = useTranslations("common");
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [orders, setOrders]   = useState(initial);
  const [stats]               = useState(initialStats);
  const [search, setSearch]   = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const filtered = orders.filter((o) => {
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      o.orderNumber.toLowerCase().includes(q) ||
      (o.companyName ?? "").toLowerCase().includes(q) ||
      (`${o.contactFirstName ?? ""} ${o.contactLastName ?? ""}`.trim()).toLowerCase().includes(q);
    const matchStatus = filterStatus === "all" || o.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const handleStatusChange = (id: string, status: OrderStatus) => {
    startTransition(async () => {
      await updateOrderStatus(id, status);
      setOrders((prev) => prev.map((o) => o.id === id ? { ...o, status } : o));
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
    { labelKey: "stats.totalOrders", value: stats.total,     filter: "all",        icon: ShoppingCart, color: "text-primary" },
    { labelKey: "stats.processing",  value: stats.processing, filter: "processing", icon: Clock,        color: "text-blue-500" },
    { labelKey: "stats.completed",   value: stats.completed,  filter: "completed",  icon: CheckCircle2, color: "text-emerald-500" },
    { labelKey: "stats.revenue",     value: formatCurrency(stats.revenue ?? 0), filter: null, icon: TrendingUp, color: "text-violet-500" },
  ] as const;

  const STATUS_KEYS = ["draft", "processing", "completed", "cancelled"] as const;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
        </div>
        <NewOrderDialog products={products} onCreated={(o) => setOrders((prev) => [o, ...prev])} />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {STAT_CARDS.map(({ labelKey, value, filter, icon: Icon, color }) => (
          <button
            key={labelKey}
            type="button"
            onClick={() => filter && setFilterStatus(filter)}
            className={cn(
              "rounded-lg border bg-card px-4 py-3 flex items-center gap-3 text-left transition-colors",
              filter && filterStatus === filter ? "border-primary bg-primary/5" : "hover:bg-muted/30",
              !filter && "cursor-default",
            )}
          >
            <Icon className={cn("h-5 w-5 shrink-0", color)} />
            <div>
              <p className="text-xl font-bold leading-none">{value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t(labelKey)}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
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
              <SelectItem key={v} value={v}>{t(`statuses.${v}` as any)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
              <th className="px-4 py-2.5 text-left font-medium">{t("columns.number")}</th>
              <th className="px-4 py-2.5 text-left font-medium hidden md:table-cell">{t("columns.customer")}</th>
              <th className="px-4 py-2.5 text-left font-medium hidden sm:table-cell">{t("columns.date")}</th>
              <th className="px-4 py-2.5 text-left font-medium">{t("columns.status")}</th>
              <th className="px-4 py-2.5 text-right font-medium">{tc("amount")}</th>
              <th className="w-20 px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-14 text-center">
                  <ShoppingCart className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-muted-foreground text-sm">
                    {search || filterStatus !== "all"
                      ? t("noOrdersSearch")
                      : t("noOrdersYet")}
                  </p>
                </td>
              </tr>
            ) : (
              filtered.map((order) => {
                const statusClass = STATUS_CLASS[order.status] ?? STATUS_CLASS.draft;
                const statusLabel = t(`statuses.${order.status as "draft" | "processing" | "completed" | "cancelled"}`);
                const customer =
                  order.contactFirstName
                    ? `${order.contactFirstName} ${order.contactLastName ?? ""}`.trim()
                    : order.companyName ?? "—";

                return (
                  <tr key={order.id} className="hover:bg-muted/30 transition-colors group">
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/orders/${order.id}`} className="font-mono text-xs font-semibold hover:text-primary transition-colors">
                        {order.orderNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-sm">{customer}</span>
                      {order.ownerName && (
                        <span className="text-xs text-muted-foreground block">{order.ownerName}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className="text-xs text-muted-foreground">{formatDate(order.orderDate)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <Select
                        value={order.status}
                        onValueChange={(v) => handleStatusChange(order.id, v as OrderStatus)}
                      >
                        <SelectTrigger className="h-7 w-32 border-0 px-2 text-xs">
                          <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 h-5", statusClass)}>
                            {statusLabel}
                          </Badge>
                        </SelectTrigger>
                        <SelectContent>
                          {STATUS_KEYS.map((v) => (
                            <SelectItem key={v} value={v} className="text-xs">{t(`statuses.${v}` as any)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-semibold tabular-nums">{formatCurrency(order.totalAmount)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity justify-end">
                        <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                          <Link href={`/dashboard/orders/${order.id}`}>
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
        <p className="text-xs text-muted-foreground text-right">
          {t("countOrders", { count: filtered.length, total: orders.length })}
        </p>
      )}
    </div>
  );
}
