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
import { QUOTE_STATUSES } from "./quote-status";

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

  it("⚠️ says nothing when the status says sent but no date was recorded", () => {
    // The status alone is not evidence that anything left the building, and this
    // pair does occur: a send that failed after the status was written. Chasing
    // then asks the customer about a message nobody ever sent them.
    expect(whatToChase(quote({ status: "sent", sentAt: null }), NOW)).toBeNull();
    expect(whatToChase(quote({ status: "viewed", sentAt: null, viewedAt: daysAgo(2) }), NOW)).toBeNull();
  });

  it("⚠️ chases from two states and no others, whatever the list grows to", () => {
    // Read from the real list rather than a copy of it: a status added later
    // would otherwise be chaseable or not by accident, and the accident that
    // costs is chasing a quote the customer already accepted.
    const chased = QUOTE_STATUSES.filter((status) => whatToChase(quote({ status }), NOW) !== null);
    expect([...chased].sort()).toEqual(["sent", "viewed"]);
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
