/**
 * What an order's shipping details accept: they reach customers in emails, so a day that does not
 * exist, or a text pasted without end, is refused or trimmed here.
 */
import { describe, expect, it } from "vitest";

import { cleanShipping } from "./order-shipping";

describe("⚠️ cleanShipping", () => {
  it("keeps a real day and trimmed texts, and turns empty into none", () => {
    expect(cleanShipping({ expectedDeliveryDate: "2026-10-15", carrier: "  BRT ", trackingCode: "" })).toEqual({
      expectedDeliveryDate: "2026-10-15",
      carrier: "BRT",
      trackingCode: null,
    });
    expect(cleanShipping({})).toEqual({ expectedDeliveryDate: null, carrier: null, trackingCode: null });
  });

  it("refuses a day that does not exist rather than moving it", () => {
    expect(cleanShipping({ expectedDeliveryDate: "2026-02-31" })).toBeNull();
    expect(cleanShipping({ expectedDeliveryDate: "2026-13-01" })).toBeNull();
    expect(cleanShipping({ expectedDeliveryDate: "15/10/2026" })).toBeNull();
  });

  it("cuts a text pasted without end", () => {
    expect(cleanShipping({ trackingCode: "x".repeat(500) })?.trackingCode).toHaveLength(120);
  });
});
