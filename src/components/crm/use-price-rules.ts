"use client";

import { useEffect, useRef, useState } from "react";

import { getCompanyPriceRules, getPriceRules } from "@/actions/price-lists";
import { type PriceRules, priceProduct } from "@/lib/price-list";

/**
 * use-price-rules.ts — the price list a document is being written against.
 *
 * One hook rather than five copies, because the rule it carries is not "fetch a
 * list": it is *when* to fetch one, and a copy of that in every form is a copy
 * that stops agreeing with the others the first time one of them is edited.
 *
 * ⚠️ **Fetched when the customer changes, never shipped with the form.** A
 * workspace that imported a supplier's catalogue has thousands of prices in a
 * list; sending them with the new-quote page would cost every reader that
 * payload to price the two lines they were going to write. And the customer on
 * a quote or an order can change after the lines exist, so the answer cannot be
 * decided once on the server either.
 *
 * ⚠️ **What comes back prices the *next* line the reader picks, and nothing
 * else.** A price already on a line may have been typed by hand, and a form
 * that quietly rewrote it would change a figure the reader had agreed with the
 * customer, with nothing on the screen to say it had happened. Re-pricing is a
 * button somebody presses.
 */
export function usePriceRules(
  companyId: string | null | undefined,
  /** An explicit list, for a screen that chooses one instead of following the customer. */
  priceListId?: string | null,
): { rules: PriceRules | null; loading: boolean } {
  const [rules, setRules] = useState<PriceRules | null>(null);
  const [loading, setLoading] = useState(false);
  // Keyed by what was asked for, not by the list that came back: "this company
  // is on no list" is an answer worth remembering too, and it has no list id.
  const cache = useRef(new Map<string, PriceRules | null>());

  useEffect(() => {
    const key = priceListId ? `list:${priceListId}` : companyId ? `company:${companyId}` : null;
    if (!key) {
      setRules(null);
      setLoading(false);
      return;
    }

    const cached = cache.current.get(key);
    if (cached !== undefined) {
      setRules(cached);
      setLoading(false);
      return;
    }

    // ⚠️ The customer can be changed twice in a second. Without this flag the
    // slower of the two answers wins and the form prices against the wrong
    // list — silently, because both requests succeeded.
    let current = true;
    setLoading(true);
    (priceListId ? getPriceRules(priceListId) : getCompanyPriceRules(companyId as string))
      .then((r) => {
        cache.current.set(key, r ?? null);
        if (current) setRules(r ?? null);
      })
      // A list that cannot be read is catalogue prices, not a broken form: the
      // reader can still write the quote, and every price is one they can see.
      .catch(() => {
        if (current) setRules(null);
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => {
      current = false;
    };
  }, [companyId, priceListId]);

  return { rules, loading };
}

/** The least a picker needs to know about a product to price it. */
export interface PriceableProduct {
  id: string;
  price: string | number;
}

/**
 * Where the price on a line came from, or null when it did not come from the list.
 *
 * Derived from what is on the line rather than remembered from the moment the
 * product was picked: a line can be removed, reordered or retyped, and a
 * remembered flag would outlive all three and go on claiming a figure came from
 * the list after somebody replaced it by hand.
 */
export function listPriceSource(
  rules: PriceRules | null | undefined,
  product: PriceableProduct | null | undefined,
  unitPrice: string | number | null | undefined,
): "percent" | "override" | null {
  if (!rules || !product) return null;
  const priced = priceProduct(product.id, product.price, rules);
  if (priced.source === "base") return null;
  const shown = typeof unitPrice === "number" ? unitPrice : Number.parseFloat(String(unitPrice ?? ""));
  if (!Number.isFinite(shown)) return null;
  // Half a cent: both figures are already rounded to the cent, so anything
  // further apart than that is a price somebody changed.
  return Math.abs(priced.price - shown) < 0.005 ? priced.source : null;
}
