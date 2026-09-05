/**
 * What is still owed on an order.
 *
 * On the tested boundary because it is money and because it is read, not just
 * written: somebody decides whether to chase a customer on the strength of this
 * number. Wrong in one direction it invents a debt that does not exist, wrong in
 * the other it forgets one that does, and neither looks like a failure — both
 * look like a figure.
 *
 * The amounts arrive from the database as strings, which is where most of the
 * ways this can go wrong live.
 */
import { describe, expect, it } from "vitest";

import { isRecordablePayment, paymentSummary } from "./order-payment";

describe("what is still owed", () => {
  it("owes the whole total when nothing has arrived", () => {
    expect(paymentSummary(1000, [])).toEqual({ paid: 0, outstanding: 1000, state: "unpaid" });
  });

  it("separates paid nothing from paid something, because they are different conversations", () => {
    expect(paymentSummary(1000, [{ amount: 400 }]).state).toBe("partial");
    expect(paymentSummary(1000, []).state).toBe("unpaid");
  });

  it("adds the instalments up", () => {
    // The case a single paid_amount column cannot hold: a deposit and a balance.
    const summary = paymentSummary(1000, [{ amount: 300 }, { amount: 700 }]);
    expect(summary.paid).toBe(1000);
    expect(summary.outstanding).toBe(0);
    expect(summary.state).toBe("paid");
  });

  it("reads the strings the database hands back", () => {
    expect(paymentSummary("1234.56", [{ amount: "1234.56" }])).toEqual({
      paid: 1234.56,
      outstanding: 0,
      state: "paid",
    });
  });

  it("does not invent a debt out of binary noise", () => {
    // 0.1 + 0.2 is 0.30000000000000004, and an order paid to the cent must not
    // read as still owing a fraction of one.
    const summary = paymentSummary(0.3, [{ amount: 0.1 }, { amount: 0.2 }]);
    expect(summary.outstanding).toBe(0);
    expect(summary.state).toBe("paid");
  });

  it("rounds what is left, not only what came in", () => {
    // 1234.56 minus 1234.55 is 0.009999999999990905 in binary floating point.
    // What is owed has to be an amount of money, not a fraction of a cent, or the
    // figure on the screen is one a person cannot pay and a total cannot match.
    expect(paymentSummary(1234.56, [{ amount: 1234.55 }]).outstanding).toBe(0.01);
    expect(paymentSummary(0.7, [{ amount: 0.6 }]).outstanding).toBe(0.1);
  });

  it("says overpaid rather than pretending the extra did not arrive", () => {
    const summary = paymentSummary(100, [{ amount: 150 }]);
    expect(summary.outstanding).toBe(-50);
    expect(summary.state).toBe("overpaid");
  });

  it("treats a null or unparseable amount as nothing, not as NaN", () => {
    // One bad row must not make every figure on the order unreadable.
    const summary = paymentSummary(100, [{ amount: null }, { amount: "abc" }, { amount: 40 }]);
    expect(summary.paid).toBe(40);
    expect(summary.outstanding).toBe(60);
  });

  it("calls an order of nothing paid, because there is nothing to chase", () => {
    expect(paymentSummary(0, []).state).toBe("paid");
  });
});

describe("what may be recorded", () => {
  it("takes a positive amount", () => {
    expect(isRecordablePayment(10)).toBe(true);
    expect(isRecordablePayment("10.50")).toBe(true);
  });

  it("refuses zero and negatives, because a refund is its own event", () => {
    expect(isRecordablePayment(0)).toBe(false);
    expect(isRecordablePayment(-5)).toBe(false);
  });

  it("refuses what is not a number, because one NaN poisons every total after it", () => {
    expect(isRecordablePayment("")).toBe(false);
    expect(isRecordablePayment("abc")).toBe(false);
    expect(isRecordablePayment(null)).toBe(false);
    expect(isRecordablePayment(undefined)).toBe(false);
    expect(isRecordablePayment(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
