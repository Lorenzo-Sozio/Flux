"use client";

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useFieldArray } from "react-hook-form";
import { z } from "zod";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import { Separator } from "@/components/ui/separator";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { updateQuoteAction, getQuoteById, getQuoteFormData } from "@/actions/quotes";
import { format } from "date-fns";
import { SearchableSelect } from "@/components/ui/searchable-select";

type Quote = Awaited<ReturnType<typeof getQuoteById>>;
type FormDataType = Awaited<ReturnType<typeof getQuoteFormData>>;

const EditQuoteSchema = z.object({
  dealId: z.string().min(1, "Deal is required"),
  companyId: z.string().min(1, "Company is required"),
  contactId: z.string().optional(),
  expiresAt: z.string().optional(),
  discountPercent: z.coerce.number().min(0).max(100).default(0),
  taxPercent: z.coerce.number().min(0).max(100).default(0),
  notes: z.string().optional(),
  items: z
    .array(
      z.object({
        productId: z.string().optional(),
        description: z.string().min(1, "Description is required"),
        quantity: z.coerce.number().int().positive("Must be positive"),
        unitPrice: z.coerce.number().min(0),
        discountPercent: z.coerce.number().min(0).max(100).default(0),
        taxPercent: z.coerce.number().min(0).max(100).default(0),
      })
    )
    .min(1, "At least one item is required"),
});

type FormValues = z.infer<typeof EditQuoteSchema>;

interface Props {
  quote: Quote;
  formData: FormDataType;
}

export function QuoteEditForm({ quote, formData }: Props) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(EditQuoteSchema),
    defaultValues: {
      dealId: quote.dealId ?? "",
      companyId: quote.companyId ?? "",
      contactId: quote.contactId ?? "",
      expiresAt: quote.expiresAt
        ? format(new Date(quote.expiresAt), "yyyy-MM-dd")
        : "",
      discountPercent: parseFloat(quote.discountPercent ?? "0"),
      taxPercent: parseFloat(quote.taxPercent ?? "0"),
      notes: quote.notes ?? "",
      items: quote.items.map((item) => ({
        productId: item.productId ?? "",
        description: item.description ?? "",
        quantity: item.quantity,
        unitPrice: parseFloat(item.unitPrice ?? "0"),
        discountPercent: parseFloat(item.discountPercent ?? "0"),
        taxPercent: parseFloat(item.taxPercent ?? "0"),
      })),
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "items",
  });

  function handleDealChange(dealId: string) {
    form.setValue("dealId", dealId);
    const deal = formData.deals.find((d) => d.id === dealId);
    if (deal?.companyId) form.setValue("companyId", deal.companyId);
  }

  function handleProductSelect(index: number, productId: string) {
    if (productId === "_custom") {
      form.setValue(`items.${index}.productId`, "");
      return;
    }
    const product = formData.products.find((p) => p.id === productId);
    if (product) {
      form.setValue(`items.${index}.productId`, product.id);
      form.setValue(`items.${index}.unitPrice`, parseFloat(product.price ?? "0") || 0);
      form.setValue(`items.${index}.taxPercent`, parseFloat(product.taxPercent ?? "0") || 0);
      if (!form.getValues(`items.${index}.description`)) {
        form.setValue(`items.${index}.description`, product.name);
      }
    }
  }

  const items = form.watch("items");
  const discountPct = form.watch("discountPercent") ?? 0;
  const taxPct = form.watch("taxPercent") ?? 0;

  const totals = useMemo(() => {
    const subtotal = (items ?? []).reduce((sum, item) => {
      const qty = Number(item.quantity) || 0;
      const price = Number(item.unitPrice) || 0;
      const disc = Number(item.discountPercent) || 0;
      const tax = Number(item.taxPercent) || 0;
      const afterDisc = qty * price * (1 - disc / 100);
      return sum + afterDisc * (1 + tax / 100);
    }, 0);
    const discountAmount = subtotal * (Number(discountPct) / 100);
    const afterDiscount = subtotal - discountAmount;
    const taxAmount = afterDiscount * (Number(taxPct) / 100);
    return { subtotal, discountAmount, taxAmount, total: afterDiscount + taxAmount };
  }, [items, discountPct, taxPct]);

  async function onSubmit(data: FormValues) {
    setIsSubmitting(true);
    try {
      await updateQuoteAction(quote.id, data);
      toast.success("Quote updated");
      router.push(`/dashboard/sales/quotes/${quote.id}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to update quote");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <div className="flex flex-col lg:flex-row gap-6 items-start">

          {/* Left column: Deal, Adjustments, Notes */}
          <div className="w-full lg:w-1/3 flex flex-col gap-6">

            {/* Deal + Customer */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Deal & Customer
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="dealId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Deal <span className="text-destructive">*</span></FormLabel>
                      <FormControl>
                        <SearchableSelect
                          options={formData.deals.map((d) => ({
                            value: d.id,
                            label: d.name,
                          }))}
                          value={field.value}
                          onChange={(val) => {
                            field.onChange(val);
                            handleDealChange(val);
                          }}
                          placeholder="Search deal…"
                          searchPlaceholder="Type to search deals…"
                          emptyText="No deals found."
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="companyId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Company <span className="text-destructive">*</span></FormLabel>
                      <FormControl>
                        <SearchableSelect
                          options={formData.companies.map((c) => ({
                            value: c.id,
                            label: c.name,
                          }))}
                          value={field.value}
                          onChange={field.onChange}
                          placeholder="Search company…"
                          searchPlaceholder="Type to search companies…"
                          emptyText="No companies found."
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Adjustments */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Adjustments
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="discountPercent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Quote Discount %</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.1"
                          min="0"
                          max="100"
                          placeholder="0"
                          className="h-8 text-sm"
                          {...field}
                          onChange={(e) => field.onChange(e.target.valueAsNumber)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="taxPercent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Quote Tax %</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.1"
                          min="0"
                          max="100"
                          placeholder="0"
                          className="h-8 text-sm"
                          {...field}
                          onChange={(e) => field.onChange(e.target.valueAsNumber)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="expiresAt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Expires On</FormLabel>
                      <FormControl>
                        <Input type="date" className="h-8 text-sm" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Notes */}
            <Card>
              <CardContent className="pt-5">
                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notes (optional)</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Add any notes or terms for the customer…"
                          className="text-sm resize-none"
                          rows={4}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>
          </div>

          {/* Right column: Line Items + Total Preview + Submit */}
          <div className="w-full lg:w-2/3 flex flex-col gap-6">

            {/* Line Items */}
            <Card>
              <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Line Items
                </CardTitle>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    append({ productId: "", description: "", quantity: 1, unitPrice: 0, discountPercent: 0, taxPercent: 0 })
                  }
                >
                  <Plus className="mr-2 h-3.5 w-3.5" />
                  Add Item
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                {fields.map((field, index) => (
                  <div key={field.id} className="rounded-lg border bg-muted/20 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">Item {index + 1}</span>
                      {fields.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 text-muted-foreground hover:text-destructive"
                          onClick={() => remove(index)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <FormField
                        control={form.control}
                        name={`items.${index}.productId`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Product</FormLabel>
                            <FormControl>
                              <SearchableSelect
                                options={[
                                  { value: "_custom", label: "Custom item" },
                                  ...formData.products.map((p) => ({
                                    value: p.id,
                                    label: p.name,
                                  })),
                                ]}
                                value={field.value || "_custom"}
                                onChange={(val) => {
                                  field.onChange(val === "_custom" ? "" : val);
                                  handleProductSelect(index, val);
                                }}
                                placeholder="Select product"
                                searchPlaceholder="Search products…"
                                emptyText="No products found."
                                className="h-8 text-sm"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name={`items.${index}.quantity`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Qty</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                min="1"
                                step="1"
                                className="h-8 text-sm"
                                {...field}
                                onChange={(e) => field.onChange(e.target.valueAsNumber)}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name={`items.${index}.description`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Description</FormLabel>
                          <FormControl>
                            <Input className="h-8 text-sm" placeholder="Describe the item" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid grid-cols-3 gap-3">
                      <FormField
                        control={form.control}
                        name={`items.${index}.unitPrice`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Unit Price</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder="0.00"
                                className="h-8 text-sm"
                                {...field}
                                onChange={(e) => field.onChange(e.target.valueAsNumber)}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`items.${index}.discountPercent`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Discount %</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                step="0.1"
                                min="0"
                                max="100"
                                placeholder="0"
                                className="h-8 text-sm"
                                {...field}
                                onChange={(e) => field.onChange(e.target.valueAsNumber)}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`items.${index}.taxPercent`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Tax %</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                step="0.1"
                                min="0"
                                max="100"
                                placeholder="0"
                                className="h-8 text-sm"
                                {...field}
                                onChange={(e) => field.onChange(e.target.valueAsNumber)}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Total Preview */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Total Preview
                </CardTitle>
                <CardDescription className="text-xs">Updates as you type</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="tabular-nums font-medium">
                    ${totals.subtotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                {totals.discountAmount > 0 && (
                  <div className="flex justify-between text-sm text-amber-600">
                    <span>Discount ({discountPct}%)</span>
                    <span className="tabular-nums">
                      −${totals.discountAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
                {totals.taxAmount > 0 && (
                  <div className="flex justify-between text-sm text-slate-600">
                    <span>Tax ({taxPct}%)</span>
                    <span className="tabular-nums">
                      +${totals.taxAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
                <Separator />
                <div className="flex justify-between">
                  <span className="font-semibold">Total</span>
                  <span className="text-lg font-bold tabular-nums">
                    ${totals.total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Submit */}
            <div className="flex gap-3 justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push(`/dashboard/sales/quotes/${quote.id}`)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Changes
              </Button>
            </div>
          </div>
        </div>
      </form>
    </Form>
  );
}
