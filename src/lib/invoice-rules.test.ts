/**
 * What an invoice needs before it can be issued.
 *
 * ⚠️ Each problem here is a scarto from SDI days later, after which the invoice
 * legally does not exist until it is sent again.
 */
import { describe, expect, it } from "vitest";

import { draftProblems, formatInvoiceNumber, invoiceScope, isValidSeries, suggestsStampDuty } from "./invoice-rules";

const line = (l: Partial<Parameters<typeof draftProblems>[0][number]> = {}) => ({
  description: "Consulenza",
  quantity: 1,
  unitPrice: 100,
  taxPercent: 22,
  ...l,
});

describe("a draft ready to issue", () => {
  it("has lines, descriptions and a positive total", () => {
    expect(draftProblems([line()])).toEqual([]);
  });

  it("⚠️⚠️ refuses a zero-rate line that does not say why", () => {
    expect(draftProblems([line({ taxPercent: 0 })])).toEqual([{ kind: "zero_rate_without_nature", line: 1 }]);
    expect(draftProblems([line({ taxPercent: 0, nature: "N4" })])).toEqual([]);
  });

  it("⚠️⚠️ refuses a Natura code on a line that carries VAT", () => {
    expect(draftProblems([line(), line({ nature: "N4" })])).toEqual([{ kind: "nature_with_vat", line: 2 }]);
  });

  it("refuses a Natura code SDI does not know, including the withdrawn plain N2 and N3", () => {
    expect(draftProblems([line({ taxPercent: 0, nature: "N2" })])).toEqual([{ kind: "unknown_nature", line: 1 }]);
    expect(draftProblems([line({ taxPercent: 0, nature: "N3" })])).toEqual([{ kind: "unknown_nature", line: 1 }]);
  });

  it("refuses no lines, a line with no description or quantity, and a total of zero", () => {
    expect(draftProblems([])).toEqual([{ kind: "no_lines" }]);
    expect(draftProblems([line({ description: " " })])).toEqual([{ kind: "line_without_description", line: 1 }]);
    expect(draftProblems([line({ quantity: 0 })])).toContainEqual({ kind: "line_quantity", line: 1 });
    expect(draftProblems([line({ unitPrice: 0 })])).toEqual([{ kind: "not_positive" }]);
  });
});

describe("stamp duty", () => {
  it("⚠️ is suggested when VAT-free amounts pass €77.47", () => {
    expect(suggestsStampDuty([line({ taxPercent: 0, nature: "N4", unitPrice: 77.48 })])).toBe(true);
    expect(suggestsStampDuty([line({ taxPercent: 0, nature: "N4", unitPrice: 77.47 })])).toBe(false);
  });

  it("⚠️ counts only the VAT-free lines, after the document discount", () => {
    expect(suggestsStampDuty([line({ unitPrice: 1000 }), line({ taxPercent: 0, nature: "N4", unitPrice: 50 })])).toBe(
      false,
    );
    expect(suggestsStampDuty([line({ taxPercent: 0, nature: "N4", unitPrice: 80 })], 10)).toBe(false);
  });

  it("is not suggested for exports and intra-EU supplies", () => {
    expect(suggestsStampDuty([line({ taxPercent: 0, nature: "N3.1", unitPrice: 500 })])).toBe(false);
    expect(suggestsStampDuty([line({ taxPercent: 0, nature: "N3.2", unitPrice: 500 })])).toBe(false);
  });
});

describe("numbering", () => {
  it("⚠️⚠️ keeps one sequence per series and year", () => {
    expect(invoiceScope("", 2026)).not.toBe(invoiceScope("", 2027));
    expect(invoiceScope("", 2026)).not.toBe(invoiceScope("B", 2026));
    expect(invoiceScope(" b ", 2026)).toBe(invoiceScope("B", 2026));
  });

  it("⚠️ never shares a sequence with order numbers", () => {
    expect(invoiceScope("", 2026).startsWith("order:")).toBe(false);
  });

  it("prints the main series as the bare number", () => {
    expect(formatInvoiceNumber(12, "")).toBe("12");
    expect(formatInvoiceNumber(12, "b")).toBe("12/B");
  });

  it("accepts a short series code only", () => {
    expect(isValidSeries("")).toBe(true);
    expect(isValidSeries("B2")).toBe(true);
    expect(isValidSeries("B/2")).toBe(false);
    expect(isValidSeries("SERIELUNGHISSIMA")).toBe(false);
  });
});
