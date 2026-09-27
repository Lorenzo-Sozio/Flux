/**
 * One rule for every way a ticket's status changes (statusStamps): the detail page, the
 * board, and an email from the customer.
 */
import { describe, expect, it } from "vitest";

import { becameResolved, statusStamps } from "./ticket-state-machine";

const NOW = new Date("2026-09-20T12:00:00Z");
const ticket = (status: string, over: { slaPausedAt?: Date | null; slaPauseMinutes?: number | null } = {}) => ({
  status,
  slaPausedAt: null,
  slaPauseMinutes: null,
  ...over,
});

describe("statusStamps", () => {
  it("refuses a move the state machine does not allow", () => {
    expect(statusStamps(ticket("closed"), "open", NOW)).toBeNull();
    expect(statusStamps(ticket("resolved"), "waiting", NOW)).toBeNull();
  });

  it("stamps a resolution and a closing", () => {
    expect(statusStamps(ticket("open"), "resolved", NOW)).toEqual({ status: "resolved", resolvedAt: NOW });
    expect(statusStamps(ticket("resolved"), "closed", NOW)).toEqual({ status: "closed", closedAt: NOW });
  });

  it("⚠️⚠️ reopening clears the resolution, or the ticket still counts as solved", () => {
    expect(statusStamps(ticket("resolved"), "open", NOW)).toEqual({ status: "open", resolvedAt: null });
  });

  it("⚠️ pauses the SLA while waiting on the customer, and gives the time back after", () => {
    expect(statusStamps(ticket("open"), "waiting", NOW)).toEqual({ status: "waiting", slaPausedAt: NOW });
    const paused = new Date(NOW.getTime() - 90 * 60_000);
    expect(statusStamps(ticket("waiting", { slaPausedAt: paused, slaPauseMinutes: 30 }), "open", NOW)).toEqual({
      status: "open",
      slaPausedAt: null,
      slaPauseMinutes: 120,
    });
  });

  it("the moment to tell the customer is the move into resolved, and only that", () => {
    expect(becameResolved("open", "resolved")).toBe(true);
    expect(becameResolved("resolved", "resolved")).toBe(false);
    expect(becameResolved("open", "closed")).toBe(false);
  });
});
