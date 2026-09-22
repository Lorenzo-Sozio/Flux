"use client";

import { useMemo, useState, useTransition } from "react";

import Link from "next/link";

import { Building2, ChevronLeft, Loader2, Package, Pencil, Plus, Tags, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { assignPriceList, removePriceListItem, setPriceListItem } from "@/actions/price-lists";
import { EmptyState } from "@/components/crm/empty-state";
import { Button } from "@/components/ui/button";
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

/**
 * One price list: the percentage that moves every price, the prices written by
 * hand that beat it, and the customers it applies to.
 *
 * ⚠️ Every figure on this screen is computed with `priceProduct`, the same pure
 * function the quote form and the server use. A second arithmetic here — even
 * "base × (1 + percent/100)" typed out again — is how a screen ends up promising
 * a price the saved document does not carry.
 */
export function PriceListDetail({ list, items, products, assigned, allCompanies, canManage }: Props) {
  const t = useTranslations("priceLists.detail");
  const tl = useTranslations("priceLists");
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

  return (
    <>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href="/dashboard/sales/price-lists"
            className="mb-3 inline-flex items-center gap-1 text-muted-foreground text-sm transition-colors hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
            {t("back")}
          </Link>
          <h1 className="flex min-w-0 items-center gap-2 font-bold text-2xl tracking-tight">
            <Tags className="h-5 w-5 shrink-0 text-primary" />
            <span className="min-w-0 break-words">{record.name}</span>
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <AdjustmentText adjustmentPercent={record.adjustmentPercent} />
            {!record.isActive && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs">
                {tl("filters.inactive")}
              </span>
            )}
          </div>
          {record.description && <p className="mt-1 text-muted-foreground text-sm">{record.description}</p>}
        </div>
        {canManage && (
          <Button variant="outline" onClick={() => setEditOpen(true)} className="gap-1.5">
            <Pencil className="h-3.5 w-3.5" />
            {t("edit")}
          </Button>
        )}
      </div>

      <PriceList
        rules={rules}
        priced={priced}
        products={products}
        canManage={canManage}
        onChanged={setRows}
        formatAmount={formatAmount}
        startTransition={startTransition}
      />

      <PercentagePreview rules={rules} products={products} formatAmount={formatAmount} />

      <Customers
        listId={record.id}
        customers={customers}
        allCompanies={allCompanies}
        canManage={canManage}
        onChanged={setCustomers}
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
  const [productId, setProductId] = useState("");
  const [draftPrice, setDraftPrice] = useState("");
  const [saving, setSaving] = useState(false);

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

  return (
    <section className="space-y-3">
      <div className="min-w-0">
        <h2 className="font-semibold text-lg">{t("pricesTitle")}</h2>
        <p className="text-muted-foreground text-sm">{t("pricesSubtitle")}</p>
      </div>

      {canManage && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/10 p-3">
          <div className="min-w-0 flex-1 space-y-1.5">
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
          <div className="w-32 space-y-1.5">
            <Label className="text-xs">{t("listPrice")}</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={draftPrice}
              onChange={(e) => setDraftPrice(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <Button onClick={add} disabled={!productId || draftPrice === "" || saving} className="gap-1.5">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-4 w-4" />}
            {t("addPrice")}
          </Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-muted-foreground text-xs">
              <th className="px-4 py-2.5 text-left font-medium">{t("product")}</th>
              <th className="hidden px-4 py-2.5 text-left font-medium sm:table-cell">{t("sku")}</th>
              <th className="px-4 py-2.5 text-right font-medium">{t("basePrice")}</th>
              <th className="px-4 py-2.5 text-right font-medium">{t("listPrice")}</th>
              <th className="hidden px-4 py-2.5 text-right font-medium md:table-cell">{t("difference")}</th>
              <th className="w-12 px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {priced.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-0">
                  <EmptyState icon={Package} title={t("noPrices")} description={t("noPricesDesc")} />
                </td>
              </tr>
            ) : (
              priced.map(({ row, base, price, difference }) => (
                <tr key={row.productId} className="group transition-colors hover:bg-muted/30">
                  <td className="px-4 py-2.5">
                    <p className={cn("font-medium", !row.isActive && "text-muted-foreground")}>{row.productName}</p>
                  </td>
                  <td className="hidden px-4 py-2.5 sm:table-cell">
                    {row.productSku ? (
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{row.productSku}</span>
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right text-muted-foreground tabular-nums">{formatAmount(base)}</td>
                  <td className="px-4 py-2.5 text-right">
                    {canManage ? (
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        defaultValue={price}
                        // ⚠️ Saved on blur and on Enter, not on every keystroke: a
                        // statement per character is a write per character, and the
                        // half-typed figures in between are all real prices.
                        onBlur={(e) => save(row, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                        }}
                        className="ml-auto h-8 w-28 text-right tabular-nums"
                      />
                    ) : (
                      <span className="font-semibold tabular-nums">{formatAmount(price)}</span>
                    )}
                  </td>
                  <td
                    className={cn(
                      "hidden px-4 py-2.5 text-right tabular-nums md:table-cell",
                      difference < 0 && "text-emerald-600 dark:text-emerald-400",
                      difference > 0 && "text-amber-600 dark:text-amber-400",
                      difference === 0 && "text-muted-foreground",
                    )}
                  >
                    {difference === 0 ? "—" : formatAmount(difference)}
                  </td>
                  <td className="px-4 py-2.5">
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                        onClick={() => remove(row)}
                        title={t("removePrice")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
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
    <section className="space-y-3">
      <div className="min-w-0">
        <h2 className="font-semibold text-lg">{t("previewTitle")}</h2>
        <p className="text-muted-foreground text-sm">{t("previewSubtitle")}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-lg border p-3 sm:grid-cols-2">
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
      </div>
    </section>
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
  const [companyId, setCompanyId] = useState("");
  const [busy, setBusy] = useState(false);

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

  return (
    <section className="space-y-3">
      <div className="min-w-0">
        <h2 className="font-semibold text-lg">{t("customersTitle")}</h2>
        <p className="text-muted-foreground text-sm">{t("customersSubtitle")}</p>
      </div>

      {canManage && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/10 p-3">
          <div className="min-w-0 flex-1 space-y-1.5">
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
          <Button onClick={add} disabled={!companyId || busy} className="gap-1.5">
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
        <ul className="divide-y rounded-md border">
          {customers.map((company) => (
            <li key={company.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <Link href={`/dashboard/companies/${company.id}`} className="min-w-0 truncate text-sm hover:underline">
                {company.name}
              </Link>
              {canManage && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => remove(company)}
                  disabled={busy}
                  title={t("removeCustomer")}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
