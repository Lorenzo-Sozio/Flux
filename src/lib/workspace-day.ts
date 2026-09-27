import { addDaysToDate, fromWallValue, toWallDate } from "@/lib/wall-clock";

/**
 * "Today" and "this month" on the workspace's clock, as instants.
 *
 * ⚠️⚠️ They were computed with `new Date(y, m, d)` on the server's own clock, which on
 * Workers is UTC. Between midnight and two in the morning in Rome the home page's agenda
 * showed yesterday, the reminder jobs sent yesterday's reminders, and a deal won at 00:30
 * on the first of the month was counted in the month before — while the calendar, which
 * already used the workspace's zone, said otherwise. Everything that asks "is it today?"
 * asks here.
 */

/** The start of the workspace's day containing `now`, and the start of the next one. */
export function dayBounds(now: Date, timeZone: string): { start: Date; end: Date } {
  const day = toWallDate(now, timeZone);
  return {
    start: fromWallValue(day, timeZone) ?? now,
    end: fromWallValue(addDaysToDate(day, 1), timeZone) ?? now,
  };
}

/** The start of the workspace's day `days` away from the one containing `now`. */
export function dayStart(now: Date, timeZone: string, days = 0): Date {
  return fromWallValue(addDaysToDate(toWallDate(now, timeZone), days), timeZone) ?? now;
}

/** The start of the workspace's month containing `now`, `months` away. */
export function monthStart(now: Date, timeZone: string, months = 0): Date {
  const [y, m] = toWallDate(now, timeZone).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const first = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-01`;
  return fromWallValue(first, timeZone) ?? now;
}
