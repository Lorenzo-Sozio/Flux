"use client";

import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Package, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { addOrderItem, type getOrderById, removeOrderItem } from "@/actions/orders";
import type { getProductsForSelect } from "@/actions/products";
import { PriceListNote, PriceSourceBadge } from "@/components/crm/price-list-note";
import { EmptyHint } from "@/components/crm/record/record-page";
import { listPriceSource, usePriceRules } from "@/components/crm/use-price-rules";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCurrency } from "@/hooks/use-currency";
import { priceFor } from "@/lib/price-list";

type OrderItem = NonNullable<Awaited<ReturnType<typeof getOrderById>>>["items"][number];
type Product = Awaited<ReturnType<typeof getProductsForSelect>>[number];

// ── Add item dialog ───────────────────────────────────────────────────────────

const addItemSchema = z.object({
  productId: z.string().min(1, "Select a product"),
  quantity: z.coerce.number().int().min(1),
  unitPrice: z.coerce.number().min(0),
});

function AddItemDialog({
  products,
  companyId,
  onAdded,
}: {
  products: Product[];
  /** Whose order this is: the customer decides which price list prices the line. */
  companyId: string | null;
  onAdded: (item: { productId: string; quantity: number; unitPrice: number }) => Promise<void>;
}) {
  const t = useTranslations("orders.detail");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const active = products.filter((p) => p.isActive);
  // The customer's list, read once and kept: this dialog is opened again for
  // every line an order gains.
  const { rules: priceRules } = usePriceRules(companyId);

  const form = useForm<z.infer<typeof addItemSchema>>({
    resolver: zodResolver(addItemSchema),
    defaultValues: { productId: "", quantity: 1, unitPrice: 0 },
  });

  const handleProductChange = (id: string) => {
    const p = active.find((x) => x.id === id);
    form.setValue("productId", id);
    // ⚠️ A proposal only. The field stays editable, and what the reader types
    // over it is what is added to the order.
    if (p) form.setValue("unitPrice", priceFor(p.id, p.price, priceRules));
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
      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" aria-hidden /> {t("addItem")}
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
          <DialogHeader className="border-b px-4 pt-5 pb-4 md:px-5">
            <DialogTitle>{t("addLineItem")}</DialogTitle>
            <PriceListNote rules={priceRules} className="pt-1" />
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
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>{t("qty")}</Label>
                  <Input type="number" min="1" {...form.register("quantity")} className="h-9" />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("unitPrice")}</Label>
                  <Input type="number" step="0.01" min="0" {...form.register("unitPrice")} className="h-9 font-mono" />
                  <PriceSourceBadge
                    source={listPriceSource(
                      priceRules,
                      active.find((p) => p.id === form.watch("productId")),
                      form.watch("unitPrice"),
                    )}
                    listName={priceRules?.name}
                  />
                </div>
              </div>
            </div>
            <DialogFooter className="border-t bg-muted/10 px-4 py-4 md:px-5">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
                {tc("cancel")}
              </Button>
              <Button type="submit" disabled={saving} className="gap-2">
                {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                {tc("add")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Lines card ────────────────────────────────────────────────────────────────

/**
 * What was ordered, and the only place its lines are changed.
 *
 * ⚠️ The figures arrive from the page and are never kept here. Adding or removing a
 * line recomputes the order's total on the server (tax, discount), and the hero
 * shows that total too; refreshing the route redraws both from one read instead of
 * patching a local copy that the header does not see.
 */
export function OrderLines({
  orderId,
  items,
  currency,
  totalAmount,
  companyId,
  products,
  canWrite,
}: {
  orderId: string;
  items: OrderItem[];
  /** The order's own currency: every figure on it is in this one. */
  currency: string;
  totalAmount: string | number;
  companyId: string | null;
  products: Product[];
  canWrite: boolean;
}) {
  const t = useTranslations("orders.detail");
  const router = useRouter();
  const { formatMoney } = useCurrency();
  const [pending, startTransition] = useTransition();

  const handleAddItem = async (item: { productId: string; quantity: number; unitPrice: number }) => {
    await addOrderItem(orderId, item);
    toast.success(t("itemAdded"));
    router.refresh();
  };

  const handleRemoveItem = (itemId: string) => {
    if (!confirm(t("confirmRemoveItem"))) return;
    startTransition(async () => {
      await removeOrderItem(itemId, orderId);
      toast.success(t("itemRemoved"));
      router.refresh();
    });
  };

  const nameOf = (item: OrderItem) => item.productName ?? item.description ?? "—";

  const removeButton = (item: OrderItem, className: string) =>
    canWrite && (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={className}
        onClick={() => handleRemoveItem(item.id)}
        disabled={pending}
        aria-label={t("delete")}
        title={t("delete")}
      >
        <Trash2 className="size-3.5" aria-hidden />
      </Button>
    );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="flex min-w-0 items-center gap-2 text-base">
          <Package className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{t("lineItems")}</span>
        </CardTitle>
        {canWrite && <AddItemDialog products={products} companyId={companyId} onAdded={handleAddItem} />}
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <EmptyHint>{t("noItems")}</EmptyHint>
        ) : (
          <>
            {/* Below `md` each line is a card of its own: what it is on the left,
                quantity × price under it, the line total on the right. Five
                columns scrolled sideways put the name on one edge and the money
                on the other. */}
            <ul className="space-y-2 md:hidden">
              {items.map((item) => (
                <li key={item.id} className="flex items-start gap-3 rounded-lg border p-3">
                  <div className="min-w-0 flex-1">
                    <p className="break-words font-medium text-sm">{nameOf(item)}</p>
                    {item.productSku && (
                      <span className="font-mono text-[11px] text-muted-foreground">{item.productSku}</span>
                    )}
                    {item.itemNotes && (
                      <p className="mt-0.5 whitespace-pre-line text-muted-foreground text-xs">{item.itemNotes}</p>
                    )}
                    <p className="mt-1 text-muted-foreground text-xs tabular-nums">
                      {item.quantity} × {formatMoney(item.unitPrice, currency)}
                    </p>
                  </div>
                  <span className="shrink-0 pt-0.5 font-semibold text-sm tabular-nums">
                    {formatMoney(item.totalPrice, currency)}
                  </span>
                  {removeButton(item, "-my-1.5 -mr-1.5 size-10 shrink-0 text-muted-foreground hover:text-destructive")}
                </li>
              ))}
            </ul>

            <div className="-mx-6 hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y bg-muted/30 text-muted-foreground text-xs">
                    <th className="px-6 py-2.5 text-left font-medium">{t("product")}</th>
                    <th className="px-4 py-2.5 text-right font-medium">{t("qty")}</th>
                    <th className="px-4 py-2.5 text-right font-medium">{t("unitPriceCol")}</th>
                    <th className="px-4 py-2.5 text-right font-medium">{t("totalCol")}</th>
                    {canWrite && <th className="w-12 py-2.5 pr-4" />}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((item) => (
                    <tr key={item.id} className="hover:bg-muted/20">
                      <td className="px-6 py-3">
                        <p className="font-medium">{nameOf(item)}</p>
                        {item.productSku && (
                          <span className="font-mono text-[11px] text-muted-foreground">{item.productSku}</span>
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
                      <td className="px-4 py-3 text-right tabular-nums">{formatMoney(item.unitPrice, currency)}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">
                        {formatMoney(item.totalPrice, currency)}
                      </td>
                      {canWrite && (
                        <td className="py-2 pr-4 text-right">
                          {removeButton(item, "size-8 text-muted-foreground hover:text-destructive")}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2.5 md:mt-0 md:rounded-none md:border-t md:bg-transparent md:px-0 md:pt-3">
              <span className="font-medium text-muted-foreground text-sm">{t("totalCol")}</span>
              <span className="font-bold text-base tabular-nums">{formatMoney(totalAmount, currency)}</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
