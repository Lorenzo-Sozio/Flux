"use client";

import { useEffect, useMemo, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { ChevronLeft, Loader2, Package, Plus, ShoppingCart, StickyNote, Trash2 } from "lucide-react";
import { useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";

import { createOrder, getOrderFormData } from "@/actions/orders";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useCurrency } from "@/hooks/use-currency";
import { ORDER_FLOW } from "@/lib/order-status";
import { cn } from "@/lib/utils";

type FormData = Awaited<ReturnType<typeof getOrderFormData>>;

/** Marks a line as written by hand rather than picked from the catalogue. */
const CUSTOM = "_custom";

/**
 * One column template, shared by the header strip and every line, so the two
 * cannot drift apart. Below `xl` there is not enough room for nine columns, so a
 * line folds: four fields to the row on a laptop, two on a phone, each under its
 * own label.
 */
const LINE_GRID =
  "grid grid-cols-2 gap-x-3 gap-y-3 lg:grid-cols-4 xl:grid-cols-[28px_minmax(0,1.6fr)_minmax(0,2fr)_76px_116px_84px_84px_minmax(92px,auto)_64px] xl:items-center xl:gap-x-2 xl:gap-y-0";

interface LineValues {
  productId: string;
  description: string;
  notes: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  taxPercent: number;
}

interface OrderFormValues {
  companyId: string;
  contactId: string;
  dealId: string;
  quoteId: string;
  status: "draft" | "processing" | "completed" | "cancelled";
  orderDate: string;
  discountPercent: number;
  notes: string;
  items: LineValues[];
}

const emptyLine = (): LineValues => ({
  productId: "",
  description: "",
  notes: "",
  quantity: 1,
  unitPrice: 0,
  discountPercent: 0,
  taxPercent: 0,
});

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  processing: "Processing",
  completed: "Completed",
  cancelled: "Cancelled",
};

/**
 * Writing an order by hand.
 *
 * This was a 560-pixel dialog with four fields: status, date, and a row of
 * product-quantity-price. It could not say who the order was for, could not carry
 * a line that is not in the catalogue, and had nowhere to write down what the
 * customer actually asked for — so the commonest real order could not be entered
 * at all, and the ones that could belonged to nobody.
 *
 * It is a page now, and the page is a stack of bands rather than a
 * short sidebar beside a long list — that arrangement left a hole in the middle of
 * the screen as soon as the list grew. Reading down: who and when, then what is
 * being sold, then what is worth knowing about it and what it comes to. The lines
 * are a table on a wide screen, one band of the eye per line, because that is the
 * part that needs the width. The bar at the top does not scroll away, so the total
 * and the way out are always to hand.
 */
export default function NewOrderPage() {
  const router = useRouter();
  const { formatAmount } = useCurrency();

  const [data, setData] = useState<FormData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  /** Which lines have their note open. A note with something in it is never hidden. */
  const [openNotes, setOpenNotes] = useState<Record<string, boolean>>({});

  const form = useForm<OrderFormValues>({
    defaultValues: {
      companyId: "",
      contactId: "",
      dealId: "",
      quoteId: "",
      status: "draft",
      orderDate: new Date().toISOString().slice(0, 10),
      discountPercent: 0,
      notes: "",
      items: [emptyLine()],
    },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "items" });

  useEffect(() => {
    getOrderFormData()
      .then(setData)
      .catch(() => toast.error("Could not load customers and products."))
      .finally(() => setLoading(false));
  }, []);

  const items = form.watch("items");
  const companyId = form.watch("companyId");
  const headerDiscount = Number(form.watch("discountPercent")) || 0;

  /** Contacts belonging to the chosen company, or all of them when none is chosen. */
  const contactOptions = useMemo(() => {
    const all = data?.contacts ?? [];
    const scoped = companyId ? all.filter((c) => c.companyId === companyId) : all;
    return scoped.map((c) => ({
      value: c.id,
      label: [c.firstName, c.lastName].filter(Boolean).join(" ") || (c.email ?? c.id),
    }));
  }, [data, companyId]);

  const totals = useMemo(() => {
    let net = 0;
    let tax = 0;
    for (const line of items ?? []) {
      const qty = Number(line.quantity) || 0;
      const price = Number(line.unitPrice) || 0;
      const lineNet = qty * price * (1 - (Number(line.discountPercent) || 0) / 100);
      net += lineNet;
      tax += lineNet * ((Number(line.taxPercent) || 0) / 100);
    }
    const discountAmount = net * (headerDiscount / 100);
    const afterDiscount = net - discountAmount;
    // The header discount reduces the taxable base, so the tax follows it down.
    const taxAfterDiscount = net > 0 ? tax * (afterDiscount / net) : 0;
    return {
      net,
      discountAmount,
      tax: taxAfterDiscount,
      total: afterDiscount + taxAfterDiscount,
    };
  }, [items, headerDiscount]);

  /** Picking a product fills in the line; picking "custom" clears it for typing. */
  function selectProduct(index: number, value: string) {
    if (value === CUSTOM) {
      form.setValue(`items.${index}.productId`, "");
      return;
    }
    const product = data?.products.find((p) => p.id === value);
    if (!product) return;
    form.setValue(`items.${index}.productId`, product.id);
    form.setValue(`items.${index}.unitPrice`, Number(product.price ?? 0));
    form.setValue(`items.${index}.taxPercent`, Number(product.taxPercent ?? 0));
    if (!form.getValues(`items.${index}.description`)) {
      form.setValue(`items.${index}.description`, product.name);
    }
  }

  /** Choosing a quote carries its customer across, so nothing is retyped. */
  function selectQuote(quoteId: string) {
    form.setValue("quoteId", quoteId);
    const quote = data?.quotes.find((q) => q.id === quoteId);
    if (!quote) return;
    if (quote.companyId) form.setValue("companyId", quote.companyId);
    if (quote.contactId) form.setValue("contactId", quote.contactId);
  }

  function selectDeal(dealId: string) {
    form.setValue("dealId", dealId);
    const deal = data?.deals.find((d) => d.id === dealId);
    if (!deal) return;
    if (deal.companyId) form.setValue("companyId", deal.companyId);
    if (deal.contactId) form.setValue("contactId", deal.contactId);
  }

  async function onSubmit(values: OrderFormValues) {
    const usable = values.items.filter((l) => l.productId || l.description.trim());
    if (usable.length === 0) {
      toast.error("Add at least one line: pick a product or describe what it is for.");
      return;
    }

    setSubmitting(true);
    try {
      const created = await createOrder({
        companyId: values.companyId || undefined,
        contactId: values.contactId || undefined,
        dealId: values.dealId || undefined,
        quoteId: values.quoteId || undefined,
        status: values.status,
        orderDate: values.orderDate || undefined,
        discountPercent: values.discountPercent,
        notes: values.notes || undefined,
        items: usable.map((l) => ({
          productId: l.productId || undefined,
          description: l.description || undefined,
          notes: l.notes || undefined,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discountPercent: l.discountPercent,
          taxPercent: l.taxPercent,
        })),
      });
      toast.success(`Order ${created.orderNumber} created.`);
      router.push(`/dashboard/sales/orders/${created.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the order.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-6 p-6">
      {/* ── The bar that stays put: what this is, what it comes to, the way out ── */}
      <div className="-mx-6 -mt-6 sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b bg-background/85 px-6 py-3 backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 text-muted-foreground"
            aria-label="Back to orders"
          >
            <Link href="/dashboard/sales/orders">
              <ChevronLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <ShoppingCart className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate font-bold text-lg tracking-tight">New order</h1>
            <p className="hidden truncate text-muted-foreground text-xs sm:block">
              Everything the person preparing it needs to read.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* The number the writer keeps glancing at, without scrolling back for it. */}
          <div className="mr-2 hidden items-baseline gap-2 sm:flex">
            <span className="text-muted-foreground text-xs uppercase tracking-wide">Total</span>
            <span className="font-bold text-base tabular-nums">{formatAmount(totals.total)}</span>
          </div>
          <Button type="button" variant="ghost" onClick={() => router.push("/dashboard/sales/orders")}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting || loading} className="gap-2">
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Create order
          </Button>
        </div>
      </div>

      {/* ── Band one: who it is for, and what kind of order it is ─────────── */}
      <div className="grid gap-6 md:grid-cols-12">
        <Card className="md:col-span-5">
          <CardHeader>
            <CardTitle className="font-semibold text-muted-foreground text-sm uppercase tracking-wide">
              Customer
            </CardTitle>
            <CardDescription>Who the order is for.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Company</Label>
              <SearchableSelect
                disabled={loading}
                options={(data?.companies ?? []).map((c) => ({ value: c.id, label: c.name }))}
                value={form.watch("companyId")}
                onChange={(v) => {
                  form.setValue("companyId", v);
                  // A contact from the previous company is worse than none.
                  form.setValue("contactId", "");
                }}
                placeholder={loading ? "Loading…" : "Search company…"}
                searchPlaceholder="Type to search…"
                emptyText="No companies found."
                className="h-9"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Contact</Label>
              <SearchableSelect
                disabled={loading}
                options={contactOptions}
                value={form.watch("contactId")}
                onChange={(v) => form.setValue("contactId", v)}
                placeholder="Search contact…"
                searchPlaceholder="Type to search…"
                emptyText={companyId ? "No contacts at this company." : "No contacts found."}
                className="h-9"
              />
            </div>
          </CardContent>
        </Card>

        {/* Four short answers, two by two, so this card ends level with the one beside it. */}
        <Card className="md:col-span-7">
          <CardHeader>
            <CardTitle className="font-semibold text-muted-foreground text-sm uppercase tracking-wide">
              Order details
            </CardTitle>
            <CardDescription>Its state, its date, and, optionally, where it came from.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Status</Label>
                <Select
                  value={form.watch("status")}
                  onValueChange={(v) => form.setValue("status", v as OrderFormValues["status"])}
                >
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[...ORDER_FLOW, "cancelled"].map((v) => (
                      <SelectItem key={v} value={v}>
                        {STATUS_LABEL[v]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Order date</Label>
                <Input type="date" className="h-9" {...form.register("orderDate")} />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Accepted quote</Label>
                <SearchableSelect
                  disabled={loading}
                  options={(data?.quotes ?? []).map((q) => ({ value: q.id, label: q.quoteNumber }))}
                  value={form.watch("quoteId")}
                  onChange={selectQuote}
                  placeholder="None"
                  searchPlaceholder="Type to search…"
                  emptyText="No accepted quotes."
                  className="h-9"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Deal</Label>
                <SearchableSelect
                  disabled={loading}
                  options={(data?.deals ?? []).map((d) => ({ value: d.id, label: d.name }))}
                  value={form.watch("dealId")}
                  onChange={selectDeal}
                  placeholder="None"
                  searchPlaceholder="Type to search…"
                  emptyText="No open deals."
                  className="h-9"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Band two: what is being sold, given the whole width ───────────── */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="font-semibold text-muted-foreground text-sm uppercase tracking-wide">Lines</CardTitle>
            <CardDescription>A catalogue product, or anything else written out by hand.</CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => append(emptyLine())}>
            <Plus className="h-3.5 w-3.5" /> Add line
          </Button>
        </CardHeader>

        <CardContent>
          {/* Column names once, at the top, instead of on every field of every line. */}
          <div
            className={cn(
              LINE_GRID,
              "hidden border-b pb-2 font-medium text-[11px] text-muted-foreground uppercase tracking-wide xl:grid",
            )}
          >
            <span />
            <span>Product</span>
            <span>Description</span>
            <span>Qty</span>
            <span>Unit price</span>
            <span>Disc %</span>
            <span>Tax %</span>
            <span className="text-right">Total</span>
            <span />
          </div>

          <div className="space-y-3 xl:space-y-0">
            {fields.map((field, index) => {
              const line = items?.[index];
              const isCustom = !line?.productId;
              const lineTotal =
                (Number(line?.quantity) || 0) *
                (Number(line?.unitPrice) || 0) *
                (1 - (Number(line?.discountPercent) || 0) / 100);
              const noteOpen = openNotes[field.id] || Boolean(line?.notes);

              const noteButton = (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn("h-7 w-7 text-muted-foreground hover:text-foreground", noteOpen && "text-primary")}
                  onClick={() => setOpenNotes((prev) => ({ ...prev, [field.id]: !prev[field.id] }))}
                  aria-label="Note on this line"
                  aria-pressed={noteOpen}
                >
                  <StickyNote className="h-3.5 w-3.5" />
                </Button>
              );

              const removeButton = (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => remove(index)}
                  disabled={fields.length === 1}
                  aria-label="Remove line"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              );

              return (
                <div
                  key={field.id}
                  className="rounded-lg border bg-muted/20 p-3 xl:rounded-none xl:border-0 xl:border-b xl:bg-transparent xl:px-0 xl:py-2 xl:hover:bg-muted/20 xl:last:border-b-0"
                >
                  {/* Narrow screens get the line's own header; wide ones read it off the row. */}
                  <div className="mb-3 flex items-center justify-between gap-2 xl:hidden">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-muted-foreground text-xs">Line {index + 1}</span>
                      {isCustom && (
                        <Badge
                          variant="outline"
                          className="h-5 border-amber-300 text-[10px] text-amber-700 dark:border-amber-800 dark:text-amber-400"
                        >
                          Off catalogue
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="mr-1 font-semibold text-sm tabular-nums">{formatAmount(lineTotal)}</span>
                      {noteButton}
                      {removeButton}
                    </div>
                  </div>

                  <div className={LINE_GRID}>
                    <span className="hidden text-muted-foreground text-xs tabular-nums xl:block">{index + 1}</span>

                    <div className="col-span-2 space-y-1.5 xl:col-span-1 xl:space-y-0">
                      <Label className="text-xs xl:hidden">Product</Label>
                      <SearchableSelect
                        disabled={loading}
                        options={[
                          { value: CUSTOM, label: "Off catalogue" },
                          ...(data?.products ?? []).map((p) => ({
                            value: p.id,
                            label: p.sku ? `${p.name} · ${p.sku}` : p.name,
                          })),
                        ]}
                        value={line?.productId || CUSTOM}
                        onChange={(v) => selectProduct(index, v)}
                        placeholder="Off catalogue"
                        searchPlaceholder="Type to search products…"
                        emptyText="No products found."
                        className="h-9"
                      />
                    </div>

                    <div className="col-span-2 space-y-1.5 xl:col-span-1 xl:space-y-0">
                      <Label className="text-xs xl:hidden">
                        Description {isCustom && <span className="text-destructive">*</span>}
                      </Label>
                      <Input
                        className="h-9"
                        placeholder={isCustom ? "What is being sold" : "Defaults to the product name"}
                        {...form.register(`items.${index}.description`)}
                      />
                    </div>

                    <div className="space-y-1.5 xl:space-y-0">
                      <Label className="text-xs xl:hidden">Qty</Label>
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        className="h-9 tabular-nums"
                        {...form.register(`items.${index}.quantity`, { valueAsNumber: true })}
                      />
                    </div>

                    <div className="space-y-1.5 xl:space-y-0">
                      <Label className="text-xs xl:hidden">Unit price</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        className="h-9 tabular-nums"
                        {...form.register(`items.${index}.unitPrice`, { valueAsNumber: true })}
                      />
                    </div>

                    <div className="space-y-1.5 xl:space-y-0">
                      <Label className="text-xs xl:hidden">Discount %</Label>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        className="h-9 tabular-nums"
                        {...form.register(`items.${index}.discountPercent`, { valueAsNumber: true })}
                      />
                    </div>

                    <div className="space-y-1.5 xl:space-y-0">
                      <Label className="text-xs xl:hidden">Tax %</Label>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        className="h-9 tabular-nums"
                        {...form.register(`items.${index}.taxPercent`, { valueAsNumber: true })}
                      />
                    </div>

                    <span className="hidden text-right font-semibold text-sm tabular-nums xl:block">
                      {formatAmount(lineTotal)}
                    </span>

                    <div className="hidden items-center justify-end gap-0.5 xl:flex">
                      {noteButton}
                      {removeButton}
                    </div>
                  </div>

                  {noteOpen && (
                    <div className="mt-2 xl:pb-1 xl:pl-9">
                      <Input
                        className="h-8 bg-background text-xs"
                        placeholder="Note on this line — “no onions”, “engraved”, “collect Friday”"
                        {...form.register(`items.${index}.notes`)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {fields.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
              <Package className="h-8 w-8 opacity-30" />
              <p className="text-sm">No lines yet.</p>
            </div>
          )}

          {/* A second way to add one, at the end, where the hand already is. */}
          <Button
            type="button"
            variant="ghost"
            className="mt-3 h-10 w-full gap-1.5 border border-dashed text-muted-foreground hover:text-foreground"
            onClick={() => append(emptyLine())}
          >
            <Plus className="h-4 w-4" /> Add another line
          </Button>
        </CardContent>
      </Card>

      {/* ── Band three: what to know about it, and what it comes to ───────── */}
      <div className="grid gap-6 lg:grid-cols-12">
        <Card className="lg:col-span-7 xl:col-span-8">
          <CardHeader>
            <CardTitle className="font-semibold text-muted-foreground text-sm uppercase tracking-wide">Notes</CardTitle>
            <CardDescription>
              Delivery or collection, for when, to what address — anything the person preparing this has to read.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1">
            <Textarea
              className="h-full min-h-[168px] resize-y leading-relaxed"
              placeholder="Write it as you would say it to whoever picks the order up."
              {...form.register("notes")}
            />
          </CardContent>
        </Card>

        {/* The money, where the eye ends. */}
        <Card className="lg:col-span-5 xl:col-span-4">
          <CardHeader>
            <CardTitle className="font-semibold text-muted-foreground text-sm uppercase tracking-wide">
              Summary
            </CardTitle>
            <CardDescription>What this order comes to.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Net</span>
              <span className="tabular-nums">{formatAmount(totals.net)}</span>
            </div>

            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="header-discount" className="font-normal text-muted-foreground text-sm">
                Discount on the whole order
              </Label>
              <div className="flex items-center gap-1">
                <Input
                  id="header-discount"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  className="h-8 w-20 text-right tabular-nums"
                  {...form.register("discountPercent", { valueAsNumber: true })}
                />
                <span className="text-muted-foreground text-xs">%</span>
              </div>
            </div>

            {totals.discountAmount > 0 && (
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Discount</span>
                <span className="tabular-nums">−{formatAmount(totals.discountAmount)}</span>
              </div>
            )}

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Tax</span>
              <span className="tabular-nums">{formatAmount(totals.tax)}</span>
            </div>

            <Separator className="my-1" />

            <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2.5">
              <span className="font-semibold">Total</span>
              <span className="font-bold text-lg tabular-nums">{formatAmount(totals.total)}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </form>
  );
}
