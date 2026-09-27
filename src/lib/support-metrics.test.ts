/**
 * What the desk report counts (src/lib/support-metrics.ts). Every figure here has an easy
 * wrong version that looks fine on screen; each test names one.
 */
import { describe, expect, it } from "vitest";

import {
  agentReport,
  backlogSeries,
  csatScore,
  figuresFor,
  firstResponseKept,
  median,
  resolutionKept,
  solvedAt,
  type TicketFacts,
} from "./support-metrics";

const at = (iso: string) => new Date(iso);
const FROM = at("2026-09-01T00:00:00Z");
const TO = at("2026-10-01T00:00:00Z");
const NOW = at("2026-09-20T12:00:00Z");

const ticket = (over: Partial<TicketFacts> = {}): TicketFacts => ({
  assigneeId: "anna",
  priority: "normal",
  status: "open",
  createdAt: at("2026-09-10T09:00:00Z"),
  firstResponseAt: null,
  firstResponseDueAt: null,
  resolvedAt: null,
  closedAt: null,
  slaDeadlineAt: null,
  slaBreachedAt: null,
  slaPauseMinutes: null,
  csatRating: null,
  csatRatedAt: null,
  ...over,
});

describe("what counts as solved", () => {
  it("⚠️⚠️ resolved or closed, and still so — a reopened ticket is not a solve", () => {
    expect(solvedAt(ticket({ status: "resolved", resolvedAt: at("2026-09-11T00:00:00Z") }))).toEqual(
      at("2026-09-11T00:00:00Z"),
    );
    // Closed without being resolved first still stopped needing us.
    expect(solvedAt(ticket({ status: "closed", closedAt: at("2026-09-12T00:00:00Z") }))).toEqual(
      at("2026-09-12T00:00:00Z"),
    );
    expect(solvedAt(ticket({ status: "open", resolvedAt: at("2026-09-11T00:00:00Z") }))).toBeNull();
  });
});

describe("promises", () => {
  it("⚠️⚠️ a first answer not yet due has not failed; one overdue and unanswered has", () => {
    const due = at("2026-09-20T10:00:00Z");
    expect(
      firstResponseKept(ticket({ firstResponseDueAt: due, firstResponseAt: at("2026-09-20T09:00:00Z") }), NOW),
    ).toBe(true);
    expect(
      firstResponseKept(ticket({ firstResponseDueAt: due, firstResponseAt: at("2026-09-20T11:00:00Z") }), NOW),
    ).toBe(false);
    expect(firstResponseKept(ticket({ firstResponseDueAt: due }), NOW)).toBe(false);
    expect(firstResponseKept(ticket({ firstResponseDueAt: at("2026-09-21T10:00:00Z") }), NOW)).toBeNull();
    expect(firstResponseKept(ticket(), NOW)).toBeNull();
  });

  it("⚠️⚠️ time waiting on the customer is given back, and the breach job's stamp is believed", () => {
    const solved = { status: "resolved", resolvedAt: at("2026-09-15T12:00:00Z") };
    const deadline = at("2026-09-15T10:00:00Z");
    expect(resolutionKept(ticket({ ...solved, slaDeadlineAt: deadline }))).toBe(false);
    expect(resolutionKept(ticket({ ...solved, slaDeadlineAt: deadline, slaPauseMinutes: 180 }))).toBe(true);
    expect(
      resolutionKept(ticket({ ...solved, slaDeadlineAt: deadline, slaPauseMinutes: 180, slaBreachedAt: deadline })),
    ).toBe(false);
    expect(resolutionKept(ticket(solved))).toBeNull();
  });
});

describe("the figures", () => {
  it("⚠️ medians, not means: one ticket left over a holiday does not describe everybody", () => {
    expect(median([10, 20, 10_000])).toBe(20);
    expect(median([10, 20])).toBe(15);
    expect(median([])).toBeNull();
  });

  it("counts each event in the period it happened in", () => {
    const rows = [
      // Arrived and solved in September, answered in 30 minutes, on time both ways.
      ticket({
        status: "resolved",
        createdAt: at("2026-09-02T09:00:00Z"),
        firstResponseAt: at("2026-09-02T09:30:00Z"),
        firstResponseDueAt: at("2026-09-02T10:00:00Z"),
        resolvedAt: at("2026-09-02T13:00:00Z"),
        slaDeadlineAt: at("2026-09-03T09:00:00Z"),
        csatRating: "good",
        csatRatedAt: at("2026-09-02T14:00:00Z"),
      }),
      // Arrived in August, solved in September, late, and the customer said so.
      ticket({
        status: "closed",
        priority: "urgent",
        createdAt: at("2026-08-30T09:00:00Z"),
        resolvedAt: at("2026-09-05T09:00:00Z"),
        slaDeadlineAt: at("2026-08-31T09:00:00Z"),
        csatRating: "bad",
        csatRatedAt: at("2026-09-05T10:00:00Z"),
      }),
      // Still open, first answer overdue.
      ticket({ priority: "high", firstResponseDueAt: at("2026-09-10T10:00:00Z") }),
    ];
    const f = figuresFor(rows, FROM, TO, NOW);
    expect(f).toMatchObject({ received: 2, solved: 2, openNow: 1, firstResponseMedianMinutes: 30 });
    expect(f.firstResponseOnTime).toEqual({ met: 1, total: 2 });
    expect(f.resolutionOnTime).toEqual({ met: 1, total: 2 });
    expect(f.missedByPriority).toEqual({ urgent: 1, high: 1 });
    expect(f.csat).toEqual({ good: 1, bad: 1 });
    expect(csatScore(f.csat)).toBe(0.5);
  });

  it("⚠️ no answers is no satisfaction figure — never 100%", () => {
    expect(csatScore({ good: 0, bad: 0 })).toBeNull();
  });

  it("splits by person, keeps the unassigned, and adds up to the desk", () => {
    const rows = [
      ticket(),
      ticket({ assigneeId: "bruno" }),
      ticket({ assigneeId: null, createdAt: at("2026-08-01T00:00:00Z") }),
    ];
    const r = agentReport(rows, FROM, TO, NOW);
    expect(r.agents.map((a) => a.assigneeId).sort()).toEqual(["anna", "bruno", null].sort());
    expect(r.team.openNow).toBe(3);
    expect(r.team.received).toBe(2);
  });
});

describe("the backlog", () => {
  it("counts what had arrived and was not yet solved at each moment", () => {
    const rows = [
      ticket({ createdAt: at("2026-09-01T00:00:00Z"), status: "resolved", resolvedAt: at("2026-09-09T00:00:00Z") }),
      ticket({ createdAt: at("2026-09-05T00:00:00Z") }),
      ticket({ createdAt: at("2026-09-12T00:00:00Z") }),
    ];
    const series = backlogSeries(rows, [
      at("2026-09-06T00:00:00Z"),
      at("2026-09-10T00:00:00Z"),
      at("2026-09-13T00:00:00Z"),
    ]);
    expect(series.map((p) => p.open)).toEqual([2, 1, 2]);
  });
});
