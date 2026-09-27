/**
 * Repeating appointments.
 *
 * Every mistake here is multiplied: a wrong rule is not one wrong meeting but
 * every meeting of the series, in this calendar and in every calendar the
 * invitation reached. The cases below are the ones that look right on a Tuesday
 * in October and are wrong in March.
 */
import { describe, expect, it } from "vitest";

import {
  countBefore,
  expandOccurrences,
  formatRRule,
  nextOccurrence,
  nthOfMonth,
  parseRRule,
  type Recurrence,
} from "./recurrence";
import { addMinutesToWall, fromWallValue, toWallDate, toWallValue, wallDiffMinutes } from "./wall-clock";

const TZ = "Europe/Rome";
const at = (wall: string) => fromWallValue(wall, TZ) as Date;
const walls = (dates: Date[]) => dates.map((d) => toWallValue(d, TZ));
/** A rule the test knows to be valid. */
function must(raw: string): Recurrence {
  const rule = parseRRule(raw);
  if (!rule) throw new Error(`not a supported rule: ${raw}`);
  return rule;
}
const YEAR = { from: at("2026-01-01T00:00"), to: at("2028-01-01T00:00") };

describe("reading and writing a rule", () => {
  it("round-trips what the form produces", () => {
    for (const raw of [
      "FREQ=DAILY",
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR",
      "FREQ=MONTHLY;BYDAY=2TU",
      "FREQ=MONTHLY;BYDAY=-1FR;COUNT=6",
      "FREQ=YEARLY;UNTIL=20271231T225959Z",
    ]) {
      expect(formatRRule(must(raw))).toBe(raw);
    }
  });

  it("⚠️ refuses what it cannot expand, rather than expanding it wrongly", () => {
    expect(parseRRule("FREQ=HOURLY")).toBeNull();
    expect(parseRRule("FREQ=MONTHLY;BYMONTHDAY=15")).toBeNull();
    expect(parseRRule("FREQ=WEEKLY;BYDAY=XX")).toBeNull();
    expect(parseRRule("FREQ=DAILY;COUNT=3;UNTIL=20270101")).toBeNull();
    expect(parseRRule("FREQ=DAILY;INTERVAL=0")).toBeNull();
    expect(parseRRule("")).toBeNull();
    expect(parseRRule(null)).toBeNull();
  });

  it("orders the days of the week however they were written", () => {
    expect(parseRRule("FREQ=WEEKLY;BYDAY=FR,MO")?.byDay).toEqual(["MO", "FR"]);
  });
});

describe("expanding a series", () => {
  it("repeats daily, every n days", () => {
    const rule = must("FREQ=DAILY;INTERVAL=2;COUNT=3");
    expect(walls(expandOccurrences({ start: at("2026-10-05T09:00"), rule: rule, timeZone: TZ, ...YEAR }))).toEqual([
      "2026-10-05T09:00",
      "2026-10-07T09:00",
      "2026-10-09T09:00",
    ]);
  });

  it("repeats weekly on the chosen days, starting with the first one", () => {
    const rule = must("FREQ=WEEKLY;BYDAY=MO,TH;COUNT=4");
    // 2026-10-05 is a Monday.
    expect(walls(expandOccurrences({ start: at("2026-10-05T10:00"), rule: rule, timeZone: TZ, ...YEAR }))).toEqual([
      "2026-10-05T10:00",
      "2026-10-08T10:00",
      "2026-10-12T10:00",
      "2026-10-15T10:00",
    ]);
  });

  it("repeats every other week", () => {
    const rule = must("FREQ=WEEKLY;INTERVAL=2;COUNT=3");
    expect(walls(expandOccurrences({ start: at("2026-10-07T10:00"), rule: rule, timeZone: TZ, ...YEAR }))).toEqual([
      "2026-10-07T10:00",
      "2026-10-21T10:00",
      "2026-11-04T10:00",
    ]);
  });

  it("⚠️ keeps the wall-clock time across the change to and from summer time", () => {
    // Rome leaves summer time on 25 October 2026 and enters it on 28 March 2027.
    const rule = must("FREQ=WEEKLY;UNTIL=20270405T000000Z");
    const all = walls(expandOccurrences({ start: at("2026-10-19T10:00"), rule: rule, timeZone: TZ, ...YEAR }));
    expect(all.every((w) => w.endsWith("T10:00"))).toBe(true);
    expect(all).toContain("2026-10-26T10:00");
    expect(all).toContain("2027-03-29T10:00");
  });

  it("⚠️ skips the months without the day, instead of moving it", () => {
    const rule = must("FREQ=MONTHLY;COUNT=4");
    expect(walls(expandOccurrences({ start: at("2027-01-31T09:00"), rule: rule, timeZone: TZ, ...YEAR }))).toEqual([
      "2027-01-31T09:00",
      "2027-03-31T09:00",
      "2027-05-31T09:00",
      "2027-07-31T09:00",
    ]);
  });

  it("repeats on the nth and on the last weekday of the month", () => {
    const second = must("FREQ=MONTHLY;BYDAY=2TU;COUNT=3");
    // 2026-10-13 is the second Tuesday of October.
    expect(walls(expandOccurrences({ start: at("2026-10-13T15:00"), rule: second, timeZone: TZ, ...YEAR }))).toEqual([
      "2026-10-13T15:00",
      "2026-11-10T15:00",
      "2026-12-08T15:00",
    ]);
    const last = must("FREQ=MONTHLY;BYDAY=-1FR;COUNT=3");
    expect(walls(expandOccurrences({ start: at("2026-10-30T15:00"), rule: last, timeZone: TZ, ...YEAR }))).toEqual([
      "2026-10-30T15:00",
      "2026-11-27T15:00",
      "2026-12-25T15:00",
    ]);
  });

  it("repeats yearly, and skips the 29th of February in ordinary years", () => {
    const rule = must("FREQ=YEARLY;COUNT=2");
    const wide = { from: at("2028-01-01T00:00"), to: at("2040-01-01T00:00") };
    expect(walls(expandOccurrences({ start: at("2028-02-29T09:00"), rule: rule, timeZone: TZ, ...wide }))).toEqual([
      "2028-02-29T09:00",
      "2032-02-29T09:00",
    ]);
  });

  it("stops at UNTIL, inclusive", () => {
    const rule = must("FREQ=DAILY;UNTIL=20261007T080000Z"); // 10:00 in Rome
    expect(walls(expandOccurrences({ start: at("2026-10-05T10:00"), rule: rule, timeZone: TZ, ...YEAR }))).toEqual([
      "2026-10-05T10:00",
      "2026-10-06T10:00",
      "2026-10-07T10:00",
    ]);
  });

  it("⚠️ counts removed occurrences towards COUNT, as RFC 5545 does", () => {
    const rule = must("FREQ=DAILY;COUNT=3");
    const got = expandOccurrences({
      start: at("2026-10-05T10:00"),
      rule: rule,
      timeZone: TZ,
      exceptions: [at("2026-10-06T10:00").toISOString()],
      ...YEAR,
    });
    expect(walls(got)).toEqual(["2026-10-05T10:00", "2026-10-07T10:00"]);
  });

  it("returns only what overlaps the window, including one already under way", () => {
    const rule = must("FREQ=DAILY");
    const got = expandOccurrences({
      start: at("2026-10-01T23:00"),
      rule: rule,
      timeZone: TZ,
      from: at("2026-10-10T00:00"),
      to: at("2026-10-11T00:00"),
      durationMs: 2 * 3_600_000,
    });
    expect(walls(got)).toEqual(["2026-10-09T23:00", "2026-10-10T23:00"]);
  });

  it("finds the next occurrence, and none once the series is over", () => {
    const rule = must("FREQ=WEEKLY;COUNT=2");
    const start = at("2026-10-05T10:00");
    expect(
      toWallValue(nextOccurrence({ start, rule: rule, timeZone: TZ, after: at("2026-10-06T00:00") }) as Date, TZ),
    ).toBe("2026-10-12T10:00");
    expect(nextOccurrence({ start, rule: rule, timeZone: TZ, after: at("2026-10-13T00:00") })).toBeNull();
  });

  it("counts the occurrences before a date, for a series cut short there", () => {
    const rule = must("FREQ=DAILY;COUNT=10");
    expect(
      countBefore({ start: at("2026-10-05T10:00"), rule: rule, timeZone: TZ, before: at("2026-10-08T10:00") }),
    ).toBe(3);
  });

  it("names the nth weekday a date is", () => {
    expect(nthOfMonth(at("2026-10-13T10:00"), TZ)).toBe(2);
    expect(nthOfMonth(at("2026-10-30T10:00"), TZ)).toBe(-1);
  });
});

describe("the wall clock", () => {
  it("reads and writes a zone's clock whatever the machine's zone is", () => {
    const instant = new Date("2026-10-05T08:00:00Z");
    expect(toWallValue(instant, TZ)).toBe("2026-10-05T10:00");
    expect(toWallValue(instant, "America/New_York")).toBe("2026-10-05T04:00");
    expect(fromWallValue("2026-10-05T10:00", TZ)?.toISOString()).toBe("2026-10-05T08:00:00.000Z");
    expect(fromWallValue("2026-10-05", TZ)?.toISOString()).toBe("2026-10-04T22:00:00.000Z");
    expect(toWallDate(new Date("2026-10-04T22:30:00Z"), TZ)).toBe("2026-10-05");
    expect(fromWallValue("nonsense", TZ)).toBeNull();
  });

  it("moves along the wall clock, across midnight and months", () => {
    expect(addMinutesToWall("2026-10-31T23:30", 60)).toBe("2026-11-01T00:30");
    expect(addMinutesToWall("2026-11-01T00:30", -60)).toBe("2026-10-31T23:30");
    expect(wallDiffMinutes("2026-10-31T23:30", "2026-11-01T01:00")).toBe(90);
  });
});
