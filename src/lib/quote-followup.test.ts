/**
 * Deciding whether, and about what, to chase a quote.
 *
 * On the tested surface because the failure is a message to a customer. Chasing
 * a quote that has already been accepted, or the day after sending it, costs
 * more than not chasing at all — and both are silent: the draft simply appears
 * and somebody sends it.
 */
import { describe, expect, it } from "vitest";

import { EXPIRING_WITHIN_DAYS, QUIET_AFTER_DAYS, type QuoteState, whatToChase } from "./quote-followup";

const NOW = new Date("2026-09-20T12:00:00Z").getTime();
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000);
const inDays = (n: number) => new Date(NOW + n * 86_400_000);

const quote = (over: Partial<QuoteState> = {}): QuoteState => ({
  quoteNumber: "Q-1",
  status: "sent",
  sentAt: daysAgo(10),
  viewedAt: null,
  expiresAt: null,
  ...over,
});

describe("whatToChase", () => {
  it("says nothing about a quote that was never sent", () => {
    expect(whatToChase(quote({ sentAt: null, status: "draft" }), NOW)).toBeNull();
  });

  it("⚠️ says nothing about a quote that has been answered", () => {
    // Chasing an accepted quote is the message that costs the most to send.
    for (const status of ["accepted", "declined", "converted", "expired", "draft"]) {
      expect(whatToChase(quote({ status }), NOW), status).toBeNull();
    }
  });

  it("says nothing the day after sending", () => {
    expect(whatToChase(quote({ sentAt: daysAgo(QUIET_AFTER_DAYS - 1) }), NOW)).toBeNull();
  });

  it("chases silence once it has been quiet long enough", () => {
    const result = whatToChase(quote({ sentAt: daysAgo(QUIET_AFTER_DAYS) }), NOW);
    expect(result?.kind).toBe("not-opened");
    expect(result?.days).toBe(QUIET_AFTER_DAYS);
  });

  it("tells a quote nobody opened from one nobody answered", () => {
    expect(whatToChase(quote({ viewedAt: null }), NOW)?.kind).toBe("not-opened");
    expect(whatToChase(quote({ status: "viewed", viewedAt: daysAgo(4) }), NOW)?.kind).toBe("no-answer");
  });

  it("puts the deadline first, whatever else is true", () => {
    // Two days from lapsing is the fact the customer cannot see and we can, so it
    // outranks how long they have been quiet.
    const result = whatToChase(quote({ sentAt: daysAgo(30), expiresAt: inDays(2) }), NOW);
    expect(result?.kind).toBe("expiring");
    expect(result?.days).toBe(2);
  });

  it("chases a deadline even on a quote too young to chase for silence", () => {
    const result = whatToChase(quote({ sentAt: daysAgo(1), expiresAt: inDays(1) }), NOW);
    expect(result?.kind).toBe("expiring");
  });

  it("does not call a distant deadline urgent", () => {
    const result = whatToChase(quote({ expiresAt: inDays(EXPIRING_WITHIN_DAYS + 1) }), NOW);
    expect(result?.kind).toBe("not-opened");
  });

  it("knows a deadline that has already passed", () => {
    const result = whatToChase(quote({ expiresAt: daysAgo(3) }), NOW);
    expect(result?.kind).toBe("expired");
    expect(result?.days).toBe(3);
  });

  it("treats the day of expiry as expiring, not expired", () => {
    const result = whatToChase(quote({ expiresAt: new Date(NOW + 3_600_000) }), NOW);
    expect(result?.kind).toBe("expiring");
    expect(result?.days).toBe(1);
  });
});
