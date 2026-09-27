/**
 * recurrence.ts — the repeating appointments this product understands.
 *
 * Stored as an RFC 5545 RRULE so that the same string goes, unchanged, into the
 * invitation and the subscription feed, and every calendar that receives it
 * expands it the same way this module does. Only the subset the form can produce
 * is supported, and anything else parses to null rather than to a guess:
 *
 *   FREQ      DAILY | WEEKLY | MONTHLY | YEARLY
 *   INTERVAL  every n periods
 *   BYDAY     WEEKLY: a list of days (MO,WE,FR)
 *             MONTHLY: one ordinal day (2TU = second Tuesday, -1FR = last Friday)
 *   COUNT     how many occurrences, the first included
 *   UNTIL     the last moment an occurrence may start, as a UTC instant
 *
 * ⚠️ Occurrences are generated on the series' own wall clock, never by adding
 * milliseconds. A weekly meeting at ten stays at ten across the change to summer
 * time; adding seven days of milliseconds would move it to eleven for half the
 * year, in every calendar at once.
 *
 * ⚠️ COUNT counts occurrences before exceptions are removed (RFC 5545 §3.8.5.1).
 * Deleting one meeting from a series of ten leaves nine, not ten with the last
 * one moved a week later.
 */

import { instantFromZoned } from "@/lib/business-hours";
import { wallParts } from "@/lib/wall-clock";

export const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export type Frequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export interface Recurrence {
  freq: Frequency;
  interval: number;
  /** WEEKLY only: the days of the week it happens on. */
  byDay?: Weekday[];
  /** MONTHLY only: "the nth weekday" instead of "the same day of the month". */
  nthWeekday?: { n: 1 | 2 | 3 | 4 | -1; day: Weekday };
  count?: number;
  until?: Date;
}

const FREQUENCIES: readonly Frequency[] = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];

/** Safety net: no series is expanded further than this many steps. */
const MAX_STEPS = 20_000;

function parseUntil(v: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(v);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  // A date-only UNTIL is inclusive of that whole day.
  if (h === undefined) return new Date(Date.UTC(+y, +mo - 1, +d, 23, 59, 59));
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
}

function formatUntil(d: Date): string {
  return `${d.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

/** Reads a stored rule. Null when it is empty or outside the supported subset. */
export function parseRRule(raw: string | null | undefined): Recurrence | null {
  if (!raw) return null;
  const fields = new Map<string, string>();
  for (const part of raw.replace(/^RRULE:/i, "").split(";")) {
    const [k, v] = part.split("=");
    if (k && v !== undefined) fields.set(k.trim().toUpperCase(), v.trim().toUpperCase());
  }
  const freq = fields.get("FREQ") as Frequency | undefined;
  if (!freq || !FREQUENCIES.includes(freq)) return null;
  for (const key of fields.keys()) {
    if (!["FREQ", "INTERVAL", "BYDAY", "COUNT", "UNTIL", "WKST"].includes(key)) return null;
  }

  const interval = fields.has("INTERVAL") ? Number(fields.get("INTERVAL")) : 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > 999) return null;
  const rule: Recurrence = { freq, interval };

  const byDay = fields.get("BYDAY");
  if (byDay) {
    if (freq === "WEEKLY") {
      const days = byDay.split(",");
      if (!days.every((d): d is Weekday => (WEEKDAYS as readonly string[]).includes(d))) return null;
      rule.byDay = WEEKDAYS.filter((d) => days.includes(d));
    } else if (freq === "MONTHLY") {
      const m = /^(-1|[1-4])(MO|TU|WE|TH|FR|SA|SU)$/.exec(byDay);
      if (!m) return null;
      rule.nthWeekday = { n: Number(m[1]) as 1 | 2 | 3 | 4 | -1, day: m[2] as Weekday };
    } else {
      return null;
    }
  }

  if (fields.has("COUNT") && fields.has("UNTIL")) return null;
  if (fields.has("COUNT")) {
    const count = Number(fields.get("COUNT"));
    if (!Number.isInteger(count) || count < 1) return null;
    rule.count = count;
  }
  if (fields.has("UNTIL")) {
    const until = parseUntil(fields.get("UNTIL") ?? "");
    if (!until) return null;
    rule.until = until;
  }
  return rule;
}

/** Writes a rule the way it is stored and sent. */
export function formatRRule(rule: Recurrence): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.freq === "WEEKLY" && rule.byDay?.length) parts.push(`BYDAY=${rule.byDay.join(",")}`);
  if (rule.freq === "MONTHLY" && rule.nthWeekday) parts.push(`BYDAY=${rule.nthWeekday.n}${rule.nthWeekday.day}`);
  if (rule.count) parts.push(`COUNT=${rule.count}`);
  else if (rule.until) parts.push(`UNTIL=${formatUntil(rule.until)}`);
  return parts.join(";");
}

// ─── Calendar arithmetic on plain dates ──────────────────────────────────────

type YMD = { y: number; m: number; d: number };

const utc = (v: YMD) => Date.UTC(v.y, v.m - 1, v.d);
const fromUtc = (t: number): YMD => {
  const x = new Date(t);
  return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate() };
};
const addDays = (v: YMD, n: number): YMD => fromUtc(utc(v) + n * 86_400_000);
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** 0 = Monday. */
const weekdayOf = (v: YMD) => (new Date(utc(v)).getUTCDay() + 6) % 7;

function nthWeekdayOf(y: number, m: number, n: number, weekday: number): YMD | null {
  if (n === -1) {
    const last = daysInMonth(y, m);
    const lastWd = weekdayOf({ y, m, d: last });
    return { y, m, d: last - ((lastWd - weekday + 7) % 7) };
  }
  const firstWd = weekdayOf({ y, m, d: 1 });
  const d = 1 + ((weekday - firstWd + 7) % 7) + (n - 1) * 7;
  return d <= daysInMonth(y, m) ? { y, m, d } : null;
}

/** Every date the rule produces from `start` on, the start itself first. */
function* candidateDates(start: YMD, rule: Recurrence): Generator<YMD> {
  yield start;
  const startT = utc(start);
  const i = rule.interval;

  if (rule.freq === "DAILY") {
    for (let k = 1; ; k++) yield addDays(start, k * i);
  }

  if (rule.freq === "WEEKLY") {
    const days = (rule.byDay?.length ? rule.byDay : [WEEKDAYS[weekdayOf(start)]]).map((d) => WEEKDAYS.indexOf(d));
    const monday = addDays(start, -weekdayOf(start));
    for (let w = 0; ; w++) {
      const base = addDays(monday, w * i * 7);
      for (const idx of days) {
        const date = addDays(base, idx);
        if (utc(date) > startT) yield date;
      }
    }
  }

  if (rule.freq === "MONTHLY") {
    for (let k = rule.nthWeekday ? 0 : 1; ; k++) {
      const total = start.m - 1 + k * i;
      const y = start.y + Math.floor(total / 12);
      const m = (total % 12) + 1;
      if (rule.nthWeekday) {
        const date = nthWeekdayOf(y, m, rule.nthWeekday.n, WEEKDAYS.indexOf(rule.nthWeekday.day));
        if (date && utc(date) > startT) yield date;
      } else if (start.d <= daysInMonth(y, m)) {
        // The 31st does not exist in every month; RFC 5545 skips those months.
        yield { y, m, d: start.d };
      } else {
        yield* [];
      }
    }
  }

  if (rule.freq === "YEARLY") {
    for (let k = 1; ; k++) {
      const y = start.y + k * i;
      if (start.d <= daysInMonth(y, start.m)) yield { y, m: start.m, d: start.d };
    }
  }
}

export interface ExpandOptions {
  /** The first occurrence. */
  start: Date;
  rule: Recurrence;
  /** The zone whose wall clock the series keeps to. */
  timeZone: string;
  /** Starts of occurrences that were removed. */
  exceptions?: readonly (string | Date)[] | null;
  /** The window: occurrences overlapping [from, to) are returned. */
  from: Date;
  to: Date;
  /** How long each occurrence lasts, for the overlap test. */
  durationMs?: number;
}

/** The starts of the occurrences that overlap the window, in order. */
export function expandOccurrences(opts: ExpandOptions): Date[] {
  const { rule, timeZone } = opts;
  const p = wallParts(opts.start, timeZone);
  const minuteOfDay = p.hour * 60 + p.minute;
  const excluded = new Set((opts.exceptions ?? []).map((e) => new Date(e).getTime()));
  const duration = Math.max(opts.durationMs ?? 0, 1);
  const out: Date[] = [];

  let generated = 0;
  let steps = 0;
  for (const date of candidateDates({ y: p.year, m: p.month, d: p.day }, rule)) {
    if (++steps > MAX_STEPS) break;
    const at = instantFromZoned(timeZone, date.y, date.m, date.d, minuteOfDay);
    if (rule.until && at > rule.until) break;
    generated++;
    if (rule.count && generated > rule.count) break;
    if (at >= opts.to) break;
    if (excluded.has(at.getTime())) continue;
    if (at.getTime() + duration > opts.from.getTime()) out.push(at);
  }
  return out;
}

/** The first occurrence starting at or after `after`, or null when the series has ended. */
export function nextOccurrence(opts: Omit<ExpandOptions, "from" | "to"> & { after: Date }): Date | null {
  const horizon = new Date(opts.after.getTime() + 5 * 366 * 86_400_000);
  const [first] = expandOccurrences({ ...opts, from: opts.after, to: horizon, durationMs: 1 });
  return first ?? null;
}

/**
 * How many occurrences start before `before`, exceptions included — what a
 * series cut short there keeps as its COUNT.
 */
export function countBefore(opts: Omit<ExpandOptions, "from" | "to" | "exceptions"> & { before: Date }): number {
  return expandOccurrences({ ...opts, from: new Date(0), to: opts.before, exceptions: [], durationMs: 1 }).length;
}

/**
 * A rule following its series to another day. Moving a weekly Tuesday meeting to
 * Wednesday has to move `BYDAY` with it: left alone, the first occurrence is on
 * the Wednesday and every later one back on Tuesday, because the start is always
 * an occurrence and the rule still says Tuesday.
 */
export function rebaseRule(rule: Recurrence, dayShift: number, newStart: Date, timeZone: string): Recurrence {
  if (!dayShift) return rule;
  if (rule.freq === "WEEKLY" && rule.byDay?.length) {
    const shift = ((dayShift % 7) + 7) % 7;
    const days = new Set(rule.byDay.map((d) => WEEKDAYS[(WEEKDAYS.indexOf(d) + shift) % 7]));
    return { ...rule, byDay: WEEKDAYS.filter((d) => days.has(d)) };
  }
  if (rule.freq === "MONTHLY" && rule.nthWeekday) {
    return { ...rule, nthWeekday: { n: nthOfMonth(newStart, timeZone), day: weekdayIn(newStart, timeZone) } };
  }
  return rule;
}

/** The weekday of a date in a zone, as a rule names it. */
export function weekdayIn(instant: Date, timeZone: string): Weekday {
  return WEEKDAYS[wallParts(instant, timeZone).weekday];
}

/**
 * Which "nth weekday of the month" a date is: 1-4, or -1 for a fifth one, which
 * only some months have and so can only mean "the last".
 */
export function nthOfMonth(instant: Date, timeZone: string): 1 | 2 | 3 | 4 | -1 {
  const n = Math.ceil(wallParts(instant, timeZone).day / 7);
  return n > 4 ? -1 : (n as 1 | 2 | 3 | 4);
}
