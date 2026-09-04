import { asc } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";

import { businessCalendar, businessHolidays } from "@/db/schema";
import { type BusinessCalendar, DEFAULT_WEEK, type WeekSchedule } from "@/lib/business-hours";

/**
 * Reads a workspace's opening hours out of the database.
 *
 * Separate from the arithmetic so that module stays pure and testable, and
 * separate from the actions so the ticket code and the SLA job cannot end up
 * with two different ideas of when the office is open.
 */

// biome-ignore lint/suspicious/noExplicitAny: the schema generic is irrelevant to two selects
type AnyDb = NeonHttpDatabase<any>;

/**
 * A week that came out of a JSON column, checked before it is trusted.
 *
 * The column is `jsonb`, so anything could be in it: an older shape, a hand
 * edit, a failed write. A malformed week silently becomes "closed every day",
 * which would make every deadline absurd — so it falls back to the default
 * instead, and the caller gets working hours rather than none.
 */
export function parseWeek(value: unknown): WeekSchedule {
  if (!Array.isArray(value) || value.length !== 7) return DEFAULT_WEEK;

  const week = value.map((day) => {
    if (day === null || day === undefined) return null;
    const open = Number((day as { openMinute?: unknown }).openMinute);
    const close = Number((day as { closeMinute?: unknown }).closeMinute);
    if (!Number.isFinite(open) || !Number.isFinite(close)) return null;
    if (open < 0 || close > 24 * 60 || close <= open) return null;
    return { openMinute: open, closeMinute: close };
  });

  // Every day closed is indistinguishable from a broken column, and the harm of
  // guessing wrong runs one way: a workspace that really is never open has no
  // SLA to miss.
  return week.some((d) => d !== null) ? week : DEFAULT_WEEK;
}

/** The calendar for this workspace, with the defaults when none has been set. */
export async function loadBusinessCalendar(db: AnyDb): Promise<BusinessCalendar> {
  const [row] = await db.select().from(businessCalendar).limit(1);
  const holidayRows = await db
    .select({ day: businessHolidays.day })
    .from(businessHolidays)
    .orderBy(asc(businessHolidays.day));

  return {
    timeZone: row?.timeZone ?? "Europe/Rome",
    week: parseWeek(row?.week),
    holidays: holidayRows.map((h) => h.day),
  };
}
