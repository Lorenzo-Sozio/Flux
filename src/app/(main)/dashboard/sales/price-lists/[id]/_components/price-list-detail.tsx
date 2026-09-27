"use client";

import { useMemo, useState, useTransition } from "react";

import Link from "next/link";

import { Building2, Loader2, Package, Pencil, Plus, SettingsIcon, Tags, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { assignPriceList, removePriceListItem, setPriceListItem } from "@/actions/price-lists";
import { EmptyState } from "@/components/crm/empty-state";
import {
  Field,
  FieldList,
  Metric,
  MetricStrip,
  RecordAvatar,
  RecordBackLink,
  RecordHero,
  StatusBadge,
} from "@/components/crm/record/record-page";
import { RecordSections } from "@/components/crm/record/record-sections";
import { RecordCards, ResponsiveRecordList } from "@/components/crm/record-cards";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useCurrency } from "@/hooks/use-currency";
import { num, type PriceRules, priceProduct } from "@/lib/price-list";
import { cn } from "@/lib/utils";

import { AdjustmentText } from "../../_components/adjustment-text";
import { PriceListDialog, type PriceListFields } from "../../_components/price-list-dialog";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PriceItem {
  id: string;
  productId: string;
  unitPrice: string;
  productName: string;
  productSku: string | null;
  basePrice: string;
  isActive: boolean;
}

export interface ProductOption {
  id: string;
  name: string;
  sku: string | null;
  price: string;
}

export interface CompanyOption {
  id: string;
  name: string;
}

interface Props {
  list: PriceListFields;
  items: PriceItem[];
  products: ProductOption[];
  /** The customers currently on this list. */
  assigned: CompanyOption[];
  allCompanies: CompanyOption[];
  canManage: boolean;
}

/** Cards drawn at first on a phone, and added per "show more"; the desktop table shows every row. */
const PAGE = 5;
const MORE = 25;

/**
 * One price list: the percentage that moves every price, the prices written by
 * hand that beat it, and the customers it applies to.
 *
 * ⚠️ Every figure on this screen is computed with `priceProduct`, the same pure
 * function the quote form and the server use. A second arithmetic here — even
 * "base × (1 + percent/100)" typed out again — is how a screen ends up promising
 * a price the saved document does not carry.
 *
 * Laid out as a record: the hero says what the list does (its direction, in
 * words) and how far it reaches; the named prices are the work column; the
 * customers and the settings sit beside them, and on a phone each is a tab. The
 * hero lives in this client component rather than the page because the edit
 * dialog updates the name and the percentage in place, without a round trip.
 */
export function PriceListDetail({ list, items, products, assigned, allCompanies, canManage }: Props) {
  const t = useTranslations("priceLists.detail");
  const tl = useTranslations("priceLists");
  const tR = useTranslations("record");
  const { formatAmount } = useCurrency();
  const [, startTransition] = useTransition();

  const [record, setRecord] = useState(list);
  const [rows, setRows] = useState(items);
  const [customers, setCustomers] = useState(assigned);
  const [editOpen, setEditOpen] = useState(false);

  /** The list as the pricing function sees it: the percentage and what beats it. */
  const rules = useMemo<PriceRules>(
    () => ({
      id: record.id,
      name: record.name,
      adjustmentPercent: num(record.adjustmentPercent),
      overrides: Object.fromEntries(rows.map((r) => [r.productId, num(r.unitPrice)])),
    }),
    [record, rows],
  );

  const priced = useMemo(
    () =>
      rows.map((row) => {
        const base = num(row.basePrice);
        const price = num(row.unitPrice);
        return { row, base, price, difference: price - base };
      }),
    [rows],
  );

  const settings = (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{tR("tabs.settings")}</CardTitle>
      </CardHeader>
      <CardContent>
        <FieldList>
          <Field label={tl("columns.adjustment")} always>
            <div className="space-y-1">
              <AdjustmentText adjustmentPercent={record.adjustmentPercent} className="font-medium" />
              {/* ⚠️ Said in words next to the figure: −10 here is ten per cent off,
                  the opposite sign to every discountPercent beside it. */}
              <p className="text-muted-foreground text-xs">{tl("dialog.adjustmentHelp")}</p>
            </div>
          </Field>
          <Field label={tl("columns.active")} always>
            {record.isActive ? tl("filters.active") : tl("filters.inactive")}
          </Field>
          <Field label={tl("dialog.descriptionLabel")}>{record.description}</Field>
        </FieldList>
      </CardContent>
    </Card>
  );

  return (
    <>
      <RecordBackLink href="/dashboard/sales/price-lists">{t("back")}</RecordBackLink>

      {/* ── Hero: what the list does to a price, and how far it reaches ── */}
      <RecordHero
        avatar={
          <RecordAvatar>
            <Tags className="size-5 sm:size-6" />
          </RecordAvatar>
        }
        badges={
          <StatusBadge tone={record.isActive ? "success" : "neutral"}>
            {record.isActive ? tl("filters.active") : tl("filters.inactive")}
          </StatusBadge>
        }
        title={record.name}
        actions={
          canManage ? (
            <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil className="size-3.5" aria-hidden />
              {t("edit")}
            </Button>
          ) : undefined
        }
      >
        {record.description && (
          <p className="whitespace-pre-wrap break-words text-muted-foreground text-sm">{record.description}</p>
        )}
        {/* ⚠️ The percentage as a direction, in words — "10% off", "5% on top" —
            never as a signed figure: −10 here is the opposite convention to every
            discountPercent beside it, and a bare "+5%" reads as a typo. */}
        <MetricStrip>
          <Metric label={tl("columns.adjustment")} hint={t("adjustmentHint")}>
            <AdjustmentText adjustmentPercent={record.adjustmentPercent} className="text-lg sm:text-xl" />
          </Metric>
          <Metric label={tl("columns.prices")}>{rows.length}</Metric>
          <Metric label={tl("columns.customers")} hint={customers.length === 0 ? t("noCustomers") : undefined}>
            {customers.length}
          </Metric>
        </MetricStrip>
      </RecordHero>

      <RecordSections
        label={tR("sectionsLabel")}
        tabs={[
          { id: "prices", label: tR("tabs.prices"), icon: <Package aria-hidden />, count: rows.length },
          { id: "customers", label: tl("columns.customers"), icon: <Building2 aria-hidden />, count: customers.length },
          { id: "settings", label: tR("tabs.settings"), icon: <SettingsIcon aria-hidden /> },
        ]}
        sections={[
          {
            tab: "prices",
            column: "main",
            node: (
              <PriceList
                rules={rules}
                priced={priced}
                products={products}
                canManage={canManage}
                onChanged={setRows}
                formatAmount={formatAmount}
                startTransition={startTransition}
              />
            ),
          },
          {
            tab: "customers",
            column: "side",
            node: (
              <Customers
                listId={record.id}
                customers={customers}
                allCompanies={allCompanies}
                canManage={canManage}
                onChanged={setCustomers}
              />
            ),
          },
          { tab: "settings", column: "side", node: settings },
          {
            tab: "settings",
            column: "side",
            node: <PercentagePreview rules={rules} products={products} formatAmount={formatAmount} />,
          },
        ]}
      />

      {canManage && (
        <PriceListDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          priceList={record}
          onSaved={(saved) => setRecord(saved)}
        />
      )}
    </>
  );
}

// ── The prices written by hand ────────────────────────────────────────────────

type Priced = { row: PriceItem; base: number; price: number; difference: number };

function PriceList({
  rules,
  priced,
  products,
  canManage,
  onChanged,
  formatAmount,
  startTransition,
}: {
  rules: PriceRules;
  priced: Priced[];
  products: ProductOption[];
  canManage: boolean;
  onChanged: (updater: (prev: PriceItem[]) => PriceItem[]) => void;
  formatAmount: (value: number) => string;
  startTransition: (fn: () => void) => void;
}) {
  const t = useTranslations("priceLists.detail");
  const tv = useTranslations("validation.priceLists");
  const tR = useTranslations("record");
  const [productId, setProductId] = useState("");
  const [draftPrice, setDraftPrice] = useState("");
  const [saving, setSaving] = useState(false);
  const [limit, setLimit] = useState(PAGE);

  // A product that already has a price is edited in the table, not added again:
  // the unique index would refuse a second row anyway, and offering it is a
  // button whose only outcome is an error.
  const addable = useMemo(() => products.filter((p) => !(p.id in rules.overrides)), [products, rules.overrides]);

  const add = async () => {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    const value = Number.parseFloat(draftPrice.replace(",", "."));
    if (!Number.isFinite(value) || value < 0) {
      toast.error(tv("priceNegative"));
      return;
    }
    setSaving(true);
    try {
      await setPriceListItem(rules.id, product.id, value);
      onChanged((prev) => [
        ...prev,
        {
          // ⚠️ A placeholder id: the row's identity on screen is the product, and
          // the real id is never used to write — `setPriceListItem` matches on the
          // pair. Reading one back would cost a statement for nothing.
          id: `new-${product.id}`,
          productId: product.id,
          unitPrice: String(value),
          productName: product.name,
          productSku: product.sku,
          basePrice: product.price,
          isActive: true,
        },
      ]);
      setProductId("");
      setDraftPrice("");
      toast.success(t("priceSaved"));
    } catch {
      toast.error(t("priceFailed"));
    } finally {
      setSaving(false);
    }
  };

  const save = (row: PriceItem, raw: string) => {
    const value = Number.parseFloat(raw.replace(",", "."));
    if (!Number.isFinite(value) || value < 0) {
      toast.error(tv("priceNegative"));
      return;
    }
    if (value === num(row.unitPrice)) return;
    startTransition(async () => {
      try {
        await setPriceListItem(rules.id, row.productId, value);
        onChanged((prev) => prev.map((r) => (r.productId === row.productId ? { ...r, unitPrice: String(value) } : r)));
        toast.success(t("priceSaved"));
      } catch {
        toast.error(t("priceFailed"));
      }
    });
  };

  const remove = (row: PriceItem) => {
    startTransition(async () => {
      try {
        await removePriceListItem(rules.id, row.productId);
        onChanged((prev) => prev.filter((r) => r.productId !== row.productId));
        toast.success(t("priceRemoved"));
      } catch {
        toast.error(t("priceFailed"));
      }
    });
  };

  /**
   * The editable price. ⚠️ Keyed on the saved figure: the input is uncontrolled,
   * and the phone card and the desktop row each hold one, so the one not typed
   * into would otherwise go on showing the old price after the other saved.
   */
  const priceInput = (row: PriceItem, price: number, className: string) => (
    <Input
      key={`${row.productId}-${row.unitPrice}`}
      type="number"
      step="0.01"
      min="0"
      inputMode="decimal"
      aria-label={`${t("listPrice")} — ${row.productName}`}
      defaultValue={price}
      // ⚠️ Saved on blur and on Enter, not on every keystroke: a
      // statement per character is a write per character, and the
      // half-typed figures in between are all real prices.
      onBlur={(e) => save(row, e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className={cn("text-right tabular-nums", className)}
    />
  );

  const differenceClass = (difference: number) =>
    cn(
      "tabular-nums",
      difference < 0 && "text-emerald-600 dark:text-emerald-400",
      difference > 0 && "text-amber-600 dark:text-amber-400",
      difference === 0 && "text-muted-foreground",
    );

  const shown = priced.slice(0, limit);
  const remaining = priced.length - shown.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("pricesTitle")}</CardTitle>
        <CardDescription>{t("pricesSubtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {canManage && (
          <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/10 p-3">
            {/* ⚠️ `min-w-48`, so on a phone the picker takes a line of its own
                instead of being squeezed to nothing beside the price and the button. */}
            <div className="min-w-48 flex-1 space-y-1.5">
              <Label className="text-xs">{t("product")}</Label>
              <SearchableSelect
                options={addable.map((p) => ({ value: p.id, label: p.name, sublabel: p.sku ?? undefined }))}
                value={productId}
                onChange={setProductId}
                placeholder={t("pickProduct")}
                searchPlaceholder={t("searchProduct")}
                emptyText={t("noProductsLeft")}
              />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5 sm:w-32 sm:flex-none">
              <Label htmlFor="price-list-draft" className="text-xs">
                {t("listPrice")}
              </Label>
              <Input
                id="price-list-draft"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                value={draftPrice}
                onChange={(e) => setDraftPrice(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <Button onClick={add} disabled={!productId || draftPrice === "" || saving} className="gap-1.5 max-md:h-11">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-4 w-4" />}
              {t("addPrice")}
            </Button>
          </div>
        )}

        {priced.length === 0 ? (
          <div className="rounded-md border">
            <EmptyState icon={Package} title={t("noPrices")} description={t("noPricesDesc")} />
          </div>
        ) : (
          // Below `md` each named price is a card: the product and its catalogue
          // price on top, the figure to edit and the remove button along the
          // bottom, always visible — a phone has no hover to reveal them with.
          <ResponsiveRecordList
            cards={
              <div className="space-y-2">
                <RecordCards
                  items={shown.map(({ row, base, price, difference }) => ({
                    id: row.productId,
                    title: <span className={cn(!row.isActive && "text-muted-foreground")}>{row.productName}</span>,
                    subtitle: row.productSku ?? undefined,
                    badge: canManage ? undefined : (
                      <span className="font-semibold text-sm tabular-nums">{formatAmount(price)}</span>
                    ),
                    meta: (
                      <>
                        <span className="text-muted-foreground text-xs">
                          {t("basePrice")} <span className="tabular-nums">{formatAmount(base)}</span>
                        </span>
                        {difference !== 0 && (
                          <span className={cn("text-xs", differenceClass(difference))}>
                            {t("difference")} {formatAmount(difference)}
                          </span>
                        )}
                      </>
                    ),
                    footer: canManage ? (
                      <>
                        <span className="shrink-0 text-muted-foreground text-xs">{t("listPrice")}</span>
                        {priceInput(row, price, "h-11 min-w-0 flex-1 text-base")}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-11 shrink-0 text-destructive hover:text-destructive"
                          onClick={() => remove(row)}
                          aria-label={t("removePrice")}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    ) : undefined,
                  }))}
                />
                {remaining > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 w-full"
                    onClick={() => setLimit((n) => n + MORE)}
                  >
                    {tR("showMore")}
                    <span className="text-muted-foreground tabular-nums">+{Math.min(remaining, MORE)}</span>
                  </Button>
                )}
              </div>
            }
            table={
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-muted-foreground text-xs">
                      <th className="px-4 py-2.5 text-left font-medium">{t("product")}</th>
                      <th className="hidden px-4 py-2.5 text-left font-medium md:table-cell lg:hidden xl:table-cell">
                        {t("sku")}
                      </th>
                      <th className="px-4 py-2.5 text-right font-medium">{t("basePrice")}</th>
                      <th className="px-4 py-2.5 text-right font-medium">{t("listPrice")}</th>
                      <th className="hidden px-4 py-2.5 text-right font-medium md:table-cell lg:hidden xl:table-cell">
                        {t("difference")}
                      </th>
                      <th className="w-12 px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {priced.map(({ row, base, price, difference }) => (
                      <tr key={row.productId} className="group transition-colors hover:bg-muted/30">
                        <td className="px-4 py-2.5">
                          <p className={cn("font-medium", !row.isActive && "text-muted-foreground")}>
                            {row.productName}
                          </p>
                          {/* From lg the table shares the width with the side column,
                              so the SKU folds under the name and the difference
                              goes, until xl gives them their columns back. */}
                          {row.productSku && (
                            <p className="hidden font-mono text-muted-foreground text-xs lg:block xl:hidden">
                              {row.productSku}
                            </p>
                          )}
                        </td>
                        <td className="hidden px-4 py-2.5 md:table-cell lg:hidden xl:table-cell">
                          {row.productSku ? (
                            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{row.productSku}</span>
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground tabular-nums">
                          {formatAmount(base)}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {canManage ? (
                            priceInput(row, price, "ml-auto h-8 w-28")
                          ) : (
                            <span className="font-semibold tabular-nums">{formatAmount(price)}</span>
                          )}
                        </td>
                        <td
                          className={cn(
                            "hidden px-4 py-2.5 text-right md:table-cell lg:hidden xl:table-cell",
                            differenceClass(difference),
                          )}
                        >
                          {difference === 0 ? "—" : formatAmount(difference)}
                        </td>
                        <td className="px-4 py-2.5">
                          {canManage && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7 text-destructive opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                              onClick={() => remove(row)}
                              title={t("removePrice")}
                              aria-label={t("removePrice")}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            }
          />
        )}
      </CardContent>
    </Card>
  );
}

// ── What the percentage gives a product nobody priced ─────────────────────────

/**
 * ⚠️ The percentage is invisible until somebody can see it applied to something.
 * A list with no rows at all still changes every price on every quote, and this
 * is where that becomes a figure rather than a claim.
 */
function PercentagePreview({
  rules,
  products,
  formatAmount,
}: {
  rules: PriceRules;
  products: ProductOption[];
  formatAmount: (value: number) => string;
}) {
  const t = useTranslations("priceLists.detail");
  const [productId, setProductId] = useState("");

  const product = products.find((p) => p.id === productId);
  const result = product ? priceProduct(product.id, product.price, rules) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("previewTitle")}</CardTitle>
        <CardDescription>{t("previewSubtitle")}</CardDescription>
      </CardHeader>
      {/* One column in the side column from lg: two there would be 150px each. */}
      <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
        <div className="min-w-0 space-y-1.5">
          <Label className="text-xs">{t("product")}</Label>
          <SearchableSelect
            options={products.map((p) => ({ value: p.id, label: p.name, sublabel: p.sku ?? undefined }))}
            value={productId}
            onChange={setProductId}
            placeholder={t("pickProduct")}
            searchPlaceholder={t("searchProduct")}
            emptyText={t("noProducts")}
          />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label className="text-xs">{t("resultLabel")}</Label>
          {result && product ? (
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-semibold text-lg tabular-nums">{formatAmount(result.price)}</span>
              <span className="text-muted-foreground text-xs tabular-nums line-through">
                {formatAmount(num(product.price))}
              </span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs">
                {t(`source.${result.source}`)}
              </span>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">{t("previewEmpty")}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Who is on the list ────────────────────────────────────────────────────────

function Customers({
  listId,
  customers,
  allCompanies,
  canManage,
  onChanged,
}: {
  listId: string;
  customers: CompanyOption[];
  allCompanies: CompanyOption[];
  canManage: boolean;
  onChanged: (updater: (prev: CompanyOption[]) => CompanyOption[]) => void;
}) {
  const t = useTranslations("priceLists.detail");
  const tR = useTranslations("record");
  const [companyId, setCompanyId] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const addable = useMemo(() => {
    const on = new Set(customers.map((c) => c.id));
    return allCompanies.filter((c) => !on.has(c.id));
  }, [allCompanies, customers]);

  const add = async () => {
    const company = allCompanies.find((c) => c.id === companyId);
    if (!company) return;
    setBusy(true);
    try {
      await assignPriceList([company.id], listId);
      onChanged((prev) => [...prev, company].sort((a, b) => a.name.localeCompare(b.name)));
      setCompanyId("");
      toast.success(t("customerAdded"));
    } catch {
      toast.error(t("customerFailed"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (company: CompanyOption) => {
    setBusy(true);
    try {
      // ⚠️ Null, not "the default list": taking a customer off a list puts them
      // back on the catalogue price, which is what having no list means.
      await assignPriceList([company.id], null);
      onChanged((prev) => prev.filter((c) => c.id !== company.id));
      toast.success(t("customerRemoved"));
    } catch {
      toast.error(t("customerFailed"));
    } finally {
      setBusy(false);
    }
  };

  // Five names, then the rest on request: the side column is reference, and a
  // list on eighty customers would push the settings below the fold.
  const shown = expanded ? customers : customers.slice(0, PAGE);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("customersTitle")}</CardTitle>
        <CardDescription>{t("customersSubtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {canManage && (
          <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/10 p-3">
            <div className="min-w-48 flex-1 space-y-1.5">
              <Label className="text-xs">{t("company")}</Label>
              <SearchableSelect
                options={addable.map((c) => ({ value: c.id, label: c.name }))}
                value={companyId}
                onChange={setCompanyId}
                placeholder={t("pickCompany")}
                searchPlaceholder={t("searchCompany")}
                emptyText={t("noCompaniesLeft")}
              />
            </div>
            <Button onClick={add} disabled={!companyId || busy} className="gap-1.5 max-md:h-11">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-4 w-4" />}
              {t("addCustomer")}
            </Button>
          </div>
        )}

        {customers.length === 0 ? (
          <div className="rounded-md border">
            <EmptyState icon={Building2} title={t("noCustomers")} description={t("noCustomersDesc")} />
          </div>
        ) : (
          <>
            <ul className="divide-y rounded-md border">
              {shown.map((company) => (
                <li key={company.id} className="flex items-center justify-between gap-1 pr-1">
                  <Link
                    href={`/dashboard/companies/${company.id}`}
                    className="flex min-h-11 min-w-0 flex-1 items-center truncate px-3 text-sm hover:underline"
                  >
                    <span className="truncate">{company.name}</span>
                  </Link>
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-10 shrink-0 text-muted-foreground hover:text-destructive md:size-8"
                      onClick={() => remove(company)}
                      disabled={busy}
                      title={t("removeCustomer")}
                      aria-label={t("removeCustomer")}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {customers.length > PAGE && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full max-md:h-11"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
              >
                {expanded ? tR("showLess") : tR("showMore")}
                {!expanded && <span className="text-muted-foreground tabular-nums">+{customers.length - PAGE}</span>}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
