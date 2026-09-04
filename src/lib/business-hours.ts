/**
 * business-hours.ts — SLA time that only runs while the office is open.
 *
 * An SLA was measured on the wall clock (audit rilievo S-07). A four-hour
 * promise on a ticket that arrives at 17:00 on Friday is therefore breached by
 * 21:00 on Friday, in the middle of the night, and the team is told on Monday
 * that it failed something nobody was there for. The same arithmetic makes every
 * support metric wrong in the same direction, quietly, for ever.
 *
 * This module answers one question — what instant is N working minutes from
 * here — against a workspace's own week, holidays and time zone.
 *
 * No dependency does the time-zone part: `date-fns` alone cannot, and the bundle
 * is already close to the Workers limit. `Intl` can, and is available everywhere
 * this runs.
 */

/** Minutes from local midnight. `close` is exclusive. */
export interface DaySchedule {
  openMinute: number;
  closeMinute: number;
}

/** Seven entries, Sunday first, to match `Date.getUTCDay()`. Null means closed. */
export type WeekSchedule = (DaySchedule | null)[];

export interface BusinessCalendar {
  /** IANA name, e.g. "Europe/Rome". */
  timeZone: string;
  week: WeekSchedule;
  /** Closed days as "YYYY-MM-DD", read in the calendar's own zone. */
  holidays: string[];
}

/** Monday to Friday, 9 to 18. What most workspaces mean by "open". */
export const DEFAULT_WEEK: WeekSchedule = [
  null, // Sunday
  { openMinute: 9 * 60, closeMinute: 18 * 60 },
  { openMinute: 9 * 60, closeMinute: 18 * 60 },
  { openMinute: 9 * 60, closeMinute: 18 * 60 },
  { openMinute: 9 * 60, closeMinute: 18 * 60 },
  { openMinute: 9 * 60, closeMinute: 18 * 60 },
  null, // Saturday
];

const MINUTE = 60_000;
const DAY_MINUTES = 24 * 60;

/** A day the search will not run past, so a broken calendar cannot loop forever. */
const MAX_DAYS_AHEAD = 400;

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday. */
  weekday: number;
}

const partsFormatter = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = partsFormatter.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
    });
    partsFormatter.set(timeZone, f);
  }
  return f;
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The wall clock in a given zone, at a given instant. */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  // "24" appears at midnight in some engines; both mean the same instant.
  const hour = Number(get("hour")) % 24;
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour,
    minute: Number(get("minute")),
    weekday: WEEKDAY_INDEX[get("weekday")] ?? 0,
  };
}

/** How far the zone is from UTC at this instant, in milliseconds. */
function offsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0, 0);
  // Seconds and milliseconds are not in the formatted parts, so compare on the
  // minute the instant actually falls in.
  const flooredInstant = Math.floor(instant.getTime() / MINUTE) * MINUTE;
  return asUtc - flooredInstant;
}

/**
 * The instant at which a given wall clock reads in a zone.
 *
 * Two passes, because the offset depends on the answer: guess with the offset at
 * the naive instant, then correct once if the guess landed on the other side of a
 * daylight-saving change. Without the second pass the hour before a spring-forward
 * comes back an hour early — 01:00 in Rome on the last Sunday of March becomes
 * midnight.
 *
 * A wall clock inside the hour a spring-forward skips names no instant at all.
 * This resolves it to the last moment before the gap rather than the first after
 * it, which for a deadline is the safe direction: early, never late.
 */
export function instantFromZoned(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  minutesFromMidnight: number,
): Date {
  const naive = Date.UTC(year, month - 1, day, 0, 0, 0, 0) + minutesFromMidnight * MINUTE;
  const firstOffset = offsetMs(new Date(naive), timeZone);
  const firstGuess = naive - firstOffset;
  const secondOffset = offsetMs(new Date(firstGuess), timeZone);
  return new Date(secondOffset === firstOffset ? firstGuess : naive - secondOffset);
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The open window on a given local date, or null when the office is shut. */
function windowOn(
  cal: BusinessCalendar,
  year: number,
  month: number,
  day: number,
  weekday: number,
): DaySchedule | null {
  if (cal.holidays.includes(dateKey(year, month, day))) return null;
  // A day that closes before it opens needs no guard here: every caller compares
  // the two ends and finds nothing between them, so such a day contributes zero
  // either way. A check that cannot change an answer is defence that has not
  // earned its place, and `scripts/mutations/business-hours.json` says so.
  return cal.week[weekday] ?? null;
}

/** True when the office is open at that instant. */
export function isWithinBusinessHours(instant: Date, cal: BusinessCalendar): boolean {
  const p = zonedParts(instant, cal.timeZone);
  const win = windowOn(cal, p.year, p.month, p.day, p.weekday);
  if (!win) return false;
  const minuteOfDay = p.hour * 60 + p.minute;
  return minuteOfDay >= win.openMinute && minuteOfDay < win.closeMinute;
}

/** Steps a local date forward by one day, without touching instants. */
function nextLocalDay(year: number, month: number, day: number): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + 1);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * The instant `minutes` of open time after `from`.
 *
 * A ticket arriving outside opening hours starts its clock when the office next
 * opens, which is what a customer reading "four working hours" understands.
 *
 * A calendar that is closed every day of the week has no answer, so the wall
 * clock is used and the caller keeps a deadline rather than none. That is the
 * only case where this falls back, and it is a misconfiguration.
 */
export function addBusinessMinutes(from: Date, minutes: number, cal: BusinessCalendar): Date {
  if (minutes <= 0) return new Date(from.getTime());
  if (!cal.week.some((d) => d && d.closeMinute > d.openMinute)) {
    return new Date(from.getTime() + minutes * MINUTE);
  }

  let remaining = minutes;
  const start = zonedParts(from, cal.timeZone);
  let { year, month, day } = start;
  let cursorMinute = start.hour * 60 + start.minute;
  let weekday = start.weekday;

  for (let guard = 0; guard < MAX_DAYS_AHEAD; guard++) {
    const win = windowOn(cal, year, month, day, weekday);

    if (win) {
      // The clock never runs before opening: a ticket at 07:00 starts at 09:00.
      const from_ = Math.max(cursorMinute, win.openMinute);
      const available = win.closeMinute - from_;

      if (available > 0) {
        if (remaining <= available) {
          return instantFromZoned(cal.timeZone, year, month, day, from_ + remaining);
        }
        remaining -= available;
      }
    }

    const next = nextLocalDay(year, month, day);
    year = next.year;
    month = next.month;
    day = next.day;
    weekday = weekdayOf(year, month, day);
    cursorMinute = 0;
  }

  // Beyond a year of closed days something is wrong with the calendar; returning
  // a far deadline is better than returning none, and it is visibly absurd.
  return instantFromZoned(cal.timeZone, year, month, day, 0);
}

/**
 * Open minutes between two instants. Zero when `to` is not after `from`.
 *
 * Used to say how much of an SLA has actually been consumed, which is the number
 * a warning threshold is a fraction of.
 */
export function businessMinutesBetween(from: Date, to: Date, cal: BusinessCalendar): number {
  if (to.getTime() <= from.getTime()) return 0;

  let total = 0;
  const start = zonedParts(from, cal.timeZone);
  const end = zonedParts(to, cal.timeZone);
  const endKey = dateKey(end.year, end.month, end.day);
  const endMinute = end.hour * 60 + end.minute;

  let { year, month, day } = start;
  let cursorMinute = start.hour * 60 + start.minute;
  let weekday = start.weekday;

  for (let guard = 0; guard < MAX_DAYS_AHEAD; guard++) {
    const key = dateKey(year, month, day);
    const win = windowOn(cal, year, month, day, weekday);
    const isLastDay = key === endKey;

    if (win) {
      const open = Math.max(cursorMinute, win.openMinute);
      const close = Math.min(win.closeMinute, isLastDay ? endMinute : DAY_MINUTES);
      if (close > open) total += close - open;
    }

    if (isLastDay) return total;

    const next = nextLocalDay(year, month, day);
    year = next.year;
    month = next.month;
    day = next.day;
    weekday = weekdayOf(year, month, day);
    cursorMinute = 0;
  }

  return total;
}
