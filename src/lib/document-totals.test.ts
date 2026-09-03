/**
 * The arithmetic a customer reads off a quote or an order.
 *
 * This belongs to the same class as the other tests here: a bug does not look
 * like a failure, it looks like a document that was sent and a number that was
 * agreed. The cases below are the ones the previous implementation got wrong.
 */
import { describe, expect, it } from "vitest";

import { computeDocument, computeLine, singleTaxRate } from "./document-totals";

describe("computeLine", () => {
  it("charges tax on the discounted amount, not the list price", () => {
    const line = computeLine({ quantity: 2, unitPrice: 100, discountPercent: 10, taxPercent: 22 });

    expect(line.gross).toBe(200);
    expect(line.discountAmount).toBe(20);
    expect(line.net).toBe(180);
    expect(line.taxAmount).toBe(39.6); // 22% of 180, not of 200
    expect(line.total).toBe(219.6);
  });

  it("handles a zero rate without inventing tax", () => {
    const line = computeLine({ quantity: 3, unitPrice: 33.33, taxPercent: 0 });
    expect(line.taxAmount).toBe(0);
    expect(line.total).toBe(line.net);
  });
});

describe("computeDocument", () => {
  it("does not tax an amount that already includes tax", () => {
    // The regression that mattered: the old code summed tax-inclusive line
    // totals into `subtotal` and then applied the header rate on top.
    const totals = computeDocument({
      lines: [{ quantity: 1, unitPrice: 1000, taxPercent: 22 }],
      taxPercent: 22,
    });

    expect(totals.subtotal).toBe(1000); // net, not 1220
    expect(totals.taxAmount).toBe(220); // charged once
    expect(totals.total).toBe(1220);
  });

  it("reduces the tax due when a header discount is applied", () => {
    const totals = computeDocument({
      lines: [{ quantity: 1, unitPrice: 1000, taxPercent: 22 }],
      discountPercent: 10,
    });

    expect(totals.subtotal).toBe(1000);
    expect(totals.discountAmount).toBe(100);
    expect(totals.taxableAmount).toBe(900);
    expect(totals.taxAmount).toBe(198); // 22% of 900
    expect(totals.total).toBe(1098);
  });

  it("keeps each rate separate on a mixed-rate document", () => {
    const totals = computeDocument({
      lines: [
        { quantity: 1, unitPrice: 100, taxPercent: 22 },
        { quantity: 1, unitPrice: 100, taxPercent: 10 },
      ],
    });

    expect(totals.taxBreakdown).toEqual([
      { rate: 10, taxable: 100, amount: 10 },
      { rate: 22, taxable: 100, amount: 22 },
    ]);
    expect(totals.taxAmount).toBe(32);
    expect(totals.total).toBe(232);
    expect(singleTaxRate(totals)).toBeNull();
  });

  it("spreads a header discount across rates in proportion to net", () => {
    const totals = computeDocument({
      lines: [
        { quantity: 1, unitPrice: 300, taxPercent: 22 },
        { quantity: 1, unitPrice: 100, taxPercent: 10 },
      ],
      discountPercent: 50,
    });

    expect(totals.taxableAmount).toBe(200);
    // The 22% line keeps three quarters of the taxable base, not half of the tax.
    expect(totals.taxBreakdown).toEqual([
      { rate: 10, taxable: 50, amount: 5 },
      { rate: 22, taxable: 150, amount: 33 },
    ]);
    expect(totals.total).toBe(238);
  });

  it("makes the printed lines add up to the printed total", () => {
    const totals = computeDocument({
      lines: [
        { quantity: 3, unitPrice: 33.33, taxPercent: 22 },
        { quantity: 7, unitPrice: 1.11, discountPercent: 5, taxPercent: 22 },
      ],
      discountPercent: 3,
    });

    const summed = totals.lines.reduce((s, l) => s + l.netAfterDocumentDiscount, 0);
    expect(Math.abs(summed - totals.taxableAmount)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(totals.taxableAmount + totals.taxAmount - totals.total)).toBeLessThanOrEqual(0.01);
  });

  it("survives an empty document instead of dividing by zero", () => {
    const totals = computeDocument({ lines: [], discountPercent: 10 });
    expect(totals.subtotal).toBe(0);
    expect(totals.total).toBe(0);
    expect(totals.taxBreakdown).toEqual([]);
  });

  it("reports the single rate when a document only has one", () => {
    const totals = computeDocument({ lines: [{ quantity: 2, unitPrice: 50, taxPercent: 4 }] });
    expect(singleTaxRate(totals)).toBe(4);
  });
});
