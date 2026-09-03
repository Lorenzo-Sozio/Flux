/**
 * document-totals.ts — one arithmetic for every commercial document.
 *
 * Quotes and orders each computed their own totals, differently, and both were
 * wrong in ways the customer sees (audit rilievi C-01, C-03, C-04):
 *
 *  • The quote line total already included line tax. That figure was then summed
 *    into a field named `subtotal`, the header discount was applied to the
 *    tax-inclusive amount, and header tax was applied on top — tax on tax, and a
 *    "subtotal" on the printed document that is not a subtotal.
 *  • Quote creation converted to EUR; quote update did not, so opening and saving
 *    a non-EUR quote silently changed its value.
 *  • Orders applied no tax at all and recomputed their total by summing line
 *    prices, ignoring the tax rate held on the product.
 *
 * The rules encoded here are the ordinary ones, stated once:
 *   line net      = quantity × unitPrice − line discount
 *   document net  = Σ line net − header discount
 *   tax           = charged per rate, on the net that carries that rate
 *   total         = document net + tax
 *
 * Money is rounded to two decimals at each step a customer can read, so the
 * printed lines add up to the printed total rather than drifting by a cent.
 */

/** Rounds to cents. Half-up, matching how an invoice is read aloud. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface LineInput {
  quantity: number;
  unitPrice: number;
  discountPercent?: number | null;
  taxPercent?: number | null;
}

export interface LineTotals {
  /** quantity × unitPrice, before any discount. */
  gross: number;
  discountAmount: number;
  /** What the customer is charged for the goods: gross − discount. */
  net: number;
  taxPercent: number;
  taxAmount: number;
  /** net + tax. Shown per line only where a tax-inclusive line price is wanted. */
  total: number;
}

/** Totals for a single line, with the header discount not yet applied. */
export function computeLine(line: LineInput): LineTotals {
  const gross = round2(line.quantity * line.unitPrice);
  const discountPercent = line.discountPercent ?? 0;
  const discountAmount = round2((gross * discountPercent) / 100);
  const net = round2(gross - discountAmount);
  const taxPercent = line.taxPercent ?? 0;
  const taxAmount = round2((net * taxPercent) / 100);

  return { gross, discountAmount, net, taxPercent, taxAmount, total: round2(net + taxAmount) };
}

export interface DocumentInput {
  lines: LineInput[];
  /** Discount applied to the whole document, after line discounts. */
  discountPercent?: number | null;
  /**
   * A single rate for the whole document. Leave undefined to charge each line at
   * its own rate, which is what a document with mixed rates requires.
   */
  taxPercent?: number | null;
}

export interface TaxBreakdownRow {
  rate: number;
  /** Taxable amount at this rate, after the header discount. */
  taxable: number;
  amount: number;
}

export interface DocumentTotals {
  /** Σ line net, before the header discount. The real subtotal. */
  subtotal: number;
  discountPercent: number;
  discountAmount: number;
  /** subtotal − header discount. What tax is charged on. */
  taxableAmount: number;
  /** Per-rate breakdown — what a compliant document has to print. */
  taxBreakdown: TaxBreakdownRow[];
  taxAmount: number;
  total: number;
  /** Per-line figures, already scaled by the header discount. */
  lines: (LineTotals & { shareOfDiscount: number; netAfterDocumentDiscount: number })[];
}

/**
 * Totals for a whole document.
 *
 * The header discount is spread across the lines in proportion to their net, so
 * each tax rate is charged on the amount actually paid for goods at that rate.
 * Applying the discount only to the grand total, as the previous code did, taxes
 * an amount the customer was never charged.
 */
export function computeDocument(input: DocumentInput): DocumentTotals {
  const lines = input.lines.map(computeLine);
  const subtotal = round2(lines.reduce((sum, l) => sum + l.net, 0));

  const discountPercent = input.discountPercent ?? 0;
  const discountAmount = round2((subtotal * discountPercent) / 100);
  const taxableAmount = round2(subtotal - discountAmount);

  const factor = subtotal > 0 ? taxableAmount / subtotal : 1;

  const scaled = lines.map((l) => {
    const netAfterDocumentDiscount = round2(l.net * factor);
    return {
      ...l,
      shareOfDiscount: round2(l.net - netAfterDocumentDiscount),
      netAfterDocumentDiscount,
      // The line's own tax is recomputed on the discounted net; a header discount
      // reduces the tax due, it does not leave it charged on the pre-discount value.
      taxAmount: round2((netAfterDocumentDiscount * (input.taxPercent ?? l.taxPercent)) / 100),
      taxPercent: input.taxPercent ?? l.taxPercent,
    };
  });

  const byRate = new Map<number, TaxBreakdownRow>();
  for (const l of scaled) {
    if (l.taxPercent <= 0) continue;
    const row = byRate.get(l.taxPercent) ?? { rate: l.taxPercent, taxable: 0, amount: 0 };
    row.taxable = round2(row.taxable + l.netAfterDocumentDiscount);
    row.amount = round2(row.amount + l.taxAmount);
    byRate.set(l.taxPercent, row);
  }

  const taxBreakdown = [...byRate.values()].sort((a, b) => a.rate - b.rate);
  const taxAmount = round2(taxBreakdown.reduce((sum, r) => sum + r.amount, 0));

  return {
    subtotal,
    discountPercent,
    discountAmount,
    taxableAmount,
    taxBreakdown,
    taxAmount,
    total: round2(taxableAmount + taxAmount),
    lines: scaled.map((l) => ({ ...l, total: round2(l.netAfterDocumentDiscount + l.taxAmount) })),
  };
}

/**
 * The single effective rate, when every line carries the same one.
 *
 * Returned so a document with one rate can keep printing "VAT 22%" instead of a
 * one-row breakdown table. `null` means the document is genuinely mixed.
 */
export function singleTaxRate(totals: DocumentTotals): number | null {
  if (totals.taxBreakdown.length === 0) return 0;
  if (totals.taxBreakdown.length === 1) return totals.taxBreakdown[0].rate;
  return null;
}
