/**
 * The scorecard per salesperson, against a real Postgres, and the calendar periods it is
 * read in.
 *
 * ⚠️⚠️ The view a sales manager asks for first — who won what against which target, and
 * what they did to get there — did not exist. It must agree with every other screen about
 * the same person's month, or it is worse than nothing.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";

import {
  currentPeriodKey,
  monthKeysOf,
  parsePeriodKey,
  periodBounds,
  periodOfKind,
  shiftPeriod,
  targetFor,
} from "./calendar-period";
import { parsePipelineFilters } from "./pipeline-filters";
import { repScorecard } from "./rep-scorecard";

const ROME = "Europe/Rome";
const db = drizzle(new PGlite());
const members = [
  { id: "anna", name: "Anna", email: "anna@firm.it" },
  { id: "luca", name: "Luca", email: "luca@firm.it" },
  // Nothing at all this period: the row a manager most needs to see.
  { id: "sara", name: "Sara", email: "sara@firm.it" },
  { id: "old", name: "Vecchio", email: "old@firm.it", former: true },
];

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

describe("calendar periods", () => {
  it("parse, normalise and refuse", () => {
    expect(parsePeriodKey("2026-09")).toEqual({ kind: "month", year: 2026, index: 9 });
    expect(parsePeriodKey("2026-Q3")).toEqual({ kind: "quarter", year: 2026, index: 3 });
    expect(parsePeriodKey("2026")).toEqual({ kind: "year", year: 2026, index: 0 });
    for (const bad of ["2026-13", "2026-Q5", "26-09", "2026-9", "", null, "1900"])
      expect(parsePeriodKey(bad)).toBeNull();
    expect(parsePipelineFilters({ closed: "2026-q3" }).closed).toBeNull();
    expect(parsePipelineFilters({ closed: "2026-Q3" }).closed).toBe("2026-Q3");
  });

  it("⚠️ are bounded on the workspace's clock, not the server's", () => {
    expect(periodBounds("2026-09", ROME)).toEqual({
      from: new Date("2026-08-31T22:00:00Z"),
      to: new Date("2026-09-30T22:00:00Z"),
    });
    // A quarter across the change of hour: summer time in, winter time out.
    expect(periodBounds("2026-Q4", ROME)).toEqual({
      from: new Date("2026-09-30T22:00:00Z"),
      to: new Date("2026-12-31T23:00:00Z"),
    });
    expect(currentPeriodKey("month", new Date("2026-09-30T22:30:00Z"), ROME)).toBe("2026-10");
    expect(currentPeriodKey("quarter", new Date("2026-09-30T21:30:00Z"), ROME)).toBe("2026-Q3");
  });

  it("step, and change kind from where they start", () => {
    expect(shiftPeriod("2026-01", -1)).toBe("2025-12");
    expect(shiftPeriod("2026-Q4", 1)).toBe("2027-Q1");
    expect(shiftPeriod("2026", -1)).toBe("2025");
    expect(monthKeysOf("2026-Q2")).toEqual(["2026-04", "2026-05", "2026-06"]);
    expect(periodOfKind("2026-09", "quarter")).toBe("2026-Q3");
    expect(periodOfKind("2026-Q3", "month")).toBe("2026-07");
    expect(periodOfKind("2026-Q3", "year")).toBe("2026");
  });

  it("⚠️ a target: its own first, else its parts — never both, and none is not zero", () => {
    const monthly = [
      { period: "2026-07", amount: 100 },
      { period: "2026-08", amount: 200 },
    ];
    expect(targetFor(monthly, "2026-07")).toBe(100);
    expect(targetFor(monthly, "2026-09")).toBeNull();
    expect(targetFor(monthly, "2026-Q3")).toBe(300);
    expect(targetFor([...monthly, { period: "2026-Q3", amount: 1000 }], "2026-Q3")).toBe(1000);
    expect(targetFor([...monthly, { period: "2026-Q4", amount: 50 }], "2026")).toBe(350);
    expect(targetFor(monthly, "2025")).toBeNull();
  });
});

describe("⚠️⚠️ the scorecard", () => {
  beforeEach(async () => {
    for (const t of ["activity", "deal", "sales_target"]) await db.execute(sql.raw(`delete from "${t}"`));
    await db.execute(sql`delete from "user"`);
    await db.execute(sql`
      insert into "user" (id, name, email) values
        ('anna', 'Anna', 'anna@firm.it'), ('luca', 'Luca', 'luca@firm.it'), ('old', 'Vecchio', 'old@firm.it')`);
    await db.execute(sql`
      insert into deal (id, name, status, amount, owner_id, created_at, closed_at) values
        ('w1', 'W1', 'won', '1000', 'anna', '2026-09-01T10:00:00Z', '2026-09-11T10:00:00Z'),
        ('w2', 'W2', 'won', '3000', 'anna', '2026-08-22T10:00:00Z', '2026-09-21T10:00:00Z'),
        ('l1', 'L1', 'lost', '500', 'anna', '2026-08-01T10:00:00Z', '2026-09-15T10:00:00Z'),
        -- Won in August, and at 00:30 on 1 October in Rome: neither is September's.
        ('aug', 'Aug', 'won', '9000', 'anna', '2026-07-01T10:00:00Z', '2026-08-31T21:59:00Z'),
        ('oct', 'Oct', 'won', '9000', 'anna', '2026-07-01T10:00:00Z', '2026-09-30T22:30:00Z'),
        ('o1', 'O1', 'open', '6000', 'anna', '2026-09-01T10:00:00Z', null),
        ('o2', 'O2', 'open', '2000', 'luca', '2026-09-01T10:00:00Z', null),
        ('nobody', 'N', 'won', '700', null, '2026-09-01T10:00:00Z', '2026-09-02T10:00:00Z'),
        ('former', 'F', 'won', '400', 'old', '2026-09-01T10:00:00Z', '2026-09-03T10:00:00Z')`);
    await db.execute(sql`
      insert into activity (id, type, owner_id, date) values
        ('a1', 'call', 'anna', '2026-09-05T10:00:00Z'),
        ('a2', 'call', 'anna', '2026-09-06T10:00:00Z'),
        ('a3', 'meeting', 'anna', '2026-09-07T10:00:00Z'),
        ('a4', 'email', 'anna', '2026-09-08T10:00:00Z'),
        ('a5', 'note', 'anna', '2026-09-08T10:00:00Z'),
        ('a6', 'call', 'anna', '2026-08-08T10:00:00Z'),
        -- A customer's email, written by nobody here: nobody's work.
        ('a7', 'email', null, '2026-09-08T10:00:00Z')`);
    await db.execute(sql`
      insert into sales_target (id, user_id, period, period_type, target_amount) values
        ('t1', 'anna', '2026-09', 'month', '10000'),
        ('t2', 'anna', '2026-07', 'month', '5000'),
        ('t3', 'anna', '2026-08', 'month', '5000')`);
  });

  async function card(period = "2026-09", owners?: string[]) {
    const result = await repScorecard(db, { period, timeZone: ROME, members, owners });
    if (!result) throw new Error("no scorecard");
    return result;
  }

  it("reads each person's month as every other screen does", async () => {
    const { rows } = await card();
    const anna = rows.find((r) => r.ownerId === "anna");
    expect(anna).toMatchObject({
      won: 2,
      wonValue: 4000,
      lost: 1,
      winRate: 67,
      avgWon: 2000,
      // 10 days and 30 days from creation to win.
      cycleDays: 20,
      open: 1,
      openValue: 6000,
      target: 10000,
      attainment: 40,
      // 6000 in play for the 6000 still to win.
      coverage: 1,
      calls: 2,
      meetings: 1,
      emails: 1,
    });
  });

  it("⚠️ everyone in the workspace has a row, figures or not; a former member only with figures", async () => {
    const { rows } = await card();
    expect(rows.map((r) => r.ownerId)).toEqual(["anna", "old", "luca", "sara", "none"]);
    expect(rows.find((r) => r.ownerId === "sara")).toMatchObject({ won: 0, openValue: 0, calls: 0, target: null });
    expect(rows.find((r) => r.ownerId === "luca")).toMatchObject({
      won: 0,
      target: null,
      coverage: null,
      openValue: 2000,
    });
    expect(rows.find((r) => r.ownerId === "old")).toMatchObject({ former: true, wonValue: 400 });
    // A customer's email is filed with no owner: nobody's work, not the unassigned row's.
    expect(rows.find((r) => r.ownerId === "none")).toMatchObject({ wonValue: 700, emails: 0 });
    const may = await card("2026-05");
    // Open pipeline has no past: in May, the people with deals open now; the former member only had figures in September.
    expect(may.rows.map((r) => r.ownerId)).toEqual(["anna", "luca", "sara"]);
  });

  it("⚠️ a quarter's target is its months, and the team is measured against the targets that exist", async () => {
    const q3 = await card("2026-Q3");
    const anna = q3.rows.find((r) => r.ownerId === "anna");
    expect(anna?.target).toBe(20000);
    // August's 9000 and September's 4000.
    expect(anna?.wonValue).toBe(13000);
    expect(q3.totals.target).toBe(20000);
    // Only Anna has a target: the others' wins do not count against it.
    expect(q3.totals.attainment).toBe(65);
    expect(q3.totals.wonValue).toBe(14100);
  });

  it("narrows to the people asked for", async () => {
    const { rows } = await card("2026-09", ["luca"]);
    expect(rows.map((r) => r.ownerId)).toEqual(["luca"]);
  });

  it("refuses a period that is not one", async () => {
    expect(await repScorecard(db, { period: "settembre", timeZone: ROME, members })).toBeNull();
  });
});
