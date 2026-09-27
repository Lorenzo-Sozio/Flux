/**
 * A deal's value survives being edited.
 *
 * ⚠️⚠️ The form showed the stored EUR figure beside the deal's own currency, and saving
 * converted it again: a USD deal of 1,000 became 925.93, then 857.34, a little less on
 * every save, while the board printed the EUR number with a dollar sign.
 */
import { describe, expect, it } from "vitest";

import { dealAmountForDisplay, dealAmountForEditing, dealAmountForStorage } from "./deal-amount";

// Keyed in lower case, as the rates service returns them.
const rates = { usd: 1.08, gbp: 0.85 };

describe("⚠️⚠️ storing a typed figure", () => {
  it("keeps what was typed, and derives the EUR figure from it", () => {
    expect(dealAmountForStorage("1000", "usd", rates)).toEqual({
      amount: "925.93",
      amountOriginal: "1000",
      currency: "USD",
    });
  });

  it("stores EUR as it is", () => {
    expect(dealAmountForStorage(1234.5, "EUR", {})).toEqual({
      amount: "1234.5",
      amountOriginal: "1234.5",
      currency: "EUR",
    });
  });

  it("an empty figure is zero, with nothing typed", () => {
    expect(dealAmountForStorage("", "USD", rates)).toEqual({ amount: "0", amountOriginal: null, currency: "USD" });
    expect(dealAmountForStorage(undefined, null, rates)).toEqual({
      amount: "0",
      amountOriginal: null,
      currency: "EUR",
    });
  });
});

describe("⚠️⚠️ the round trip through the edit form", () => {
  it("opening and saving a USD deal without touching it changes nothing, however many times", () => {
    let stored = dealAmountForStorage("1000", "USD", rates);
    for (let i = 0; i < 5; i++) {
      const form = dealAmountForEditing(stored);
      expect(form).toEqual({ amount: "1000", currency: "USD" });
      stored = dealAmountForStorage(form.amount, form.currency, rates);
    }
    expect(stored.amount).toBe("925.93");
  });

  it("a deal written before the typed figure was kept is edited in EUR, its only known value", () => {
    // Reconstructing "the original" with today's rate would fill the form with a number
    // nobody typed. The EUR value is right, and saving it keeps it right.
    expect(dealAmountForEditing({ amount: "925.93", amountOriginal: null, currency: "USD" })).toEqual({
      amount: "925.93",
      currency: "EUR",
    });
  });
});

describe("what the board shows", () => {
  it("the typed figure in its own currency", () => {
    expect(dealAmountForDisplay({ amount: "925.93", amountOriginal: "1000", currency: "USD" })).toEqual({
      value: 1000,
      currency: "USD",
    });
  });

  it("the EUR figure as EUR when nothing typed is known — never a dollar sign on a euro number", () => {
    expect(dealAmountForDisplay({ amount: "925.93", amountOriginal: null, currency: "USD" })).toEqual({
      value: 925.93,
      currency: "EUR",
    });
  });
});
