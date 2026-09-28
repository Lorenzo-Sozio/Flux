/**
 * ⚠️⚠️ Payment terms and installments (I12): the dates a customer's ledger agrees with, the
 * shares adding up to the cent, and payments settling the earliest installment first.
 */
import { describe, expect, it } from "vitest";

import { CompanySchema, CompanyUpdateSchema } from "@/actions/crm-validation";

import { cleanTerms, endOfMonthAfter, installmentStates, installmentsFor, installmentsMatch } from "./payment-terms";

describe("⚠️⚠️ due dates", () => {
  it("gg d.f.f.m. counts months: 31 January at 30 days end of month is 28 February", () => {
    expect(installmentsFor({ preset: "d30eom" }, "2026-01-31", 100)).toEqual([{ dueDate: "2026-02-28", amount: 100 }]);
    expect(installmentsFor({ preset: "d30eom" }, "2026-09-10", 100)[0].dueDate).toBe("2026-10-31");
    expect(endOfMonthAfter("2026-12-15", 2)).toBe("2027-02-28");
    expect(endOfMonthAfter("2028-01-05", 1)).toBe("2028-02-29");
  });

  it("plain days are calendar days", () => {
    expect(installmentsFor({ preset: "d30" }, "2026-01-31", 100)[0].dueDate).toBe("2026-03-02");
    expect(installmentsFor({ preset: "immediate" }, "2026-09-29", 100)[0].dueDate).toBe("2026-09-29");
  });

  it("30-60-90 d.f.f.m.: three installments at the end of each month, adding up to the cent", () => {
    const three = installmentsFor({ preset: "d30_60_90eom" }, "2026-09-29", 1000);
    expect(three).toEqual([
      { dueDate: "2026-10-31", amount: 333.34 },
      { dueDate: "2026-11-30", amount: 333.33 },
      { dueDate: "2026-12-31", amount: 333.33 },
    ]);
    expect(installmentsMatch(three, 1000)).toBe(true);
  });

  it("30/70: thirty per cent on the invoice, the rest at thirty days", () => {
    expect(installmentsFor({ preset: "p30_70" }, "2026-09-29", 1220)).toEqual([
      { dueDate: "2026-09-29", amount: 366 },
      { dueDate: "2026-10-29", amount: 854 },
    ]);
  });
});

describe("installments written by hand", () => {
  it("are kept in date order, to the cent, and refused when they are not installments", () => {
    expect(
      cleanTerms({
        custom: [
          { dueDate: "2026-12-01", amount: "500,5" },
          { dueDate: "2026-11-01", amount: 499.5 },
        ],
      }),
    ).toEqual({
      custom: [
        { dueDate: "2026-11-01", amount: 499.5 },
        { dueDate: "2026-12-01", amount: 500.5 },
      ],
    });
    expect(cleanTerms({ custom: [{ dueDate: "2026-02-30", amount: 10 }] })).toBeNull();
    expect(cleanTerms({ custom: [{ dueDate: "2026-11-01", amount: 0 }] })).toBeNull();
    expect(cleanTerms({ custom: [] })).toBeNull();
    expect(cleanTerms({ preset: "d45" })).toBeNull();
    expect(cleanTerms({ preset: "d60eom" })).toEqual({ preset: "d60eom" });
  });
});

describe("⚠️⚠️ what each installment still owes", () => {
  const plan = [
    { dueDate: "2026-10-31", amount: 400 },
    { dueDate: "2026-11-30", amount: 300 },
    { dueDate: "2026-12-31", amount: 300 },
  ];

  it("a payment settles the earliest installment first", () => {
    expect(installmentStates(plan, 1000, 500).map((s) => [s.paid, s.outstanding])).toEqual([
      [400, 0],
      [100, 200],
      [0, 300],
    ]);
  });

  it("⚠️ a credit note takes from the last installments, not from the first", () => {
    expect(installmentStates(plan, 800, 0).map((s) => s.amount)).toEqual([400, 300, 100]);
  });
});

describe("a customer's usual terms", () => {
  it("are a preset or nothing, and a partial update leaves them alone", () => {
    expect(CompanySchema.parse({ name: "Acme", paymentTerms: "d30_60_90eom" }).paymentTerms).toBe("d30_60_90eom");
    expect(CompanySchema.parse({ name: "Acme", paymentTerms: "" }).paymentTerms).toBeNull();
    expect(() => CompanySchema.parse({ name: "Acme", paymentTerms: "d45" })).toThrow();
    expect(CompanyUpdateSchema.parse({ name: "Acme" }).paymentTerms).toBeUndefined();
  });
});
