"use client";

import { useEffect, useMemo, useState } from "react";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronLeft, FileText, Loader2, Package, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { createQuoteAction, getQuoteFormData } from "@/actions/quotes";
import { CreateQuoteSchema } from "@/actions/quotes-validation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useCurrency } from "@/hooks/use-currency";
import { computeDocument } from "@/lib/document-totals";
import { cn } from "@/lib/utils";

type FormValues = z.infer<typeof CreateQuoteSchema>;
type FormData = Awaited<ReturnType<typeof getQuoteFormData>>;

/** Marks a line as written by hand rather than picked from the catalogue. */
const CUSTOM = "_custom";

/**
 * One column template, shared by the header strip and every line, so the two
 * cannot drift apart. Below `xl` there is not enough room for nine columns, so a
 * line folds: four fields to the row on a laptop, two on a phone, each under its
 * own label.
 */
const LINE_GRID =
  "grid grid-cols-2 gap-x-3 gap-y-3 lg:grid-cols-4 xl:grid-cols-[28px_minmax(0,1.6fr)_minmax(0,2fr)_76px_116px_84px_84px_minmax(92px,auto)_36px] xl:items-center xl:gap-x-2 xl:gap-y-0";

const emptyLine = () => ({
  productId: "",
  description: "",
  quantity: 1,
  unitPrice: 0,
  discountPercent: 0,
  taxPercent: 0,
});

/**
 * Writing a quote.
 *
 * Built to the same plan as the order form, because they are the same document
 * asked twice and a person who has written one should not have to learn the
 * other: a bar that does not scroll away, who it is for and what applies to the
 * whole of it side by side, the lines given the width they need, and the note
 * beside the money at the foot.
 *
 * Two things it did not have.
 *
 * ⚠️ The preview did its own arithmetic — line tax folded into something it
 * called a subtotal, then a quote-level tax applied on top of that, which is tax
 * on tax (audit rilievo C-01). The server was fixed to use `computeDocument` and
 * this page was not, so the figure on screen while writing was not the figure
 * that got saved. It now calls the same function the action calls.
 *
 * ⚠️ And it printed a `$` regardless of the workspace currency.
 */
export default function NewQuotePage() {
  const router = useRouter();
  // Opened from a customer or a deal, both are already known.
  const params = useSearchParams();
  const t = useTranslations("quotes.form");
  const tc = useTranslations("common");
  const { formatAmount } = useCurrency();

  const [data, setData] = useState<FormData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(CreateQuoteSchema),
    defaultValues: {
      dealId: params.get("dealId") ?? "",
      companyId: params.get("companyId") ?? "",
      contactId: params.get("contactId") ?? "",
      expiresAt: "",
      items: [emptyLine()],
      notes: "",
      discountPercent: 0,
      taxPercent: 0,
    },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "items" });

  // Once, on mount. The translator is read inside so the message follows the
  // chosen language, but it is not a reason to fetch the deals again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: loaded once
  useEffect(() => {
    getQuoteFormData()
      .then(setData)
      .catch(() => toast.error(t("loadFailed")))
      .finally(() => setLoading(false));
  }, []);

  const items = form.watch("items");
  const companyId = form.watch("companyId");
  const headerDiscount = Number(form.watch("discountPercent")) || 0;
  const headerTax = Number(form.watch("taxPercent")) || 0;

  /** Contacts belonging to the chosen company, or all of them when none is chosen. */
  const contactOptions = useMemo(() => {
    const all = data?.contacts ?? [];
    const scoped = companyId ? all.filter((c) => c.companyId === companyId) : all;
    return scoped.map((c) => ({
      value: c.id,
      label: [c.firstName, c.lastName].filter(Boolean).join(" ") || (c.email ?? c.id),
    }));
  }, [data, companyId]);

  /**
   * The figures, from the module the server uses.
   *
   * Not a second version of the same sum: a preview that disagrees with what is
   * saved is worse than no preview, because it is believed.
   */
  const totals = useMemo(
    () =>
      computeDocument({
        lines: (items ?? []).map((i) => ({
          quantity: Number(i.quantity) || 0,
          unitPrice: Number(i.unitPrice) || 0,
          discountPercent: Number(i.discountPercent) || 0,
          taxPercent: Number(i.taxPercent) || 0,
        })),
        discountPercent: headerDiscount,
        taxPercent: headerTax > 0 ? headerTax : undefined,
      }),
    [items, headerDiscount, headerTax],
  );

  /** Choosing a deal carries its customer across, so nothing is retyped. */
  function selectDeal(dealId: string) {
    form.setValue("dealId", dealId);
    const deal = data?.deals.find((d) => d.id === dealId);
    if (!deal) return;
    if (deal.companyId) form.setValue("companyId", deal.companyId);
    if (deal.contactId) form.setValue("contactId", deal.contactId);
  }

  /** Picking a product fills in the line; picking "off catalogue" clears it for typing. */
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

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    try {
      const result = await createQuoteAction(values);
      toast.success(t("created", { number: result.quoteNumber }));
      router.push(`/dashboard/sales/quotes/${result.quoteId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("createFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-6 p-6">
        {/* ── The bar that stays put ─────────────────────────────────────── */}
        <div className="-mx-6 -mt-6 sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b bg-background/85 px-6 py-3 backdrop-blur-md">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 text-muted-foreground"
              aria-label={t("back")}
            >
              <Link href="/dashboard/sales/quotes">
                <ChevronLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <FileText className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate font-bold text-lg tracking-tight">{t("title")}</h1>
              <p className="hidden truncate text-muted-foreground text-xs sm:block">{t("subtitle")}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="mr-2 hidden items-baseline gap-2 sm:flex">
              <span className="text-muted-foreground text-xs uppercase tracking-wide">{t("total")}</span>
              <span className="font-bold text-base tabular-nums">{formatAmount(totals.total)}</span>
            </div>
            <Button type="button" variant="ghost" onClick={() => router.push("/dashboard/sales/quotes")}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={submitting || loading} className="gap-2">
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t("createQuote")}
            </Button>
          </div>
        </div>

        {/* ── Band one: who it is for, and what applies to all of it ─────── */}
        <div className="grid gap-6 md:grid-cols-12">
          <Card className="md:col-span-6">
            <CardHeader>
              <CardTitle className="font-semibold text-muted-foreground text-sm uppercase tracking-wide">
                {t("customerTitle")}
              </CardTitle>
              <CardDescription>{t("customerSubtitle")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="dealId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">
                      {t("deal")} <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <SearchableSelect
                        disabled={loading}
                        options={(data?.deals ?? []).map((d) => ({ value: d.id, label: d.name }))}
                        value={field.value}
                        onChange={selectDeal}
                        placeholder={loading ? tc("loading") : t("dealPlaceholder")}
                        searchPlaceholder={t("searchPlaceholder")}
                        emptyText={t("dealEmpty")}
                        className="h-9"
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
                    <FormLabel className="text-xs">
                      {t("company")} <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <SearchableSelect
                        disabled={loading}
                        options={(data?.companies ?? []).map((c) => ({ value: c.id, label: c.name }))}
                        value={field.value}
                        onChange={(v) => {
                          field.onChange(v);
                          // A contact from the previous company is worse than none.
                          form.setValue("contactId", "");
                        }}
                        placeholder={t("companyPlaceholder")}
                        searchPlaceholder={t("searchPlaceholder")}
                        emptyText={t("companyEmpty")}
                        className="h-9"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="contactId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">{t("contact")}</FormLabel>
                    <FormControl>
                      <SearchableSelect
                        disabled={loading}
                        options={contactOptions}
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        placeholder={t("contactPlaceholder")}
                        searchPlaceholder={t("searchPlaceholder")}
                        emptyText={companyId ? t("contactEmptyAtCompany") : t("contactEmpty")}
                        className="h-9"
                      />
                    </FormControl>
                    <p className="text-muted-foreground text-xs">{t("contactHint")}</p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Three answers on each side, so the two cards end level. */}
          <Card className="md:col-span-6">
            <CardHeader>
              <CardTitle className="font-semibold text-muted-foreground text-sm uppercase tracking-wide">
                {t("detailsTitle")}
              </CardTitle>
              <CardDescription>{t("detailsSubtitle")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="expiresAt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">{t("expiresAt")}</FormLabel>
                    <FormControl>
                      <Input type="date" className="h-9" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="discountPercent"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">{t("quoteDiscount")}</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        className="h-9 tabular-nums"
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
                    <FormLabel className="text-xs">{t("quoteTax")}</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        className="h-9 tabular-nums"
                        {...field}
                        onChange={(e) => field.onChange(e.target.valueAsNumber)}
                      />
                    </FormControl>
                    <p className="text-muted-foreground text-xs">{t("quoteTaxHint")}</p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>
        </div>

        {/* ── Band two: what is being quoted ─────────────────────────────── */}
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="font-semibold text-muted-foreground text-sm uppercase tracking-wide">
                {t("linesTitle")}
              </CardTitle>
              <CardDescription>{t("linesSubtitle")}</CardDescription>
            </div>
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => append(emptyLine())}>
              <Plus className="h-3.5 w-3.5" /> {t("addLine")}
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
              <span>{t("product")}</span>
              <span>{t("description")}</span>
              <span>{t("qty")}</span>
              <span>{t("unitPrice")}</span>
              <span>{t("discountShort")}</span>
              <span>{t("tax")}</span>
              <span className="text-right">{t("lineTotal")}</span>
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

                return (
                  <div
                    key={field.id}
                    className="rounded-lg border bg-muted/20 p-3 xl:rounded-none xl:border-0 xl:border-b xl:bg-transparent xl:px-0 xl:py-2 xl:hover:bg-muted/20 xl:last:border-b-0"
                  >
                    {/* Narrow screens get the line's own header; wide ones read it off the row. */}
                    <div className="mb-3 flex items-center justify-between gap-2 xl:hidden">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-muted-foreground text-xs">
                          {t("line", { number: index + 1 })}
                        </span>
                        {isCustom && (
                          <Badge
                            variant="outline"
                            className="h-5 border-amber-300 text-[10px] text-amber-700 dark:border-amber-800 dark:text-amber-400"
                          >
                            {t("offCatalogue")}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="mr-1 font-semibold text-sm tabular-nums">{formatAmount(lineTotal)}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => remove(index)}
                          disabled={fields.length === 1}
                          aria-label={t("removeLine")}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    <div className={LINE_GRID}>
                      <span className="hidden text-muted-foreground text-xs tabular-nums xl:block">{index + 1}</span>

                      <div className="col-span-2 space-y-1.5 xl:col-span-1 xl:space-y-0">
                        <Label className="text-xs xl:hidden">{t("product")}</Label>
                        <SearchableSelect
                          disabled={loading}
                          options={[
                            { value: CUSTOM, label: t("offCatalogue") },
                            ...(data?.products ?? []).map((p) => ({ value: p.id, label: p.name })),
                          ]}
                          value={line?.productId || CUSTOM}
                          onChange={(v) => selectProduct(index, v)}
                          placeholder={t("offCatalogue")}
                          searchPlaceholder={t("productSearchPlaceholder")}
                          emptyText={t("productEmpty")}
                          className="h-9"
                        />
                      </div>

                      <FormField
                        control={form.control}
                        name={`items.${index}.description`}
                        render={({ field: f }) => (
                          <FormItem className="col-span-2 space-y-1.5 xl:col-span-1 xl:space-y-0">
                            <FormLabel className="text-xs xl:hidden">
                              {t("description")} <span className="text-destructive">*</span>
                            </FormLabel>
                            <FormControl>
                              <Input className="h-9" placeholder={t("descriptionPlaceholder")} {...f} />
                            </FormControl>
                            <FormMessage className="text-[11px]" />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name={`items.${index}.quantity`}
                        render={({ field: f }) => (
                          <FormItem className="space-y-1.5 xl:space-y-0">
                            <FormLabel className="text-xs xl:hidden">{t("qty")}</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                min="1"
                                step="1"
                                className="h-9 tabular-nums"
                                {...f}
                                onChange={(e) => f.onChange(e.target.valueAsNumber)}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name={`items.${index}.unitPrice`}
                        render={({ field: f }) => (
                          <FormItem className="space-y-1.5 xl:space-y-0">
                            <FormLabel className="text-xs xl:hidden">{t("unitPrice")}</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                className="h-9 tabular-nums"
                                {...f}
                                onChange={(e) => f.onChange(e.target.valueAsNumber)}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name={`items.${index}.discountPercent`}
                        render={({ field: f }) => (
                          <FormItem className="space-y-1.5 xl:space-y-0">
                            <FormLabel className="text-xs xl:hidden">{t("discount")}</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                min="0"
                                max="100"
                                step="0.1"
                                className="h-9 tabular-nums"
                                {...f}
                                onChange={(e) => f.onChange(e.target.valueAsNumber)}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name={`items.${index}.taxPercent`}
                        render={({ field: f }) => (
                          <FormItem className="space-y-1.5 xl:space-y-0">
                            <FormLabel className="text-xs xl:hidden">{t("tax")}</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                min="0"
                                max="100"
                                step="0.1"
                                className="h-9 tabular-nums"
                                {...f}
                                onChange={(e) => f.onChange(e.target.valueAsNumber)}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      <span className="hidden text-right font-semibold text-sm tabular-nums xl:block">
                        {formatAmount(lineTotal)}
                      </span>

                      <div className="hidden items-center justify-end xl:flex">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => remove(index)}
                          disabled={fields.length === 1}
                          aria-label={t("removeLine")}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {fields.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                <Package className="h-8 w-8 opacity-30" />
                <p className="text-sm">{t("noLines")}</p>
              </div>
            )}

            {/* A second way to add one, at the end, where the hand already is. */}
            <Button
              type="button"
              variant="ghost"
              className="mt-3 h-10 w-full gap-1.5 border border-dashed text-muted-foreground hover:text-foreground"
              onClick={() => append(emptyLine())}
            >
              <Plus className="h-4 w-4" /> {t("addAnotherLine")}
            </Button>
          </CardContent>
        </Card>

        {/* ── Band three: what to know about it, and what it comes to ────── */}
        <div className="grid items-start gap-6 lg:grid-cols-12">
          <Card className="lg:col-span-7 xl:col-span-8">
            <CardHeader>
              <CardTitle className="font-semibold text-muted-foreground text-sm uppercase tracking-wide">
                {t("notesTitle")}
              </CardTitle>
              <CardDescription>{t("notesSubtitle")}</CardDescription>
            </CardHeader>
            <CardContent className="flex-1">
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Textarea
                        className="h-full min-h-[168px] resize-y leading-relaxed"
                        placeholder={t("notesPlaceholder")}
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* The money, where the eye ends. */}
          <Card className="lg:col-span-5 xl:col-span-4">
            <CardHeader>
              <CardTitle className="font-semibold text-muted-foreground text-sm uppercase tracking-wide">
                {t("summaryTitle")}
              </CardTitle>
              <CardDescription>{t("summarySubtitle")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("subtotal")}</span>
                <span className="tabular-nums">{formatAmount(totals.subtotal)}</span>
              </div>

              {totals.discountAmount > 0 && (
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>
                    {t("discountAmount")} · {headerDiscount}%
                  </span>
                  <span className="tabular-nums">−{formatAmount(totals.discountAmount)}</span>
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("taxAmount")}</span>
                <span className="tabular-nums">{formatAmount(totals.taxAmount)}</span>
              </div>

              <Separator className="my-1" />

              <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2.5">
                <span className="font-semibold">{t("total")}</span>
                <span className="font-bold text-lg tabular-nums">{formatAmount(totals.total)}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </form>
    </Form>
  );
}
