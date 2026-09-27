"use client";

import { useState } from "react";

import { ChevronDown, Plus, Trash2 } from "lucide-react";
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
import { cn } from "@/lib/utils";

import { blankLine, type CatalogueProduct, type EditableLine, num } from "./invoice-lines";

/**
 * The pieces the new-invoice page and the draft page share: the line editor and
 * the totals. One copy, so the two screens cannot total the same lines differently.
 */

type Totals = ReturnType<typeof invoiceTotals>;

const NO_NATURE = "none";
const OFF_CATALOGUE = "__custom__";
const NUMERIC_FIELDS = ["quantity", "unitPrice", "discountPercent", "taxPercent"] as const;

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
  const tLine = useTranslations("orders.form");
  // On a phone one line is open for editing at a time; the others are summary
  // rows. Keyed by the line's own key, so removing a line above does not open
  // a different one.
  const [openKey, setOpenKey] = useState<string | null>(null);
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

  /** The Natura control, or its code when there is nothing to choose. Shared by the table and the cards. */
  const natureField = (l: EditableLine, i: number) =>
    editable && num(l.taxPercent) === 0 ? (
      <Select value={l.nature || NO_NATURE} onValueChange={(v) => put(i, { nature: v === NO_NATURE ? "" : v })}>
        <SelectTrigger aria-label={t("nature")} className="h-9 w-full text-xs">
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
    );

  const numericLabel = (f: (typeof NUMERIC_FIELDS)[number]) =>
    t(f === "discountPercent" ? "discount" : f === "taxPercent" ? "vat" : f);

  return (
    <>
      {/*
        ⚠️ Below `md` a line is a card, not a row. Nine columns of inputs scrolled
        sideways inside a phone meant typing a price with the description off one
        edge and the net off the other. The card carries the same controls, bound
        to the same `put`, so the two layouts cannot disagree about a line — only
        about where its fields are drawn.
      */}
      <ul className="space-y-3 p-3 md:hidden">
        {lines.map((l, i) => (
          <li key={l.key} className="rounded-lg border bg-muted/20 p-3">
            {/* ⚠️ Editable, a line is a summary row that opens: six inputs a line,
                open for every line, made a three-line invoice longer than the
                screen three times over. */}
            <div className={cn("flex items-center justify-between gap-2", (!editable || openKey === l.key) && "mb-3")}>
              {editable ? (
                <button
                  type="button"
                  onClick={() => setOpenKey(openKey === l.key ? null : l.key)}
                  aria-expanded={openKey === l.key}
                  className="flex min-h-11 min-w-0 flex-1 flex-col items-start justify-center gap-0.5 text-left"
                >
                  <span className="flex items-center gap-1.5 font-medium text-muted-foreground text-xs">
                    {tLine("line", { number: i + 1 })}
                    <ChevronDown
                      className={cn("size-3.5 transition-transform", openKey === l.key && "rotate-180")}
                      aria-hidden
                    />
                  </span>
                  {openKey !== l.key && (
                    <span className="max-w-full truncate font-medium text-sm">
                      {l.description || t("descriptionPlaceholder")}
                    </span>
                  )}
                  {openKey !== l.key && (
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {l.quantity} × {l.unitPrice} · {t("vat")} {l.taxPercent}
                    </span>
                  )}
                </button>
              ) : (
                <span className="font-medium text-muted-foreground text-xs">{tLine("line", { number: i + 1 })}</span>
              )}
              <div className="flex shrink-0 items-center gap-1">
                <span className="font-semibold text-sm tabular-nums">{money(totals.details[i]?.total ?? 0)}</span>
                {editable && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="-my-1 h-9 w-9 text-muted-foreground hover:text-destructive"
                    aria-label={t("removeLine")}
                    onClick={() => onChange(lines.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>

            {editable ? (
              <div className={cn("grid grid-cols-2 gap-x-3 gap-y-3", openKey !== l.key && "hidden")}>
                {products && (
                  <div className="col-span-2 space-y-1.5">
                    <p className="font-medium text-xs">{t("product")}</p>
                    <SearchableSelect
                      options={productOptions}
                      value={l.productId ?? OFF_CATALOGUE}
                      onChange={(v) => pick(i, v)}
                      placeholder={t("offCatalogue")}
                      searchPlaceholder={t("searchProduct")}
                      emptyText={t("noProducts")}
                    />
                  </div>
                )}
                <div className="col-span-2 space-y-1.5">
                  <p className="font-medium text-xs">{t("description")}</p>
                  <Input
                    aria-label={t("description")}
                    value={l.description}
                    placeholder={t("descriptionPlaceholder")}
                    onChange={(e) => put(i, { description: e.target.value })}
                  />
                </div>
                {NUMERIC_FIELDS.map((f) => (
                  <div key={f} className="min-w-0 space-y-1.5">
                    <p className="font-medium text-xs">{numericLabel(f)}</p>
                    <Input
                      aria-label={numericLabel(f)}
                      inputMode="decimal"
                      className="text-right tabular-nums"
                      value={l[f]}
                      onChange={(e) => put(i, { [f]: e.target.value })}
                    />
                    {f === "unitPrice" && (
                      <PriceSourceBadge
                        source={listPriceSource(
                          priceRules,
                          products?.find((p) => p.id === l.productId),
                          l.unitPrice,
                        )}
                        listName={priceRules?.name}
                      />
                    )}
                  </div>
                ))}
                {num(l.taxPercent) === 0 && (
                  <div className="col-span-2 space-y-1.5">
                    <p className="font-medium text-xs">{t("nature")}</p>
                    {natureField(l, i)}
                  </div>
                )}
              </div>
            ) : (
              <>
                <p className="break-words text-sm">{l.description}</p>
                <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground text-xs tabular-nums">
                  <span>
                    {l.quantity} × {l.unitPrice}
                  </span>
                  {num(l.discountPercent) !== 0 && (
                    <span>
                      {t("discount")} {l.discountPercent}
                    </span>
                  )}
                  <span>
                    {t("vat")} {l.taxPercent}
                  </span>
                  {l.nature && <span className="font-mono">{l.nature}</span>}
                </p>
              </>
            )}
          </li>
        ))}
        {rechargeLine && (
          <li className="flex items-start justify-between gap-3 rounded-lg border bg-muted/30 p-3 text-muted-foreground text-sm">
            <div className="min-w-0">
              <p className="break-words">{t("stampLine")}</p>
              <p className="mt-0.5 text-[11px]">
                {t("stampLineAuto")} · <span className="font-mono">N1</span>
              </p>
            </div>
            <span className="shrink-0 tabular-nums">{money(STAMP_DUTY_AMOUNT)}</span>
          </li>
        )}
      </ul>

      <div className="hidden overflow-x-auto md:block">
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
                {NUMERIC_FIELDS.map((f) => (
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
                        aria-label={numericLabel(f)}
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
                <TableCell>{natureField(l, i)}</TableCell>
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
        <div className="p-3 pt-0 md:pt-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full gap-1 md:w-auto"
            onClick={() => {
              const line = blankLine();
              onChange([...lines, line]);
              setOpenKey(line.key);
            }}
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
