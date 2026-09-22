/**
 * price-list.ts — what a customer pays for a product.
 *
 * Two rules, in this order (decision D4):
 *
 *  1. a price written for that product in the list wins outright;
 *  2. otherwise the list's percentage moves the catalogue price.
 *
 * ⚠️ **The percentage is a direction, not a discount.** −10 is ten per cent off, +5 is
 * five per cent on top. Every other percentage in this product (`discountPercent` on a
 * quote, an order, an invoice line) means a reduction, so reading this one the same way
 * turns every price list into its own opposite — which is why it is called
 * `adjustmentPercent` everywhere and why `fromPriceList` carries the sign in its name.
 *
 * ⚠️ **A price is money, so it is rounded to the cent here**, not where it is shown.
 * `product.price` and `price_list_item.unit_price` are `numeric(12,2)`: a figure with
 * three decimals cannot be stored, and one that is rounded only on screen is a total
 * that does not add up.
 *
 * Pure, and shared: the forms price a line in the browser as the reader picks the
 * product, and the server prices the same line again when it saves. Both call this.
 */

/** A list, flattened to what pricing needs: the percentage and the prices that beat it. */
export interface PriceRules {
  id: string;
  name: string;
  /** Signed: negative takes money off the base price, positive adds it. */
  adjustmentPercent: number;
  /** Product id → the price this list gives that product. */
  overrides: Record<string, number>;
}

/** Half-up to the cent, the same rounding the document totals use. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function num(value: string | number | null | undefined): number {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * The price of one product, and where it came from.
 *
 * `source` is what the screen shows the reader: a price they can see the reason for is
 * one they can defend to the customer on the telephone.
 */
export interface PricedProduct {
  price: number;
  source: "base" | "percent" | "override";
}

export function priceProduct(
  productId: string,
  basePrice: string | number | null | undefined,
  rules: PriceRules | null | undefined,
): PricedProduct {
  const base = round2(num(basePrice));
  if (!rules) return { price: base, source: "base" };

  const override = rules.overrides[productId];
  if (override !== undefined && Number.isFinite(override)) {
    // A price written by hand is taken as written, including zero — a product given
    // away in a contract is a real agreement, and silently charging for it is worse
    // than showing nothing.
    return { price: round2(Math.max(0, override)), source: "override" };
  }

  const percent = num(rules.adjustmentPercent);
  if (percent === 0) return { price: base, source: "base" };

  // ⚠️ Below −100% the arithmetic would pay the customer to take the goods. A list
  // that says so is a mistake nobody typed on purpose, so the price stops at zero.
  return { price: round2(Math.max(0, base * (1 + percent / 100))), source: "percent" };
}

/** Just the figure, for callers that do not show where it came from. */
export function priceFor(
  productId: string,
  basePrice: string | number | null | undefined,
  rules: PriceRules | null | undefined,
): number {
  return priceProduct(productId, basePrice, rules).price;
}

/**
 * What the adjustment reads as in a sentence: "10% off", "5% on top", or nothing.
 * Returned as data — the sign and the figure — so the screen can put it in the
 * reader's own language.
 */
export function adjustmentLabel(adjustmentPercent: string | number | null | undefined): {
  direction: "off" | "on" | "none";
  percent: number;
} {
  const percent = round2(num(adjustmentPercent));
  if (percent === 0) return { direction: "none", percent: 0 };
  return percent < 0 ? { direction: "off", percent: Math.abs(percent) } : { direction: "on", percent };
}

/** The bounds a list's percentage is accepted within, used by the form and the action. */
export const MIN_ADJUSTMENT = -100;
export const MAX_ADJUSTMENT = 100;
