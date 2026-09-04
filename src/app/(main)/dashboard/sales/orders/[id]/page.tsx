"use client";

import React, { useEffect, useState, useTransition } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  DollarSign,
  Loader2,
  Package,
  Plus,
  ShoppingCart,
  Trash2,
  User,
} from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCurrency } from "@/hooks/use-currency";
import { advanceLabel, isTerminalStatus, nextStatus } from "@/lib/order-status";
import { cn } from "@/lib/utils";

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

const STATUS_CONFIG: Record<string, { label: string; class: string }> = {
  draft: { label: "Draft", class: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  processing: { label: "Processing", class: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  completed: {
    label: "Completed",
    class: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
  cancelled: { label: "Cancelled", class: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
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
        <Plus className="h-3.5 w-3.5" /> Add Item
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
            <DialogTitle>Add Line Item</DialogTitle>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <div className="space-y-3 px-5 py-4">
              <div className="space-y-1.5">
                <Label>Product</Label>
                <Select value={form.watch("productId")} onValueChange={handleProductChange}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select product…" />
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
                  <Label>Qty</Label>
                  <Input type="number" min="1" {...form.register("quantity")} className="h-9" />
                </div>
                <div className="space-y-1.5">
                  <Label>Unit Price</Label>
                  <Input type="number" step="0.01" min="0" {...form.register("unitPrice")} className="h-9 font-mono" />
                </div>
              </div>
            </div>
            <DialogFooter className="border-t bg-muted/10 px-5 py-4">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving} className="gap-2">
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Add
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
  // The pending flag was discarded. The two status buttons need it: without it a
  // slow save invites a second click, and a second click on "Close order" is a
  // second write of the same thing.
  const [isPending, startTransition] = useTransition();
  const { formatAmount } = useCurrency();

  const [order, setOrder] = useState<OrderDetail>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getOrderById(id), getProducts()]).then(([o, p]) => {
      setOrder(o);
      setProducts(p);
      setLoading(false);
    });
  }, [id]);

  const handleStatusChange = (status: OrderStatus) => {
    startTransition(async () => {
      await updateOrderStatus(id, status);
      setOrder((prev) => (prev ? { ...prev, status } : prev));
      toast.success("Status updated.");
    });
  };

  const handleAddItem = async (item: { productId: string; quantity: number; unitPrice: number }) => {
    await addOrderItem(id, item);
    const updated = await getOrderById(id);
    setOrder(updated);
    toast.success("Item added.");
  };

  const handleRemoveItem = (itemId: string) => {
    if (!confirm("Remove this item?")) return;
    startTransition(async () => {
      await removeOrderItem(itemId, id);
      const updated = await getOrderById(id);
      setOrder(updated);
      toast.success("Item removed.");
    });
  };

  const handleDelete = () => {
    if (!confirm("Delete this order? This cannot be undone.")) return;
    startTransition(async () => {
      await deleteOrder(id);
      toast.success("Order deleted.");
      router.push("/dashboard/sales/orders");
    });
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-5 w-28 rounded bg-muted" />
        <div className="h-10 w-64 rounded bg-muted" />
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2 h-64 rounded-xl bg-muted" />
          <div className="h-64 rounded-xl bg-muted" />
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="py-20 text-center">
        <ShoppingCart className="mx-auto mb-4 h-12 w-12 text-muted-foreground/30" />
        <p className="mb-4 text-muted-foreground">Order not found</p>
        <Button asChild>
          <Link href="/dashboard/sales/orders">Back to Orders</Link>
        </Button>
      </div>
    );
  }

  const statusCfg = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.draft;
  const customer = order.contactFirstName
    ? `${order.contactFirstName} ${order.contactLastName ?? ""}`.trim()
    : (order.companyName ?? null);

  return (
    <div className="space-y-5 p-6">
      {/* Back nav */}
      <Link
        href="/dashboard/sales/orders"
        className="inline-flex items-center gap-1.5 font-medium text-muted-foreground text-sm transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> All Orders
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="font-mono font-semibold text-muted-foreground text-xs">{order.orderNumber}</span>
          <h1 className="mt-0.5 font-bold text-2xl tracking-tight">{customer ?? "Order Details"}</h1>
          <div className="mt-2 flex items-center gap-2">
            <Badge variant="outline" className={cn("text-xs", statusCfg.class)}>
              {statusCfg.label}
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
            <Trash2 className="h-3.5 w-3.5" /> Delete
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
                Line Items
              </CardTitle>
              <AddItemDialog products={products} onAdded={handleAddItem} />
            </CardHeader>
            <CardContent className="p-0">
              {order.items.length === 0 ? (
                <div className="py-10 text-center">
                  <Package className="mx-auto mb-2 h-8 w-8 text-muted-foreground/30" />
                  <p className="text-muted-foreground text-sm">No items yet.</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30 text-muted-foreground text-xs">
                      <th className="px-4 py-2.5 text-left font-medium">Product</th>
                      <th className="px-4 py-2.5 text-right font-medium">Qty</th>
                      <th className="px-4 py-2.5 text-right font-medium">Unit Price</th>
                      <th className="px-4 py-2.5 text-right font-medium">Total</th>
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
                        Total
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
              <CardTitle className="text-sm">Order Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {/* Status */}
              <div>
                <p className="mb-1.5 text-muted-foreground text-xs">Status</p>
                <Select value={order.status} onValueChange={handleStatusChange}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(STATUS_CONFIG).map(([v, cfg]) => (
                      <SelectItem key={v} value={v} className="text-xs">
                        {cfg.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/*
                  The two moves anyone actually makes, as buttons rather than as a
                  menu the user has to remember the shape of.

                  Each names where the order ends up, not what the button does, so
                  it is a sentence you can disagree with before clicking. The
                  shortcut appears only while it would skip a step: from
                  "processing" the two would do the same thing, and two buttons
                  with one effect is exactly the confusion this is meant to remove.
                */}
                {!isTerminalStatus(order.status) && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {advanceLabel(order.status) && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 flex-1 text-xs"
                        disabled={isPending}
                        onClick={() => {
                          const next = nextStatus(order.status);
                          if (next) handleStatusChange(next);
                        }}
                      >
                        <ArrowRight className="mr-1.5 h-3.5 w-3.5" />
                        {advanceLabel(order.status)}
                      </Button>
                    )}

                    {nextStatus(order.status) !== "completed" && (
                      <Button
                        size="sm"
                        className="h-8 flex-1 bg-emerald-600 text-xs hover:bg-emerald-700"
                        disabled={isPending}
                        onClick={() => handleStatusChange("completed")}
                      >
                        <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                        Close order
                      </Button>
                    )}
                  </div>
                )}

                {isTerminalStatus(order.status) && (
                  <p className="mt-2 text-muted-foreground text-xs">
                    {order.status === "completed"
                      ? "This order is closed. Change the status above to reopen it."
                      : "This order was cancelled."}
                  </p>
                )}
              </div>

              {/* Amount */}
              <div className="flex items-center justify-between border-t pt-3">
                <span className="flex items-center gap-1 text-muted-foreground text-xs">
                  <DollarSign className="h-3 w-3" /> Total Amount
                </span>
                <span className="font-bold tabular-nums">{formatAmount(Number(order.totalAmount))}</span>
              </div>

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
                    <p className="text-[10px] text-muted-foreground">Owner</p>
                    <p className="font-medium text-xs">{order.ownerName}</p>
                  </div>
                </div>
              )}

              {/* What has to be known to prepare it: pickup or delivery, when, where.
                  Written by whoever took the order — an assistant, or a person. */}
              {order.notes && (
                <div className="border-t pt-3">
                  <p className="mb-1 text-muted-foreground text-xs">Notes</p>
                  <p className="whitespace-pre-line text-xs">{order.notes}</p>
                </div>
              )}

              {/* Dates */}
              <div className="space-y-1.5 border-t pt-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    Order date
                  </span>
                  <span className="tabular-nums">{formatDateTime(order.orderDate)}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <CheckCircle2 className="h-3 w-3" />
                    Created
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
