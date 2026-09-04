/**
 * Working-hours arithmetic.
 *
 * On the tested surface because a wrong answer here is silent and systematic: a
 * deadline is stored, a job compares against it, and the team is told a promise
 * was kept or missed. Nobody ever sees the calculation. Weekends, holidays and
 * daylight saving are exactly where it goes wrong, and exactly what is hard to
 * notice by looking.
 */
import { describe, expect, it } from "vitest";

import {
  addBusinessMinutes,
  type BusinessCalendar,
  businessMinutesBetween,
  DEFAULT_WEEK,
  instantFromZoned,
  isWithinBusinessHours,
} from "./business-hours";

const rome: BusinessCalendar = { timeZone: "Europe/Rome", week: DEFAULT_WEEK, holidays: [] };

/** An instant, written as Rome wall-clock time. */
const at = (y: number, m: number, d: number, hh: number, mm = 0) =>
  instantFromZoned("Europe/Rome", y, m, d, hh * 60 + mm);

/** The same instant read back as Rome wall-clock, for readable assertions. */
const readable = (date: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);

describe("addBusinessMinutes", () => {
  it("stays inside the day when there is room", () => {
    // Tuesday 10:00 + 2h = 12:00.
    expect(readable(addBusinessMinutes(at(2026, 9, 8, 10), 120, rome))).toBe("08/09/2026, 12:00");
  });

  it("does not run through the night", () => {
    // Tuesday 17:00 + 4h lands at 12:00 on Wednesday, not 21:00 on Tuesday.
    expect(readable(addBusinessMinutes(at(2026, 9, 8, 17), 240, rome))).toBe("09/09/2026, 12:00");
  });

  it("does not run through the weekend", () => {
    // The case from the audit: Friday 17:00 with a four-hour promise. On the wall
    // clock that breaches at 21:00 on Friday, with nobody there.
    expect(readable(addBusinessMinutes(at(2026, 9, 11, 17), 240, rome))).toBe("14/09/2026, 12:00");
  });

  it("starts the clock when the office opens, not when the ticket arrives", () => {
    // Sunday 03:00: nothing is consumed until Monday at 09:00.
    expect(readable(addBusinessMinutes(at(2026, 9, 13, 3), 60, rome))).toBe("14/09/2026, 10:00");
  });

  it("starts at opening for a ticket that arrives before it", () => {
    expect(readable(addBusinessMinutes(at(2026, 9, 8, 7), 30, rome))).toBe("08/09/2026, 09:30");
  });

  it("skips a holiday", () => {
    const withHoliday: BusinessCalendar = { ...rome, holidays: ["2026-09-09"] };
    // Tuesday 17:00 + 4h would land on Wednesday; Wednesday is closed.
    expect(readable(addBusinessMinutes(at(2026, 9, 8, 17), 240, withHoliday))).toBe("10/09/2026, 12:00");
  });

  it("crosses a daylight-saving change without losing or gaining an hour", () => {
    // Europe/Rome falls back on Sunday 25 October 2026, so the weekend in the
    // middle of this span is 25 hours long on the wall clock. Friday 16:00 + 3h
    // consumes two hours on Friday and one on Monday, and the answer must be the
    // same 10:00 it would be in a week with no change in it.
    expect(readable(addBusinessMinutes(at(2026, 10, 23, 16), 180, rome))).toBe("26/10/2026, 10:00");

    // The same shape a fortnight earlier, with no offset change, for comparison.
    expect(readable(addBusinessMinutes(at(2026, 10, 9, 16), 180, rome))).toBe("12/10/2026, 10:00");
  });

  it("consumes several days when the promise is long", () => {
    // Nine open hours a day: 20 hours is two full days plus two hours.
    expect(readable(addBusinessMinutes(at(2026, 9, 7, 9), 20 * 60, rome))).toBe("09/09/2026, 11:00");
  });

  it("returns the start for a promise of no time at all", () => {
    const start = at(2026, 9, 8, 10);
    expect(addBusinessMinutes(start, 0, rome).getTime()).toBe(start.getTime());
  });

  it("falls back to the wall clock when every day is closed", () => {
    // A misconfigured calendar must still produce a deadline rather than none.
    const shut: BusinessCalendar = { ...rome, week: [null, null, null, null, null, null, null] };
    const start = at(2026, 9, 8, 10);
    expect(addBusinessMinutes(start, 120, shut).getTime()).toBe(start.getTime() + 120 * 60_000);
  });
});

describe("businessMinutesBetween", () => {
  it("counts only open time", () => {
    expect(businessMinutesBetween(at(2026, 9, 8, 17), at(2026, 9, 9, 10), rome)).toBe(120);
  });

  it("counts nothing across a closed weekend", () => {
    expect(businessMinutesBetween(at(2026, 9, 12, 10), at(2026, 9, 13, 18), rome)).toBe(0);
  });

  it("is zero when the end is not after the start", () => {
    expect(businessMinutesBetween(at(2026, 9, 8, 12), at(2026, 9, 8, 12), rome)).toBe(0);
    expect(businessMinutesBetween(at(2026, 9, 8, 12), at(2026, 9, 8, 11), rome)).toBe(0);
  });

  it("agrees with addBusinessMinutes", () => {
    // The two have to be each other's inverse, or a warning threshold computed
    // from one will not line up with a deadline computed from the other.
    const start = at(2026, 9, 11, 16);
    const deadline = addBusinessMinutes(start, 300, rome);
    expect(businessMinutesBetween(start, deadline, rome)).toBe(300);
  });
});

describe("isWithinBusinessHours", () => {
  it("knows when the office is open", () => {
    expect(isWithinBusinessHours(at(2026, 9, 8, 10), rome)).toBe(true);
    expect(isWithinBusinessHours(at(2026, 9, 8, 8, 59), rome)).toBe(false);
    // Closing is exclusive: 18:00 is shut.
    expect(isWithinBusinessHours(at(2026, 9, 8, 18), rome)).toBe(false);
  });

  it("is closed at the weekend and on a holiday", () => {
    expect(isWithinBusinessHours(at(2026, 9, 12, 11), rome)).toBe(false);
    expect(isWithinBusinessHours(at(2026, 9, 9, 11), { ...rome, holidays: ["2026-09-09"] })).toBe(false);
  });
});

describe("instantFromZoned", () => {
  /** Reads an instant back as wall-clock in a zone, to check the round trip. */
  const readIn = (date: Date, timeZone: string) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);

  it("round-trips the hour before the clocks go forward", () => {
    // Europe/Rome springs forward at 02:00 on 29 March 2026. One pass at the
    // offset reads it from the wrong side of the change and lands an hour early:
    // 01:00 becomes midnight. This is the case the second pass exists for.
    const instant = instantFromZoned("Europe/Rome", 2026, 3, 29, 60);
    expect(readIn(instant, "Europe/Rome")).toBe("29/03/2026, 01:00");
  });

  it("round-trips in another zone, so this is not a fact about Rome", () => {
    // New York springs forward at 02:00 on 8 March 2026, so 01:00 is the hour
    // that needs the correction there.
    expect(readIn(instantFromZoned("America/New_York", 2026, 3, 8, 60), "America/New_York")).toBe("08/03/2026, 01:00");
  });

  it("resolves an hour that does not exist to the moment before the gap", () => {
    // 02:00 on 8 March is skipped in New York. Something has to be returned, and
    // the earlier side is the safe one for a deadline: early, never late.
    expect(readIn(instantFromZoned("America/New_York", 2026, 3, 8, 120), "America/New_York")).toBe("08/03/2026, 01:00");
  });

  it("round-trips an ordinary time", () => {
    expect(readIn(instantFromZoned("Europe/Rome", 2026, 9, 8, 14 * 60 + 30), "Europe/Rome")).toBe("08/09/2026, 14:30");
  });
});

describe("a malformed week", () => {
  it("treats a day that closes before it opens as closed", () => {
    // Otherwise the window is negative and the arithmetic quietly runs backwards.
    const broken: BusinessCalendar = {
      ...rome,
      week: [null, { openMinute: 18 * 60, closeMinute: 9 * 60 }, ...DEFAULT_WEEK.slice(2)],
    };
    expect(isWithinBusinessHours(at(2026, 9, 7, 12), broken)).toBe(false);
    // Monday contributes nothing, so a Monday-morning hour is served on Tuesday.
    expect(readable(addBusinessMinutes(at(2026, 9, 7, 10), 60, broken))).toBe("08/09/2026, 10:00");
    expect(businessMinutesBetween(at(2026, 9, 7, 9), at(2026, 9, 7, 18), broken)).toBe(0);
  });
});
