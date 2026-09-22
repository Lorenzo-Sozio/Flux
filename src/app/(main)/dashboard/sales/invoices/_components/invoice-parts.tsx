"use client";

import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { PriceSourceBadge } from "@/components/crm/price-list-note";
import { listPriceSource } from "@/components/crm/use-price-rules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { invoiceTotals } from "@/lib/fatturapa/totals";
import { NATURE_CODES } from "@/lib/invoice-rules";
import { type PriceRules, priceFor } from "@/lib/price-list";
import { STAMP_DUTY_AMOUNT } from "@/lib/stamp-duty";

import { blankLine, type CatalogueProduct, type EditableLine, num } from "./invoice-lines";

/**
 * The pieces the new-invoice page and the draft page share: the line editor and
 * the totals. One copy, so the two screens cannot total the same lines differently.
 */

type Totals = ReturnType<typeof invoiceTotals>;

const NO_NATURE = "none";
const OFF_CATALOGUE = "__custom__";

export function InvoiceLinesTable({
  lines,
  onChange,
  editable,
  totals,
  rechargeLine,
  money,
  products,
  priceRules,
}: {
  lines: EditableLine[];
  onChange: (lines: EditableLine[]) => void;
  editable: boolean;
  totals: Totals;
  rechargeLine: boolean;
  money: (n: number) => string;
  /** Given, each line can be picked from the catalogue. */
  products?: CatalogueProduct[];
  /**
   * Given, the customer's price list prices the product as it is picked.
   *
   * ⚠️ It reaches no line that already exists. An invoice line may have come
   * from an order, or from somebody's hands; re-pricing it here would change a
   * figure the customer has already been told, invisibly.
   */
  priceRules?: PriceRules | null;
}) {
  const t = useTranslations("invoices");
  const put = (i: number, patch: Partial<EditableLine>) =>
    onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const pick = (i: number, value: string) => {
    if (value === OFF_CATALOGUE) return put(i, { productId: null });
    const p = products?.find((x) => x.id === value);
    if (!p) return;
    put(i, {
      productId: p.id,
      description: lines[i].description.trim() ? lines[i].description : p.name,
      unitPrice: String(priceFor(p.id, p.price, priceRules)),
      taxPercent: String(p.taxPercent),
      nature: p.taxPercent > 0 ? "" : lines[i].nature,
    });
  };
  const productOptions = products
    ? [
        { value: OFF_CATALOGUE, label: t("offCatalogue") },
        ...products.map((p) => ({ value: p.id, label: p.name, sublabel: p.sku ?? undefined })),
      ]
    : [];

  return (
    <>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {editable && products && <TableHead className="min-w-48">{t("product")}</TableHead>}
              <TableHead className="min-w-56">{t("description")}</TableHead>
              <TableHead className="w-24 text-right">{t("quantity")}</TableHead>
              <TableHead className="w-28 text-right">{t("unitPrice")}</TableHead>
              <TableHead className="w-20 text-right">{t("discount")}</TableHead>
              <TableHead className="w-20 text-right">{t("vat")}</TableHead>
              <TableHead className="w-40">{t("nature")}</TableHead>
              <TableHead className="w-28 text-right">{t("net")}</TableHead>
              {editable && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l, i) => (
              <TableRow key={l.key}>
                {editable && products && (
                  <TableCell>
                    <SearchableSelect
                      options={productOptions}
                      value={l.productId ?? OFF_CATALOGUE}
                      onChange={(v) => pick(i, v)}
                      placeholder={t("offCatalogue")}
                      searchPlaceholder={t("searchProduct")}
                      emptyText={t("noProducts")}
                    />
                  </TableCell>
                )}
                <TableCell>
                  {editable ? (
                    <Input
                      aria-label={t("description")}
                      value={l.description}
                      placeholder={t("descriptionPlaceholder")}
                      onChange={(e) => put(i, { description: e.target.value })}
                    />
                  ) : (
                    l.description
                  )}
                </TableCell>
                {(["quantity", "unitPrice", "discountPercent", "taxPercent"] as const).map((f) => (
                  <TableCell key={f} className="text-right tabular-nums">
                    {f === "unitPrice" && (
                      <PriceSourceBadge
                        source={listPriceSource(
                          priceRules,
                          products?.find((p) => p.id === l.productId),
                          l.unitPrice,
                        )}
                        listName={priceRules?.name}
                        className="mb-1"
                      />
                    )}
                    {editable ? (
                      <Input
                        aria-label={t(f === "discountPercent" ? "discount" : f === "taxPercent" ? "vat" : f)}
                        inputMode="decimal"
                        className="text-right"
                        value={l[f]}
                        onChange={(e) => put(i, { [f]: e.target.value })}
                      />
                    ) : (
                      l[f]
                    )}
                  </TableCell>
                ))}
                <TableCell>
                  {editable && num(l.taxPercent) === 0 ? (
                    <Select
                      value={l.nature || NO_NATURE}
                      onValueChange={(v) => put(i, { nature: v === NO_NATURE ? "" : v })}
                    >
                      <SelectTrigger aria-label={t("nature")} className="h-9 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_NATURE}>{t("chooseNature")}</SelectItem>
                        {Object.entries(NATURE_CODES).map(([code, label]) => (
                          <SelectItem key={code} value={code}>
                            {code} — {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="font-mono text-xs">{l.nature || "—"}</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{money(totals.details[i]?.total ?? 0)}</TableCell>
                {editable && (
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={t("removeLine")}
                      onClick={() => onChange(lines.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {rechargeLine && (
              <TableRow className="bg-muted/30 text-muted-foreground">
                {editable && products && <TableCell />}
                <TableCell>
                  {t("stampLine")}
                  <span className="ml-2 text-[11px]">({t("stampLineAuto")})</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">1</TableCell>
                <TableCell className="text-right tabular-nums">{STAMP_DUTY_AMOUNT}</TableCell>
                <TableCell className="text-right tabular-nums">0</TableCell>
                <TableCell className="text-right tabular-nums">0</TableCell>
                <TableCell>
                  <span className="font-mono text-xs">N1</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{money(STAMP_DUTY_AMOUNT)}</TableCell>
                {editable && <TableCell />}
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {editable && (
        <div className="p-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() => onChange([...lines, blankLine()])}
          >
            <Plus className="h-3.5 w-3.5" /> {t("addLine")}
          </Button>
        </div>
      )}
    </>
  );
}

export function InvoiceTotals({ totals, money }: { totals: Totals; money: (n: number) => string }) {
  const t = useTranslations("invoices");
  return (
    <div className="space-y-2 text-sm tabular-nums">
      <div className="flex justify-between gap-3">
        <span>{t("subtotal")}</span>
        <span>{money(totals.subtotal)}</span>
      </div>
      {totals.discountAmount > 0 && (
        <div className="flex justify-between gap-3">
          <span>{t("documentDiscount")}</span>
          <span>−{money(totals.discountAmount)}</span>
        </div>
      )}
      {totals.summary.map((r) => (
        <div key={`${r.rate}-${r.nature ?? ""}`} className="flex justify-between gap-3 text-muted-foreground">
          <span className="min-w-0">
            {t("vat")} {r.rate}% {r.nature ? `(${r.nature}) ` : ""}
            {t("on")} {money(r.taxable)}
          </span>
          <span>{money(r.tax)}</span>
        </div>
      ))}
      <div className="flex justify-between gap-3 border-t pt-2 font-semibold text-base">
        <span>{t("total")}</span>
        <span>{money(totals.total)}</span>
      </div>
    </div>
  );
}
