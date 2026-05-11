"use client";

import React, { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  ArrowLeft,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  DollarSign,
  Package,
  Plus,
  Trash2,
  User,
  ShoppingCart,
  Loader2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/hooks/use-currency";
import {
  getOrderById,
  addOrderItem,
  removeOrderItem,
  updateOrderStatus,
  deleteOrder,
  type OrderStatus,
} from "@/actions/orders";
import { getProducts } from "@/actions/products";

// ── Types ─────────────────────────────────────────────────────────────────────

type OrderDetail = Awaited<ReturnType<typeof getOrderById>>;
type Product = Awaited<ReturnType<typeof getProducts>>[number];

const STATUS_CONFIG: Record<string, { label: string; class: string }> = {
  draft:      { label: "Draft",      class: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  processing: { label: "Processing", class: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  completed:  { label: "Completed",  class: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  cancelled:  { label: "Cancelled",  class: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
};

// ── Add item dialog ───────────────────────────────────────────────────────────

const addItemSchema = z.object({
  productId: z.string().min(1, "Select a product"),
  quantity:  z.coerce.number().int().min(1),
  unitPrice: z.coerce.number().min(0),
});

function AddItemDialog({
  products,
  onAdded,
}: {
  products: Product[];
  onAdded: (item: { productId: string; quantity: number; unitPrice: number }) => void;
}) {
  const [open, setOpen]       = useState(false);
  const [saving, setSaving]   = useState(false);
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
      <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" /> Add Item
      </Button>
      <Dialog open={open} onOpenChange={(v) => { if (!saving) { setOpen(v); if (!v) form.reset(); } }}>
        <DialogContent className="sm:max-w-sm p-0 gap-0">
          <DialogHeader className="px-5 pt-5 pb-4 border-b">
            <DialogTitle>Add Line Item</DialogTitle>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <div className="px-5 py-4 space-y-3">
              <div className="space-y-1.5">
                <Label>Product</Label>
                <Select value={form.watch("productId")} onValueChange={handleProductChange}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select product…" />
                  </SelectTrigger>
                  <SelectContent>
                    {active.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}{p.sku ? ` — ${p.sku}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.formState.errors.productId && (
                  <p className="text-xs text-destructive">{form.formState.errors.productId.message}</p>
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
            <DialogFooter className="px-5 py-4 border-t bg-muted/10">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
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
  const router  = useRouter();
  const [, startTransition] = useTransition();
  const { formatAmount } = useCurrency();

  const [order,    setOrder]    = useState<OrderDetail>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading,  setLoading]  = useState(true);

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
      setOrder((prev) => prev ? { ...prev, status } : prev);
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
      router.push("/dashboard/orders");
    });
  };

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-5 w-28 bg-muted rounded" />
        <div className="h-10 w-64 bg-muted rounded" />
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2 h-64 bg-muted rounded-xl" />
          <div className="h-64 bg-muted rounded-xl" />
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="text-center py-20">
        <ShoppingCart className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
        <p className="text-muted-foreground mb-4">Order not found</p>
        <Button asChild><Link href="/dashboard/orders">Back to Orders</Link></Button>
      </div>
    );
  }

  const statusCfg = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.draft;
  const customer  = order.contactFirstName
    ? `${order.contactFirstName} ${order.contactLastName ?? ""}`.trim()
    : order.companyName ?? null;

  return (
    <div className="p-6 space-y-5">
      {/* Back nav */}
      <Link href="/dashboard/orders" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" /> All Orders
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="font-mono text-xs font-semibold text-muted-foreground">{order.orderNumber}</span>
          <h1 className="text-2xl font-bold tracking-tight mt-0.5">
            {customer ?? "Order Details"}
          </h1>
          <div className="flex items-center gap-2 mt-2">
            <Badge variant="outline" className={cn("text-xs", statusCfg.class)}>
              {statusCfg.label}
            </Badge>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {new Date(order.orderDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" className="text-destructive hover:text-destructive gap-1.5" onClick={handleDelete}>
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        </div>
      </div>

      {/* Content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left — line items */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="pb-3 border-b flex flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Package className="h-4 w-4 text-muted-foreground" />
                Line Items
              </CardTitle>
              <AddItemDialog products={products} onAdded={handleAddItem} />
            </CardHeader>
            <CardContent className="p-0">
              {order.items.length === 0 ? (
                <div className="py-10 text-center">
                  <Package className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No items yet.</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                      <th className="px-4 py-2.5 text-left font-medium">Product</th>
                      <th className="px-4 py-2.5 text-right font-medium">Qty</th>
                      <th className="px-4 py-2.5 text-right font-medium">Unit Price</th>
                      <th className="px-4 py-2.5 text-right font-medium">Total</th>
                      <th className="w-10 px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {order.items.map((item) => (
                      <tr key={item.id} className="hover:bg-muted/20 group">
                        <td className="px-4 py-3">
                          <p className="font-medium">{item.productName ?? "Unknown"}</p>
                          {item.productSku && (
                            <span className="font-mono text-[10px] text-muted-foreground">{item.productSku}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{item.quantity}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{formatAmount(Number(item.unitPrice))}</td>
                        <td className="px-4 py-3 text-right tabular-nums font-semibold">{formatAmount(Number(item.totalPrice))}</td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(item.id)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/50 hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t bg-muted/20">
                      <td colSpan={3} className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">Total</td>
                      <td className="px-4 py-3 text-right text-base font-bold tabular-nums">
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
                <p className="text-xs text-muted-foreground mb-1.5">Status</p>
                <Select value={order.status} onValueChange={handleStatusChange}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(STATUS_CONFIG).map(([v, cfg]) => (
                      <SelectItem key={v} value={v} className="text-xs">{cfg.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Amount */}
              <div className="flex items-center justify-between border-t pt-3">
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <DollarSign className="h-3 w-3" /> Total Amount
                </span>
                <span className="font-bold tabular-nums">{formatAmount(Number(order.totalAmount))}</span>
              </div>

              {/* Customer */}
              {customer && (
                <div className="flex items-center gap-2 border-t pt-3">
                  <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{customer}</p>
                    {order.contactEmail && (
                      <p className="text-[10px] text-muted-foreground truncate">{order.contactEmail}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Company */}
              {order.companyName && order.contactId && (
                <div className="flex items-center gap-2">
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <p className="text-xs text-muted-foreground truncate">{order.companyName}</p>
                </div>
              )}

              {/* Owner */}
              {order.ownerName && (
                <div className="flex items-center gap-2 border-t pt-3">
                  <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-[10px] text-muted-foreground">Owner</p>
                    <p className="text-xs font-medium">{order.ownerName}</p>
                  </div>
                </div>
              )}

              {/* Dates */}
              <div className="border-t pt-3 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" />Order date</span>
                  <span>{new Date(order.orderDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />Created</span>
                  <span>{new Date(order.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
