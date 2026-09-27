/**
 * wall-clock.ts — reading and writing times on a named zone's clock.
 *
 * A calendar is laid out, typed into and read back on one clock: the
 * workspace's. The browser's zone is somebody's laptop and the server's is UTC on
 * Workers, and each used to be a different answer to "what time is this
 * meeting" on a different screen of the same page.
 *
 * Pure and dependency-free, so the form, the grid and the server share it.
 */

import { instantFromZoned } from "@/lib/business-hours";

export interface WallParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  /** 0 = Monday … 6 = Sunday. */
  weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

const WEEKDAY_INDEX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/** A zone this runtime knows, or the fallback. An unknown zone makes Intl throw. */
export function safeTimeZone(timeZone: string | null | undefined, fallback = "Europe/Rome"): string {
  if (!timeZone) return fallback;
  try {
    formatterFor(timeZone);
    return timeZone;
  } catch {
    return fallback;
  }
}

export function wallParts(instant: Date, timeZone: string): WallParts {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "0";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    weekday: WEEKDAY_INDEX[get("weekday")] ?? 0,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "yyyy-MM-dd" on the zone's clock. */
export function toWallDate(instant: Date, timeZone: string): string {
  const p = wallParts(instant, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** "yyyy-MM-ddTHH:mm" on the zone's clock: what a `datetime-local` input holds. */
export function toWallValue(instant: Date, timeZone: string): string {
  const p = wallParts(instant, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Minutes since midnight on the zone's clock. */
export function wallMinutes(instant: Date, timeZone: string): number {
  const p = wallParts(instant, timeZone);
  return p.hour * 60 + p.minute;
}

/**
 * The instant a wall-clock value names in the zone: "yyyy-MM-ddTHH:mm", or
 * "yyyy-MM-dd" for midnight. Null for anything else.
 */
export function fromWallValue(value: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h = "0", mi = "0"] = m;
  const minutes = Number(h) * 60 + Number(mi);
  const result = instantFromZoned(timeZone, Number(y), Number(mo), Number(d), minutes);
  return Number.isNaN(result.getTime()) ? null : result;
}

/** A "yyyy-MM-dd" date moved by whole days, on the calendar rather than the clock. */
export function addDaysToDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** A wall-clock value moved by minutes, keeping to the wall clock across a DST change. */
export function addMinutesToWall(value: string, minutes: number): string {
  const [date, time = "00:00"] = value.split("T");
  const [h, mi] = time.split(":").map(Number);
  const total = h * 60 + mi + minutes;
  const dayShift = Math.floor(total / 1440);
  const rest = ((total % 1440) + 1440) % 1440;
  return `${addDaysToDate(date, dayShift)}T${pad(Math.floor(rest / 60))}:${pad(rest % 60)}`;
}

/** Minutes between two wall-clock values, as the clock on the wall counts them. */
export function wallDiffMinutes(from: string, to: string): number {
  const toMinutes = (v: string) => {
    const [date, time = "00:00"] = v.split("T");
    const [y, m, d] = date.split("-").map(Number);
    const [h, mi] = time.split(":").map(Number);
    return Date.UTC(y, m - 1, d) / 60_000 + h * 60 + mi;
  };
  return toMinutes(to) - toMinutes(from);
}
