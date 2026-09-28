/**
 * ⚠️⚠️ A deposit invoice and the balance that takes it off (I11).
 *
 * The deposit is split across the order's VAT rates in the order's proportion, and the balance
 * takes each deposit off at its own taxable, rate by rate: together they are the order, and no
 * VAT is charged twice on the part already invoiced.
 */
import { describe, expect, it } from "vitest";

import { invoiceTotals } from "./fatturapa/totals";
import { deductionExceeds, deductionLines, depositLines } from "./invoice-deposits";
import { draftProblems } from "./invoice-rules";

const ORDER = [
  { description: "Piante", quantity: 10, unitPrice: 100, taxPercent: 22, nature: null },
  { description: "Posa", quantity: 1, unitPrice: 1000, taxPercent: 10, nature: null },
];
const describeDeposit = (rate: number, _n: string | null, several: boolean) =>
  several ? `Acconto (IVA ${rate}%)` : "Acconto";

describe("⚠️⚠️ a deposit invoice", () => {
  it("is split across the order's rates in the order's proportion, and adds up to what was asked", () => {
    // Order gross: 1000 + 220 = 1220 at 22%, 1000 + 100 = 1100 at 10%; 2320 in all.
    const lines = depositLines(ORDER, 0, 580, describeDeposit);
    expect(lines).not.toBeNull();
    const byRate = Object.fromEntries((lines ?? []).map((l) => [l.taxPercent, l.unitPrice]));
    // 580 × 1220/2320 = 305 gross at 22% → 250 taxable; 275 gross at 10% → 250 taxable.
    expect(byRate).toEqual({ 22: 250, 10: 250 });
    expect(invoiceTotals(lines ?? []).total).toBe(580);
    expect(lines?.map((l) => l.description)).toEqual(["Acconto (IVA 10%)", "Acconto (IVA 22%)"]);
  });

  it("refuses nothing, and an order that totals nothing", () => {
    expect(depositLines(ORDER, 0, 0, describeDeposit)).toBeNull();
    expect(depositLines([], 0, 100, describeDeposit)).toBeNull();
  });

  it("⚠️ follows the order's document discount", () => {
    // 10% off the whole order: the proportion is of what the customer pays.
    const lines = depositLines(ORDER, 10, 522, describeDeposit) ?? [];
    expect(invoiceTotals(lines).total).toBeCloseTo(522, 1);
  });
});

describe("⚠️⚠️ the balance invoice", () => {
  const deposit = {
    id: "dep1",
    documentNumber: "7",
    issueDate: "2026-09-10",
    discountPercent: 0,
    lines: [
      { description: "Acconto (IVA 22%)", quantity: 1, unitPrice: 250, taxPercent: 22, nature: null },
      { description: "Acconto (IVA 10%)", quantity: 1, unitPrice: 250, taxPercent: 10, nature: null },
      // The deposit's own stamp recharge is its own charge, never taken off.
      { description: "Bollo", quantity: 1, unitPrice: 2, taxPercent: 0, nature: "N1", isStampRecharge: true },
    ],
  };
  const deductions = deductionLines([deposit], (n, d) => `Storno acconto n. ${n} del ${d}`);

  it("takes each deposit off at its taxable, rate by rate, citing it", () => {
    expect(deductions.map((d) => [d.taxPercent, d.unitPrice, d.depositInvoiceId])).toEqual([
      [10, -250, "dep1"],
      [22, -250, "dep1"],
    ]);
    expect(deductions[0].description).toBe("Storno acconto n. 7 del 2026-09-10");
  });

  it("⚠️⚠️ and deposit + balance is the order: nothing invoiced twice", () => {
    const balance = invoiceTotals([...ORDER, ...deductions]);
    expect(balance.total).toBe(2320 - 580);
    expect(balance.summary.map((g) => [g.rate, g.taxable, g.tax])).toEqual([
      [10, 750, 75],
      [22, 750, 165],
    ]);
  });

  it("⚠️ a document discount on the balance applies to the order's lines, never to the deposit taken off", () => {
    const withDiscount = invoiceTotals([...ORDER, ...deductions], 10);
    // 10% of 2000 taxable, not of the 1500 left after the deposits.
    expect(withDiscount.discountAmount).toBe(200);
  });

  it("⚠️ a rate taken below zero stops the issue", () => {
    const shrunk = [
      { description: "Piante", quantity: 1, unitPrice: 100, taxPercent: 22, nature: null },
      ...deductions,
    ];
    expect(deductionExceeds(shrunk, 0)).toBe(true);
    expect(draftProblems(shrunk.slice(0, 1), 0, { mode: "auto" }, deductions).map((p) => p.kind)).toContain(
      "deduction_exceeds",
    );
    expect(draftProblems(ORDER, 0, { mode: "auto" }, deductions)).toEqual([]);
  });
});
