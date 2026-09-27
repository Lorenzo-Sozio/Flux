/**
 * "Today" and "this month" on the workspace's clock, not the server's (UTC on Workers).
 */
import { describe, expect, it } from "vitest";

import { dayBounds, dayStart, monthStart } from "./workspace-day";

const ROME = "Europe/Rome";

describe("⚠️⚠️ the workspace's day", () => {
  it("at 00:30 in Rome — still yesterday in UTC — is already the new day", () => {
    const now = new Date("2026-09-30T22:30:00Z"); // 1 October, 00:30 in Rome
    const { start, end } = dayBounds(now, ROME);
    expect(start.toISOString()).toBe("2026-09-30T22:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-01T22:00:00.000Z");
  });

  it("is 23 hours long on the day the clocks go forward", () => {
    const { start, end } = dayBounds(new Date("2026-03-29T10:00:00Z"), ROME);
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(23);
  });

  it("moves by calendar days", () => {
    expect(dayStart(new Date("2026-09-30T22:30:00Z"), ROME, -1).toISOString()).toBe("2026-09-29T22:00:00.000Z");
  });
});

describe("⚠️⚠️ the workspace's month", () => {
  it("a deal won at 00:30 on the first, Rome time, belongs to the new month", () => {
    const wonAt = new Date("2026-09-30T22:30:00Z");
    const start = monthStart(wonAt, ROME);
    expect(start.toISOString()).toBe("2026-09-30T22:00:00.000Z");
    expect(wonAt >= start).toBe(true);
  });

  it("goes back across a year", () => {
    expect(monthStart(new Date("2026-01-15T12:00:00Z"), ROME, -1).toISOString()).toBe("2025-11-30T23:00:00.000Z");
  });
});
