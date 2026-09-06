/**
 * Reading a calendar somebody else published.
 *
 * On the tested surface because of the specific way this fails. A parser that
 * drops an event does not report anything: the week simply looks free, and
 * somebody books a meeting on top of one that already exists. There is no error
 * to notice, only a double booking a fortnight later that nobody traces back.
 *
 * So the two properties held here are that what it reads it reads correctly, and
 * that what it cannot read it **says** rather than silently omits.
 */
import { describe, expect, it } from "vitest";

import { expandRrule, parseDuration, parseIcal, parseIcalDate, parseLine, unescapeText, unfold } from "./ical-parse";

const feed = (...events: string[][]) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    ...events.flatMap((e) => ["BEGIN:VEVENT", ...e, "END:VEVENT"]),
    "END:VCALENDAR",
  ].join("\r\n");

const WINDOW = { from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-09-30T23:59:59Z") };

describe("lines", () => {
  it("⚠️ removes a fold and the space that marks it", () => {
    // That space is the fold, not content. Keeping it inserts a space into every
    // long summary in the feed, which then looks like the publisher's fault.
    expect(unfold("SUMMARY:Longer\r\n line")).toBe("SUMMARY:Longerline");
    expect(unfold("SUMMARY:Longer\n\tline")).toBe("SUMMARY:Longerline");
  });

  it("restores escaped text", () => {
    expect(unescapeText("Rossi\\, Anna")).toBe("Rossi, Anna");
    expect(unescapeText("first\\nsecond")).toBe("first\nsecond");
    expect(unescapeText("a\\\\b")).toBe("a\\b");
  });

  it("reads a property with parameters", () => {
    expect(parseLine("DTSTART;TZID=Europe/Rome:20260910T140000")).toEqual({
      name: "DTSTART",
      params: { TZID: "Europe/Rome" },
      value: "20260910T140000",
    });
  });

  it("⚠️ splits on the colon that ends the head, not the first one", () => {
    // A quoted parameter may contain a colon, and splitting on the first one
    // gives a property called `ATTENDEE;CN="Rossi` — after which everything else
    // in that event is misread.
    const line = parseLine('ATTENDEE;CN="Rossi: Anna";ROLE=CHAIR:mailto:anna@example.it');
    expect(line?.name).toBe("ATTENDEE");
    expect(line?.value).toBe("mailto:anna@example.it");
    expect(line?.params.CN).toBe("Rossi: Anna");
  });
});

describe("dates", () => {
  it("reads a UTC stamp", () => {
    expect(parseIcalDate("20260910T140000Z", {}, "UTC")?.at.toISOString()).toBe("2026-09-10T14:00:00.000Z");
  });

  it("marks a whole-day value as such", () => {
    const d = parseIcalDate("20260910", {}, "UTC");
    expect(d?.allDay).toBe(true);
  });

  it("⚠️ resolves a zoned time through its zone, not the server's", () => {
    // The server's zone is an accident of where this happens to run. Using it
    // would move somebody's 14:00 meeting by however far away the data centre is.
    expect(parseIcalDate("20260910T140000", { TZID: "Europe/Rome" }, "UTC")?.at.toISOString()).toBe(
      "2026-09-10T12:00:00.000Z",
    );
  });

  it("⚠️ gets the other side of a daylight-saving change right", () => {
    // Rome is +2 in September and +1 in January. A single-pass offset lookup
    // lands an hour out on one of the two, and only on one.
    expect(parseIcalDate("20260110T140000", { TZID: "Europe/Rome" }, "UTC")?.at.toISOString()).toBe(
      "2026-01-10T13:00:00.000Z",
    );
  });

  it("⚠️⚠️ reads the offset at the instant it computed, not at the one it guessed", () => {
    // Auckland moves to +13 at 02:00 on 27 September 2026. A wall clock of 01:00
    // that morning is still +12, but the naive instant 01:00Z falls at 14:00
    // local — on the far side of the change — so a single offset lookup answers
    // +13 and lands the appointment an hour early. Two passes correct it, and
    // this is the only kind of input that can tell them apart.
    expect(parseIcalDate("20260927T010000", { TZID: "Pacific/Auckland" }, "UTC")?.at.toISOString()).toBe(
      "2026-09-26T13:00:00.000Z",
    );
  });

  it("refuses a value it cannot read rather than inventing one", () => {
    expect(parseIcalDate("not-a-date", {}, "UTC")).toBeNull();
  });
});

describe("durations", () => {
  it("reads the shapes iCalendar allows", () => {
    expect(parseDuration("PT30M")).toBe(1_800_000);
    expect(parseDuration("PT1H30M")).toBe(5_400_000);
    expect(parseDuration("P1D")).toBe(86_400_000);
    expect(parseDuration("P1W")).toBe(604_800_000);
  });

  it("refuses one it does not understand", () => {
    expect(parseDuration("30 minutes")).toBeNull();
  });
});

describe("recurrence", () => {
  const start = new Date("2026-09-01T09:00:00Z"); // a Tuesday
  const days = (rule: string) => expandRrule(rule, start, WINDOW, 100)?.map((d) => d.toISOString().slice(0, 10));

  it("repeats daily, and stops at the count", () => {
    expect(days("FREQ=DAILY;COUNT=3")).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
  });

  it("honours an interval", () => {
    expect(days("FREQ=WEEKLY;INTERVAL=2;COUNT=3")).toEqual(["2026-09-01", "2026-09-15", "2026-09-29"]);
  });

  it("repeats on the named days of the week", () => {
    expect(days("FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4")).toEqual(["2026-09-02", "2026-09-07", "2026-09-09", "2026-09-14"]);
  });

  it("stops at UNTIL", () => {
    expect(days("FREQ=DAILY;UNTIL=20260903T235959Z")).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
  });

  it("⚠️ refuses a rule it cannot expand instead of returning nothing", () => {
    // Null and an empty list are different claims. Empty says "this never
    // happens" and shows a free week; null says "I could not read this", and the
    // caller reports it so the gap is visible.
    for (const rule of [
      "FREQ=MONTHLY;BYSETPOS=-1;BYDAY=FR",
      "FREQ=WEEKLY;BYDAY=2MO",
      "FREQ=HOURLY",
      "FREQ=MONTHLY;BYMONTHDAY=15",
      "INTERVAL=2",
      // ⚠️ Mixed: one day it understands and one it does not. Dropping the
      // second quietly would turn "the second Tuesday" into nothing at all
      // while still repeating every Monday — a rule half obeyed.
      "FREQ=WEEKLY;BYDAY=MO,2TU",
    ]) {
      expect(expandRrule(rule, start, WINDOW, 100), rule).toBeNull();
    }
  });

  it("does not run away on an endless rule", () => {
    const out = expandRrule("FREQ=DAILY", start, WINDOW, 10);
    expect(out).not.toBeNull();
    expect((out as Date[]).length).toBeLessThanOrEqual(11);
  });
});

describe("a whole feed", () => {
  it("reads a plain event", () => {
    const { events } = parseIcal(
      feed(["UID:a@x", "DTSTART:20260910T140000Z", "DTEND:20260910T150000Z", "SUMMARY:Standup with Rossi\\, Anna"]),
      WINDOW,
    );
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe("Standup with Rossi, Anna");
    expect(events[0].end.toISOString()).toBe("2026-09-10T15:00:00.000Z");
  });

  it("⚠️ drops a cancelled event", () => {
    // It is in the feed precisely so subscribers remove it: a client that stops
    // seeing an event keeps the copy it has.
    const { events } = parseIcal(
      feed(["UID:b@x", "DTSTART:20260910T140000Z", "DTEND:20260910T150000Z", "STATUS:CANCELLED"]),
      WINDOW,
    );
    expect(events).toEqual([]);
  });

  it("accepts a DURATION where there is no DTEND", () => {
    const { events } = parseIcal(feed(["UID:c@x", "DTSTART:20260910T140000Z", "DURATION:PT45M"]), WINDOW);
    expect(events[0].end.toISOString()).toBe("2026-09-10T14:45:00.000Z");
  });

  it("gives a whole-day event with no end the whole day", () => {
    const { events } = parseIcal(feed(["UID:d@x", "DTSTART;VALUE=DATE:20260910"]), WINDOW);
    expect(events[0].allDay).toBe(true);
    expect(events[0].end.toISOString()).toBe("2026-09-11T00:00:00.000Z");
  });

  it("expands a recurring event and honours EXDATE", () => {
    const { events } = parseIcal(
      feed([
        "UID:e@x",
        "DTSTART:20260901T080000Z",
        "DURATION:PT30M",
        "RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=3",
        "EXDATE:20260908T080000Z",
        "SUMMARY:Weekly",
      ]),
      WINDOW,
    );
    expect(events.map((e) => e.start.toISOString().slice(0, 10))).toEqual(["2026-09-01", "2026-09-15"]);
    expect(events.every((e) => e.recurring)).toBe(true);
  });

  it("⚠️ counts what it could not read instead of leaving a quiet week", () => {
    const { events, skipped } = parseIcal(
      feed(
        ["UID:f@x", "DTSTART:20260915T100000Z", "DTEND:20260915T110000Z", "RRULE:FREQ=MONTHLY;BYSETPOS=-1;BYDAY=FR"],
        ["UID:g@x", "DTSTART:20260916T100000Z", "DTEND:20260916T110000Z", "SUMMARY:Fine"],
      ),
      WINDOW,
    );
    expect(events.map((e) => e.uid)).toEqual(["g@x"]);
    expect(skipped.map((s) => s.uid)).toEqual(["f@x"]);
  });

  it("leaves out what falls outside the window", () => {
    const { events } = parseIcal(
      feed(["UID:h@x", "DTSTART:20261115T100000Z", "DTEND:20261115T110000Z", "SUMMARY:Later"]),
      WINDOW,
    );
    expect(events).toEqual([]);
  });

  it("survives rubbish instead of throwing", () => {
    for (const text of ["", "not a calendar", "BEGIN:VCALENDAR\r\nEND:VCALENDAR", "BEGIN:VEVENT\r\nEND:VEVENT"]) {
      expect(() => parseIcal(text, WINDOW), JSON.stringify(text.slice(0, 20))).not.toThrow();
    }
  });
});
