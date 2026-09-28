import { round2 } from "@/lib/document-totals";
import { type InvoiceLine, invoiceTotals, shareOut } from "@/lib/fatturapa/totals";
import type { DraftLineInput } from "@/lib/invoice-draft";

/**
 * A deposit invoice (TD02) and the balance invoice that takes it off (I11, decision R6).
 *
 * The customer pays part of the order in advance. A payment received before the supply has to
 * be invoiced when it arrives — that is the deposit invoice. The invoice for the rest lists the
 * whole order and takes each deposit invoice off it, one line per VAT rate, citing it; so the
 * two together are the order, and nothing is invoiced twice.
 *
 * ⚠️⚠️ **Split by rate, like the order.** A deposit on an order with goods at 22% and 10% is
 * 22% and 10% in the same proportion: VAT on a deposit is due at the rates of what it pays for.
 * One line per (rate, Natura) of the order, the gross shared out to the cent.
 *
 * ⚠️⚠️ **The deduction is the deposit's taxable, per rate.** Taking off the deposit's gross, or
 * one line at one rate, would leave VAT charged twice on the part already invoiced. The lines
 * are generated, never typed: `isDeduction` keeps them out of the document discount (a discount
 * on what was already invoiced) and out of what a person can edit.
 */

/** A line taken off a balance invoice: one deposit invoice, one VAT rate. */
export interface DeductionLine extends InvoiceLine {
  isDeduction: true;
  depositInvoiceId: string;
}

/** An issued deposit invoice, as a balance invoice reads it. */
export interface IssuedDeposit {
  id: string;
  documentNumber: string | null;
  issueDate: string | null;
  discountPercent: number;
  lines: InvoiceLine[];
}

/**
 * The lines of a deposit invoice for `gross` (VAT included) on an order whose lines are
 * `orderLines`: one per (rate, Natura), each the order's share of that rate.
 *
 * Returns null when the order totals nothing or the amount is not positive. The deposit's
 * total can differ from `gross` by a cent per rate — VAT is rounded per rate, as SDI checks it.
 */
export function depositLines(
  orderLines: readonly InvoiceLine[],
  orderDiscountPercent: number,
  gross: number,
  describe: (rate: number, nature: string | null, several: boolean) => string,
): DraftLineInput[] | null {
  if (!(gross > 0)) return null;
  const order = invoiceTotals(orderLines, orderDiscountPercent);
  const groups = order.summary.filter((g) => g.taxable + g.tax > 0);
  const orderGross = round2(groups.reduce((s, g) => s + g.taxable + g.tax, 0));
  if (!(orderGross > 0)) return null;
  const shares = shareOut(
    gross,
    groups.map((g) => g.taxable + g.tax),
  );
  const several = groups.length > 1;
  return groups
    .map((g, i) => ({
      description: describe(g.rate, g.nature, several),
      quantity: 1,
      unitPrice: round2(shares[i] / (1 + g.rate / 100)),
      discountPercent: 0,
      taxPercent: g.rate,
      nature: g.nature,
    }))
    .filter((l) => l.unitPrice > 0);
}

/**
 * The lines a balance invoice takes off for these deposit invoices: each deposit's taxable per
 * (rate, Natura), negative, citing the deposit. A deposit's stamp duty recharge is its own
 * charge and is not taken off.
 */
export function deductionLines(
  deposits: readonly IssuedDeposit[],
  describe: (documentNumber: string, issueDate: string) => string,
): DeductionLine[] {
  return deposits.flatMap((d) => {
    const own = d.lines.filter((l) => !l.isStampRecharge);
    return invoiceTotals(own, d.discountPercent)
      .summary.filter((g) => g.taxable > 0)
      .map((g) => ({
        description: describe(d.documentNumber ?? "", d.issueDate ?? ""),
        quantity: 1,
        unitPrice: -g.taxable,
        discountPercent: 0,
        taxPercent: g.rate,
        nature: g.nature,
        isDeduction: true as const,
        depositInvoiceId: d.id,
      }));
  });
}

/**
 * What a balance invoice leaves of each rate once its deposits are off. A rate taken below zero
 * means the order changed after the deposit was invoiced: the balance cannot be issued as it is.
 */
export function deductionExceeds(lines: readonly InvoiceLine[], discountPercent: number): boolean {
  return invoiceTotals(lines, discountPercent).summary.some((g) => g.taxable < 0);
}
