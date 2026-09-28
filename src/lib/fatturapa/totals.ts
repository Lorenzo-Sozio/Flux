import { computeLine, round2 } from "@/lib/document-totals";

/**
 * An invoice's figures the way SDI checks them.
 *
 * ⚠️⚠️ Not `computeDocument`, which quotes and orders use. That one rounds VAT line
 * by line and spreads the document discount inside each line. SDI does neither:
 *
 *   * **Imposta is checked per rate** — ImponibileImporto × AliquotaIVA, within a
 *     cent. Rounding each line and adding the results drifts by more than a cent
 *     once an invoice has enough lines, and the invoice is rejected.
 *   * **ImponibileImporto must equal the sum of the lines' PrezzoTotale.** A discount
 *     that exists only on the document header breaks that equality.
 *
 * So VAT is computed once per (rate, Natura) group, and the document discount is
 * written as one negative line per group, shared out to the cent by largest
 * remainder so the shares add up exactly to the discount. The draft screen, the
 * issued totals and the XML all read these figures, so what the customer sees is
 * what SDI receives.
 */

export interface InvoiceLine {
  description: string;
  quantity: number;
  unitPrice: number;
  discountPercent?: number | null;
  taxPercent: number;
  nature?: string | null;
  isStampRecharge?: boolean;
  /** A balance invoice's line taking a deposit invoice off (src/lib/invoice-deposits.ts). */
  isDeduction?: boolean;
  depositInvoiceId?: string;
}

export interface DetailLine {
  description: string;
  /** Absent on a document discount line, which is a single amount. */
  quantity: number | null;
  unitPrice: number;
  discountPercent: number;
  /** PrezzoTotale: quantity × price − line discount, or the negative discount share. */
  total: number;
  rate: number;
  nature: string | null;
  isDocumentDiscount: boolean;
}

export interface SummaryRow {
  rate: number;
  nature: string | null;
  taxable: number;
  tax: number;
}

export interface InvoiceTotals {
  details: DetailLine[];
  summary: SummaryRow[];
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  taxAmount: number;
  total: number;
}

const groupKey = (rate: number, nature: string | null) => `${rate}|${nature ?? ""}`;

/** Shares `amount` out in proportion to `weights`, in cents, adding up exactly. */
export function shareOut(amount: number, weights: readonly number[]): number[] {
  const cents = Math.round(amount * 100);
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum <= 0 || cents === 0) return weights.map(() => 0);
  const exact = weights.map((w) => (cents * w) / sum);
  const floors = exact.map(Math.floor);
  let left = cents - floors.reduce((s, f) => s + f, 0);
  const order = exact.map((e, i) => ({ i, r: e - floors[i] })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors.map((f) => f / 100);
}

export function invoiceTotals(lines: readonly InvoiceLine[], documentDiscountPercent = 0): InvoiceTotals {
  const details: DetailLine[] = lines.map((l) => {
    const t = computeLine(l);
    return {
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountPercent: l.discountPercent ?? 0,
      total: t.net,
      rate: l.taxPercent,
      nature: l.taxPercent === 0 ? (l.nature ?? null) : null,
      isDocumentDiscount: false,
    };
  });

  // `own` is what the document discount applies to: every line but the stamp recharge — a
  // fixed legal amount — and a deposit taken off, which was invoiced (and discounted) already.
  const groups = new Map<string, { rate: number; nature: string | null; net: number; own: number }>();
  details.forEach((d, i) => {
    const key = groupKey(d.rate, d.nature);
    const g = groups.get(key) ?? { rate: d.rate, nature: d.nature, net: 0, own: 0 };
    g.net = round2(g.net + d.total);
    if (!lines[i].isStampRecharge && !lines[i].isDeduction) g.own = round2(g.own + d.total);
    groups.set(key, g);
  });
  const list = [...groups.values()];
  const subtotal = round2(list.reduce((s, g) => s + g.net, 0));
  const discountable = list.map((g) => Math.max(0, g.own));
  const discountAmount = round2((discountable.reduce((s, n) => s + n, 0) * (documentDiscountPercent ?? 0)) / 100);
  const shares = shareOut(discountAmount, discountable);

  const summary: SummaryRow[] = list.map((g, i) => {
    const taxable = round2(g.net - shares[i]);
    return { rate: g.rate, nature: g.nature, taxable, tax: round2((taxable * g.rate) / 100) };
  });

  if (documentDiscountPercent) {
    list.forEach((g, i) => {
      if (shares[i] <= 0) return;
      details.push({
        description: `Sconto sul documento ${documentDiscountPercent}%`,
        quantity: null,
        unitPrice: -shares[i],
        discountPercent: 0,
        total: -shares[i],
        rate: g.rate,
        nature: g.nature,
        isDocumentDiscount: true,
      });
    });
  }

  const taxableAmount = round2(summary.reduce((s, r) => s + r.taxable, 0));
  const taxAmount = round2(summary.reduce((s, r) => s + r.tax, 0));
  return {
    details,
    summary: summary.sort((a, b) => a.rate - b.rate || (a.nature ?? "").localeCompare(b.nature ?? "")),
    subtotal,
    discountAmount,
    taxableAmount,
    taxAmount,
    total: round2(taxableAmount + taxAmount),
  };
}
