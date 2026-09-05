"use client";

import React, { useEffect, useState, useTransition } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeft,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  DollarSign,
  Loader2,
  Package,
  Plus,
  ShoppingCart,
  Trash2,
  User,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import {
  addOrderItem,
  deleteOrder,
  getOrderById,
  type OrderStatus,
  removeOrderItem,
  updateOrderStatus,
} from "@/actions/orders";
import { getProducts } from "@/actions/products";
import { getTicketsForOrder } from "@/actions/support";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useCurrency } from "@/hooks/use-currency";
import { advanceLabelKey, isTerminalStatus, nextStatus } from "@/lib/order-status";
import { cn } from "@/lib/utils";

import { PaymentsCard } from "./_components/payments-card";

// ── Types ─────────────────────────────────────────────────────────────────────

type OrderDetail = Awaited<ReturnType<typeof getOrderById>>;
type Product = Awaited<ReturnType<typeof getProducts>>[number];

/**
 * Day and time, in the reader's own locale.
 *
 * These fields showed the day alone. On an order taken by phone at 09:10 and
 * another at 17:40 that is the difference between knowing the sequence and
 * guessing it, and the value was in the column all along.
 */
function formatDateTime(value: Date | string): string {
  return new Date(value).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_CONFIG: Record<string, { class: string }> = {
  draft: { class: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  processing: { class: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  completed: {
    class: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
  cancelled: { class: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
};

// ── Add item dialog ───────────────────────────────────────────────────────────

const addItemSchema = z.object({
  productId: z.string().min(1, "Select a product"),
  quantity: z.coerce.number().int().min(1),
  unitPrice: z.coerce.number().min(0),
});

function AddItemDialog({
  products,
  onAdded,
}: {
  products: Product[];
  onAdded: (item: { productId: string; quantity: number; unitPrice: number }) => void;
}) {
  const t = useTranslations("orders.detail");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const active = products.filter((p) => p.isActive);

  const form = useForm<z.infer<typeof addItemSchema>>({
    resolver: zodResolver(addItemSchema),
    defaultValues: { productId: "", quantity: 1, unitPrice: 0 },
  });

  const handleProductChange = (id: string) => {
    const p = active.find((x) => x.id === id);
    form.setValue("productId", id);
    if (p) form.setValue("unitPrice", Number(p.price));
  };

  const onSubmit = async (data: z.infer<typeof addItemSchema>) => {
    setSaving(true);
    try {
      await onAdded(data);
      setOpen(false);
      form.reset();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" /> {t("addItem")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!saving) {
            setOpen(v);
            if (!v) form.reset();
          }
        }}
      >
        <DialogContent className="gap-0 p-0 sm:max-w-sm">
          <DialogHeader className="border-b px-5 pt-5 pb-4">
            <DialogTitle>{t("addLineItem")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <div className="space-y-3 px-5 py-4">
              <div className="space-y-1.5">
                <Label>{t("product")}</Label>
                <Select value={form.watch("productId")} onValueChange={handleProductChange}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder={t("selectProduct")} />
                  </SelectTrigger>
                  <SelectContent>
                    {active.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                        {p.sku ? ` — ${p.sku}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.formState.errors.productId && (
                  <p className="text-destructive text-xs">{form.formState.errors.productId.message}</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>{t("qty")}</Label>
                  <Input type="number" min="1" {...form.register("quantity")} className="h-9" />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("unitPrice")}</Label>
                  <Input type="number" step="0.01" min="0" {...form.register("unitPrice")} className="h-9 font-mono" />
                </div>
              </div>
            </div>
            <DialogFooter className="border-t bg-muted/10 px-5 py-4">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
                {tc("cancel")}
              </Button>
              <Button type="submit" disabled={saving} className="gap-2">
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {tc("add")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params);
  const router = useRouter();
  const t = useTranslations("orders.detail");
  const tStatus = useTranslations("orders.statuses");
  // The pending flag was discarded. The two status buttons need it: without it a
  // slow save invites a second click, and a second click on "Close order" is a
  // second write of the same thing.
  const [isPending, startTransition] = useTransition();
  const { formatAmount } = useCurrency();

  const [order, setOrder] = useState<OrderDetail>(null);
  const [products, setProducts] = useState<Product[]>([]);
  // An order could be prepared, shipped and closed while a conversation about it
  // ran in the support module, and nothing here said so.
  const [ticketsAbout, setTicketsAbout] = useState<Awaited<ReturnType<typeof getTicketsForOrder>>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getOrderById(id), getProducts(), getTicketsForOrder(id).catch(() => [])]).then(([o, p, tk]) => {
      setOrder(o);
      setProducts(p);
      setTicketsAbout(tk);
      setLoading(false);
    });
  }, [id]);

  const handleStatusChange = (status: OrderStatus) => {
    startTransition(async () => {
      await updateOrderStatus(id, status);
      setOrder((prev) => (prev ? { ...prev, status } : prev));
      toast.success(t("statusUpdated"));
    });
  };

  const handleAddItem = async (item: { productId: string; quantity: number; unitPrice: number }) => {
    await addOrderItem(id, item);
    const updated = await getOrderById(id);
    setOrder(updated);
    toast.success(t("itemAdded"));
  };

  const handleRemoveItem = (itemId: string) => {
    if (!confirm(t("confirmRemoveItem"))) return;
    startTransition(async () => {
      await removeOrderItem(itemId, id);
      const updated = await getOrderById(id);
      setOrder(updated);
      toast.success(t("itemRemoved"));
    });
  };

  const handleDelete = () => {
    if (!confirm(t("confirmDelete"))) return;
    startTransition(async () => {
      await deleteOrder(id);
      toast.success(t("orderDeleted"));
      router.push("/dashboard/sales/orders");
    });
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-5 w-28 rounded bg-muted" />
        <div className="h-10 w-64 rounded bg-muted" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="h-64 rounded-xl bg-muted md:col-span-2" />
          <div className="h-64 rounded-xl bg-muted" />
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="py-20 text-center">
        <ShoppingCart className="mx-auto mb-4 h-12 w-12 text-muted-foreground/30" />
        <p className="mb-4 text-muted-foreground">{t("notFound")}</p>
        <Button asChild>
          <Link href="/dashboard/sales/orders">{t("back")}</Link>
        </Button>
      </div>
    );
  }

  const statusCfg = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.draft;
  // The next step this order can take, named after where it goes rather than
  // after the movement, and in the reader's language.
  const advanceKey = advanceLabelKey(order.status);
  const customer = order.contactFirstName
    ? `${order.contactFirstName} ${order.contactLastName ?? ""}`.trim()
    : (order.companyName ?? null);

  return (
    <div className="space-y-5">
      {/* Back nav */}
      <Link
        href="/dashboard/sales/orders"
        className="inline-flex items-center gap-1.5 font-medium text-muted-foreground text-sm transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> {t("allOrders")}
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="font-mono font-semibold text-muted-foreground text-xs">{order.orderNumber}</span>
          <h1 className="mt-0.5 font-bold text-2xl tracking-tight">{customer ?? "Order Details"}</h1>
          <div className="mt-2 flex items-center gap-2">
            <Badge variant="outline" className={cn("text-xs", statusCfg.class)}>
              {tStatus(order.status as "draft" | "processing" | "completed" | "cancelled")}
            </Badge>
            <span className="flex items-center gap-1 text-muted-foreground text-xs">
              <Calendar className="h-3 w-3" />
              {formatDateTime(order.orderDate)}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-destructive hover:text-destructive"
            onClick={handleDelete}
          >
            <Trash2 className="h-3.5 w-3.5" /> {t("delete")}
          </Button>
        </div>
      </div>

      {/* Content grid */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Left — line items */}
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between border-b pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Package className="h-4 w-4 text-muted-foreground" />
                {t("lineItems")}
              </CardTitle>
              <AddItemDialog products={products} onAdded={handleAddItem} />
            </CardHeader>
            <CardContent className="p-0">
              {order.items.length === 0 ? (
                <div className="py-10 text-center">
                  <Package className="mx-auto mb-2 h-8 w-8 text-muted-foreground/30" />
                  <p className="text-muted-foreground text-sm">{t("noItems")}</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30 text-muted-foreground text-xs">
                      <th className="px-4 py-2.5 text-left font-medium">{t("product")}</th>
                      <th className="px-4 py-2.5 text-right font-medium">{t("qty")}</th>
                      <th className="px-4 py-2.5 text-right font-medium">{t("unitPriceCol")}</th>
                      <th className="px-4 py-2.5 text-right font-medium">{t("totalCol")}</th>
                      <th className="w-10 px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {order.items.map((item) => (
                      <tr key={item.id} className="group hover:bg-muted/20">
                        <td className="px-4 py-3">
                          <p className="font-medium">{item.productName ?? item.description ?? "Unknown"}</p>
                          {item.productSku && (
                            <span className="font-mono text-[10px] text-muted-foreground">{item.productSku}</span>
                          )}
                          {/* What was asked for on this line: the changes the customer
                              wanted, and what they called it when that is not the
                              catalogue name. Under the item, where whoever prepares it
                              reads before touching anything. */}
                          {item.itemNotes && (
                            <p className="mt-0.5 whitespace-pre-line text-muted-foreground text-xs">{item.itemNotes}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{item.quantity}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{formatAmount(Number(item.unitPrice))}</td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums">
                          {formatAmount(Number(item.totalPrice))}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(item.id)}
                            className="text-muted-foreground/50 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t bg-muted/20">
                      <td colSpan={3} className="px-4 py-3 text-right font-medium text-muted-foreground text-sm">
                        {t("totalCol")}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-base tabular-nums">
                        {formatAmount(Number(order.totalAmount))}
                      </td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right — details */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t("orderDetails")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {/* Status */}
              <div>
                <p className="mb-1.5 text-muted-foreground text-xs">{t("status")}</p>

                {/*
                  The dropdown and the two moves anyone actually makes, on one row.
                  The buttons carry no label: at this size a word wraps the row and
                  pushes the panel about, and the two icons are the conventional
                  ones for "next" and "done". The name is still there for a hover
                  and for a screen reader, which is where it costs nothing.
                */}
                <div className="flex items-center gap-1.5">
                  <Select value={order.status} onValueChange={handleStatusChange}>
                    <SelectTrigger className="h-8 min-w-0 flex-1 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.keys(STATUS_CONFIG).map((v) => (
                        <SelectItem key={v} value={v} className="text-xs">
                          {tStatus(v as "draft" | "processing" | "completed" | "cancelled")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {!isTerminalStatus(order.status) && (
                    <TooltipProvider delayDuration={200}>
                      {advanceKey && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="outline"
                              className="h-8 w-8 shrink-0"
                              disabled={isPending}
                              aria-label={t(advanceKey)}
                              onClick={() => {
                                const next = nextStatus(order.status);
                                if (next) handleStatusChange(next);
                              }}
                            >
                              <ChevronRight className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t(advanceKey)}</TooltipContent>
                        </Tooltip>
                      )}

                      {/*
                        Only while it would skip a step. From "processing" this and
                        the arrow do the same thing, and two controls with one
                        effect is the confusion this is meant to remove.
                      */}
                      {nextStatus(order.status) !== "completed" && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              className="h-8 w-8 shrink-0 bg-emerald-600 hover:bg-emerald-700"
                              disabled={isPending}
                              aria-label={t("closeOrder")}
                              onClick={() => handleStatusChange("completed")}
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t("closeOrder")}</TooltipContent>
                        </Tooltip>
                      )}
                    </TooltipProvider>
                  )}
                </div>

                {isTerminalStatus(order.status) && (
                  <p className="mt-1.5 text-muted-foreground text-xs">
                    {order.status === "completed" ? t("closedHint") : t("cancelledHint")}
                  </p>
                )}
              </div>

              {/* Amount */}
              <div className="flex items-center justify-between border-t pt-3">
                <span className="flex items-center gap-1 text-muted-foreground text-xs">
                  <DollarSign className="h-3 w-3" /> {t("totalAmount")}
                </span>
                <span className="font-bold tabular-nums">{formatAmount(Number(order.totalAmount))}</span>
              </div>

              <div className="mb-4">
                <PaymentsCard orderId={id} totalAmount={order.totalAmount} deliveredAt={order.deliveredAt ?? null} />
              </div>

              {/* What the customer has said about it, if anything. */}
              {ticketsAbout.length > 0 && (
                <div className="mb-4 space-y-1.5">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{t("openTickets")}</p>
                  {ticketsAbout.map((tk) => (
                    <Link
                      key={tk.id}
                      href={`/dashboard/support/tickets/${tk.id}`}
                      className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 transition-colors hover:bg-muted/40"
                    >
                      <span className="truncate text-xs">{tk.subject}</span>
                      <Badge
                        variant="outline"
                        className={cn("h-5 shrink-0 text-[10px]", tk.breachedAt && "border-rose-300 text-rose-700")}
                      >
                        {tk.status}
                      </Badge>
                    </Link>
                  ))}
                </div>
              )}

              {/* Customer */}
              {customer && (
                <div className="flex items-center gap-2 border-t pt-3">
                  <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-xs">{customer}</p>
                    {order.contactEmail && (
                      <p className="truncate text-[10px] text-muted-foreground">{order.contactEmail}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Company */}
              {order.companyName && order.contactId && (
                <div className="flex items-center gap-2">
                  <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <p className="truncate text-muted-foreground text-xs">{order.companyName}</p>
                </div>
              )}

              {/* Owner */}
              {order.ownerName && (
                <div className="flex items-center gap-2 border-t pt-3">
                  <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="text-[10px] text-muted-foreground">{t("owner")}</p>
                    <p className="font-medium text-xs">{order.ownerName}</p>
                  </div>
                </div>
              )}

              {/* What has to be known to prepare it: pickup or delivery, when, where.
                  Written by whoever took the order — an assistant, or a person. */}
              {order.notes && (
                <div className="border-t pt-3">
                  <p className="mb-1 text-muted-foreground text-xs">{t("notes")}</p>
                  <p className="whitespace-pre-line text-xs">{order.notes}</p>
                </div>
              )}

              {/* Dates */}
              <div className="space-y-1.5 border-t pt-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {t("orderDate")}
                  </span>
                  <span className="tabular-nums">{formatDateTime(order.orderDate)}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <CheckCircle2 className="h-3 w-3" />
                    {t("created")}
                  </span>
                  <span className="tabular-nums">{formatDateTime(order.createdAt)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
