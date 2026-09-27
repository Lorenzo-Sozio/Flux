/**
 * Where deals have been, and what it says about the pipeline.
 *
 * ⚠️⚠️ "Average days in stage" was the deals' age: a deal created a year ago and moved into
 * Proposal yesterday counted a year of proposal.
 */
import { describe, expect, it } from "vitest";

import { isStale, salesVelocity, stageFigures, stageStays } from "./stage-history";

const day = (n: number) => new Date(Date.UTC(2026, 8, 1 + n));
const move = (from: string, to: string, at: number) => ({ oldValue: from, newValue: to, changedAt: day(at) });

const STAGES = [
  { id: "a", order: 1, isWon: false, isLost: false, staleAfterDays: null },
  { id: "b", order: 2, isWon: false, isLost: false, staleAfterDays: 5 },
  { id: "won", order: 8, isWon: true, isLost: false, staleAfterDays: null },
  { id: "lost", order: 9, isWon: false, isLost: true, staleAfterDays: null },
];

describe("a deal's stays", () => {
  it("start when it was created, move with each change, and end when it closed", () => {
    const deal = { stageId: "won", status: "won", createdAt: day(0), closedAt: day(20) };
    expect(stageStays(deal, [move("a", "b", 4), move("b", "won", 20)])).toEqual([
      { stageId: "a", from: day(0), to: day(4) },
      { stageId: "b", from: day(4), to: day(20) },
      { stageId: "won", from: day(20), to: day(20) },
    ]);
  });

  it("an open deal that never moved has been in its stage since it was created", () => {
    expect(stageStays({ stageId: "a", status: "open", createdAt: day(0), closedAt: null }, [])).toEqual([
      { stageId: "a", from: day(0), to: null },
    ]);
  });
});

describe("⚠️⚠️ the stage figures", () => {
  const deals = [
    // Through A in 4 days and B in 16, then won.
    { id: "d1", stageId: "won", status: "won", createdAt: day(0), closedAt: day(20) },
    // Lost while still in A, after 6 days.
    { id: "d2", stageId: "lost", status: "lost", createdAt: day(0), closedAt: day(6) },
    // Out of A after 2 days, in B for 18 days and counting.
    { id: "d3", stageId: "b", status: "open", createdAt: day(10), closedAt: null },
  ];
  const changes = new Map([
    ["d1", [move("a", "b", 4), move("b", "won", 20)]],
    ["d2", [move("a", "lost", 6)]],
    ["d3", [move("a", "b", 12)]],
  ]);
  const figures = stageFigures(STAGES, deals, changes, day(30));

  it("days in a stage are the stays that ended — not the deals' age", () => {
    // A: 4, 6 and 2 days.
    expect(figures.a.avgDays).toBe(4);
    // B: only d1 has left it, after 16 days; d3 is still there.
    expect(figures.b.avgDays).toBe(16);
  });

  it("conversion is the share that moved on, of those that left", () => {
    expect(figures.a).toMatchObject({ advanced: 2, dropped: 1, conversion: 67 });
    // d3 is still in B: not decided yet.
    expect(figures.b).toMatchObject({ advanced: 1, dropped: 0, conversion: 100 });
  });

  it("⚠️ an open deal past its stage's threshold is stuck; won and lost are not stages to be stuck in", () => {
    expect(figures.b.stale).toBe(1);
    expect(figures.a.stale).toBe(0);
    expect(figures.won.avgDays).toBeNull();
  });

  it("no threshold, no stuck deals", () => {
    expect(isStale(100, null)).toBe(false);
    expect(isStale(6, 5)).toBe(true);
    expect(isStale(5, 5)).toBe(false);
  });
});

describe("sales velocity", () => {
  it("open deals × average won × win rate ÷ days to win", () => {
    expect(salesVelocity({ openCount: 10, wonCount: 2, lostCount: 2, wonValue: 20_000, cycleDays: 20 })).toBe(2500);
  });

  it("is unknown rather than zero when nothing was won or decided", () => {
    expect(salesVelocity({ openCount: 10, wonCount: 0, lostCount: 3, wonValue: 0, cycleDays: null })).toBeNull();
    expect(salesVelocity({ openCount: 10, wonCount: 1, lostCount: 0, wonValue: 100, cycleDays: 0 })).toBeNull();
  });
});
