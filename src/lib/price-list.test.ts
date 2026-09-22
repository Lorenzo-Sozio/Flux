import { describe, expect, it } from "vitest";

import { adjustmentLabel, type PriceRules, priceFor, priceProduct } from "./price-list";

const list = (adjustmentPercent: number, overrides: Record<string, number> = {}): PriceRules => ({
  id: "pl1",
  name: "Rivenditori",
  adjustmentPercent,
  overrides,
});

describe("the price a customer sees", () => {
  it("is the catalogue price when they have no list", () => {
    expect(priceProduct("p1", "100.00", null)).toEqual({ price: 100, source: "base" });
    expect(priceFor("p1", 100, undefined)).toBe(100);
  });

  it("⚠️ reads a negative percentage as money off and a positive one as money on", () => {
    expect(priceFor("p1", "100.00", list(-10))).toBe(90);
    expect(priceFor("p1", "100.00", list(5))).toBe(105);
  });

  it("⚠️ takes a price written for that product instead of the percentage", () => {
    const rules = list(-10, { p1: 42 });
    expect(priceProduct("p1", "100.00", rules)).toEqual({ price: 42, source: "override" });
    // Everything else in the same list still follows the percentage.
    expect(priceProduct("p2", "100.00", rules)).toEqual({ price: 90, source: "percent" });
  });

  it("⚠️ keeps a product given away at zero rather than falling back to the catalogue", () => {
    expect(priceFor("p1", "100.00", list(-10, { p1: 0 }))).toBe(0);
  });

  it("⚠️⚠️ never pays the customer to take the goods", () => {
    expect(priceFor("p1", "100.00", list(-150))).toBe(0);
    expect(priceFor("p1", "100.00", list(-10, { p1: -5 }))).toBe(0);
  });

  it("⚠️ rounds to the cent, because that is all the column can hold", () => {
    // 19.99 − 7% = 18.5907, which stored as given would make the totals disagree
    // with what was shown.
    expect(priceFor("p1", "19.99", list(-7))).toBe(18.59);
    expect(priceFor("p1", "0.05", list(-33.33))).toBe(0.03);
  });

  it("treats a missing or unreadable price as nothing, not as NaN", () => {
    expect(priceFor("p1", null, list(-10))).toBe(0);
    expect(priceFor("p1", "abc", null)).toBe(0);
    expect(priceProduct("p1", "100", list(Number.NaN)).price).toBe(100);
  });

  it("says where the price came from, so the screen can explain it", () => {
    expect(priceProduct("p1", "100", list(0)).source).toBe("base");
    expect(priceProduct("p1", "100", list(-10)).source).toBe("percent");
    expect(priceProduct("p1", "100", list(-10, { p1: 80 })).source).toBe("override");
  });
});

describe("how an adjustment reads", () => {
  it("carries the direction and a figure without a sign, for translation", () => {
    expect(adjustmentLabel("-10.00")).toEqual({ direction: "off", percent: 10 });
    expect(adjustmentLabel(5)).toEqual({ direction: "on", percent: 5 });
    expect(adjustmentLabel("0")).toEqual({ direction: "none", percent: 0 });
    expect(adjustmentLabel(null)).toEqual({ direction: "none", percent: 0 });
  });
});
