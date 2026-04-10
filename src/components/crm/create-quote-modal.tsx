"use client";

import React, { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useFieldArray } from "react-hook-form";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createQuoteAction } from "@/actions/quotes";
import { CreateQuoteSchema } from "@/actions/quotes-validation";

type FormValues = z.infer<typeof CreateQuoteSchema>;

interface CreateQuoteModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealId: string;
  companyId: string;
  contactId?: string;
  products: Array<{ id: string; name: string; price: string }>;
  onSuccess: (quoteId: string) => void;
}

export function CreateQuoteModal({
  open,
  onOpenChange,
  dealId,
  companyId,
  contactId,
  products,
  onSuccess,
}: CreateQuoteModalProps) {
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(CreateQuoteSchema),
    defaultValues: {
      dealId,
      companyId,
      contactId: contactId || "",
      items: [
        {
          productId: "",
          description: "",
          quantity: 1,
          unitPrice: 0,
          discountPercent: 0,
          taxPercent: 0,
        },
      ],
      notes: "",
      discountPercent: 0,
      taxPercent: 0,
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "items",
  });

  async function onSubmit(data: FormValues) {
    setIsLoading(true);
    try {
      const result = await createQuoteAction(data);
      toast.success(`Quote ${result.quoteNumber} created successfully`);
      onOpenChange(false);
      form.reset();
      onSuccess(result.quoteId);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to create quote");
    } finally {
      setIsLoading(false);
    }
  }

  function handleProductSelect(index: number, productId: string) {
    if (productId === "custom") {
      form.setValue(`items.${index}.productId`, "");
      return;
    }
    const product = products.find((p) => p.id === productId);
    if (product) {
      form.setValue(`items.${index}.productId`, product.id);
      form.setValue(`items.${index}.unitPrice`, parseFloat(product.price) || 0);
      if (!form.getValues(`items.${index}.description`)) {
        form.setValue(`items.${index}.description`, product.name);
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Quote</DialogTitle>
          <DialogDescription>Add line items and configure pricing</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Hidden fields */}
            <input type="hidden" {...form.register("dealId")} />
            <input type="hidden" {...form.register("companyId")} />

            {/* Items Section */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Line Items
                </h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    append({
                      productId: "",
                      description: "",
                      quantity: 1,
                      unitPrice: 0,
                      discountPercent: 0,
                      taxPercent: 0,
                    })
                  }
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Item
                </Button>
              </div>

              {fields.map((field, index) => (
                <div
                  key={field.id}
                  className="border rounded-lg p-4 space-y-3 bg-muted/20"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Item {index + 1}
                    </span>
                    {fields.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => remove(index)}
                        className="h-7 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    {/* Product selector */}
                    <FormField
                      control={form.control}
                      name={`items.${index}.productId`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Product</FormLabel>
                          <Select
                            onValueChange={(val) => {
                              field.onChange(val === "custom" ? "" : val);
                              handleProductSelect(index, val);
                            }}
                            value={field.value || "custom"}
                          >
                            <FormControl>
                              <SelectTrigger className="h-8 text-sm">
                                <SelectValue placeholder="Select product" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="custom">Custom item</SelectItem>
                              {products.map((product) => (
                                <SelectItem key={product.id} value={product.id}>
                                  {product.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Quantity */}
                    <FormField
                      control={form.control}
                      name={`items.${index}.quantity`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Quantity</FormLabel>
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

                  {/* Description */}
                  <FormField
                    control={form.control}
                    name={`items.${index}.description`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Description</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Item description"
                            className="h-8 text-sm"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-3 gap-3">
                    {/* Unit Price */}
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

                    {/* Discount % */}
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

                    {/* Tax % */}
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
            </div>

            {/* Quote-level adjustments */}
            <div className="space-y-3 border-t pt-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Quote Adjustments
              </h3>
              <div className="grid grid-cols-2 gap-3">
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
              </div>
            </div>

            {/* Expiry + Notes */}
            <div className="space-y-3">
              <FormField
                control={form.control}
                name="expiresAt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Expiration Date (Optional)</FormLabel>
                    <FormControl>
                      <Input type="date" className="h-8 text-sm" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Notes</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Additional notes for the customer..."
                        className="text-sm resize-none"
                        rows={3}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Actions */}
            <div className="flex gap-2 justify-end pt-2 border-t">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create Quote
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
