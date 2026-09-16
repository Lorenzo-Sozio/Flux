/**
 * Invoice figures, checked the way SDI checks them.
 *
 * ⚠️ Each property below is a rejection code at SDI: tax per rate, taxable equal to
 * the sum of line totals, a discount that adds up.
 */
import { describe, expect, it } from "vitest";

import { invoiceTotals, shareOut } from "./totals";

const line = (over: Partial<Parameters<typeof invoiceTotals>[0][number]> = {}) => ({
  description: "Voce",
  quantity: 1,
  unitPrice: 100,
  taxPercent: 22,
  ...over,
});

const sum = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100;

describe("the checks SDI makes", () => {
  it("⚠️⚠️ computes VAT once per rate, not line by line", () => {
    // 33 lines of €0.15 at 22%: 0.033 each rounds to 0.03, so line-by-line gives
    // €0.99, while the rate applied to the €4.95 taxable is €1.09.
    const t = invoiceTotals(Array.from({ length: 33 }, () => line({ unitPrice: 0.15 })));
    expect(t.summary).toEqual([{ rate: 22, nature: null, taxable: 4.95, tax: 1.09 }]);
    expect(t.total).toBe(6.04);
  });

  it("⚠️⚠️ keeps each group's taxable equal to the sum of its lines' totals, discount lines included", () => {
    const t = invoiceTotals(
      [
        line({ unitPrice: 333.33 }),
        line({ unitPrice: 101.01, taxPercent: 10 }),
        line({ unitPrice: 55.55, taxPercent: 0, nature: "N4" }),
      ],
      7,
    );
    for (const row of t.summary) {
      const lines = t.details.filter((d) => d.rate === row.rate && d.nature === row.nature);
      expect(sum(lines.map((d) => d.total)), `${row.rate} ${row.nature}`).toBe(row.taxable);
      expect(row.tax).toBe(Math.round(row.taxable * row.rate) / 100);
    }
  });

  it("⚠️⚠️ writes the document discount as negative lines that add up to it exactly", () => {
    const t = invoiceTotals(
      [line({ unitPrice: 100 }), line({ unitPrice: 100, taxPercent: 10 }), line({ unitPrice: 100, taxPercent: 4 })],
      10,
    );
    const discountLines = t.details.filter((d) => d.isDocumentDiscount);
    expect(discountLines).toHaveLength(3);
    expect(sum(discountLines.map((d) => d.total))).toBe(-30);
    expect(t.discountAmount).toBe(30);
    expect(t.taxableAmount).toBe(270);
  });

  it("⚠️ shares a discount by largest remainder so no cent is lost", () => {
    expect(shareOut(1, [1, 1, 1])).toEqual([0.34, 0.33, 0.33]);
    expect(sum(shareOut(10.01, [3, 3, 3]))).toBe(10.01);
    expect(shareOut(5, [0, 0])).toEqual([0, 0]);
  });

  it("⚠️ keeps a zero-rate line's Natura and drops it from a taxed line", () => {
    const t = invoiceTotals([line({ taxPercent: 0, nature: "N3.2" }), line({ nature: "N4" })]);
    expect(t.summary.map((r) => [r.rate, r.nature])).toEqual([
      [0, "N3.2"],
      [22, null],
    ]);
  });

  it("⚠️ never discounts the stamp recharge, a fixed legal amount", () => {
    const t = invoiceTotals(
      [
        line({ unitPrice: 200, taxPercent: 0, nature: "N1" }),
        line({ description: "Bollo", unitPrice: 2, taxPercent: 0, nature: "N1", isStampRecharge: true }),
      ],
      10,
    );
    // 10% of the €200 service only: the €2 stamp is neither discounted nor in the base.
    expect(t.discountAmount).toBe(20);
    expect(t.summary[0].taxable).toBe(182);
  });

  it("applies line discounts before anything else", () => {
    expect(invoiceTotals([line({ quantity: 3, unitPrice: 10, discountPercent: 10 })]).details[0].total).toBe(27);
  });
});
