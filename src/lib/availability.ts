import { and, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, ne, or } from "drizzle-orm";

import { appointmentAttendees, appointments, mailBusy } from "@/db/schema";
import { expandOccurrences, parseRRule } from "@/lib/recurrence";
import { tolerateUnmigrated } from "@/lib/schema-ready";
import { addDaysToDate, fromWallValue, safeTimeZone, toWallDate } from "@/lib/wall-clock";

/**
 * When people are busy, and when they can be booked — read by the colleague picker in the
 * appointment form and by the public booking page (src/lib/booking.ts).
 *
 * ⚠️ One copy of "busy": a repeating appointment is expanded on its own wall clock, a
 * declined invitation frees the time, a cancelled appointment is not there. A booking page
 * that read busy time its own way would offer the slot a weekly meeting already holds.
 *
 * ⚠️ A connected calendar (V3.2, src/lib/mail-sync.ts) counts too: the intervals read from
 * Google or Microsoft, with no title — the page only needs to know the time is taken. An
 * appointment mirrored there comes back as a block starting when it does and is not
 * counted twice.
 */

// biome-ignore lint/suspicious/noExplicitAny: Drizzle's database types differ per driver
type AnyDb = any;

export type BusySlot = { startAt: Date; endAt: Date; title: string };

export /**
 * Rows that can have an occurrence in the window: a single appointment that
 * overlaps it, or a series that has started by its end (whether it is still
 * running is for the expansion to say).
 */
function inWindow(range: { start: Date; end: Date }) {
  return or(
    and(
      isNull(appointments.recurrenceRule),
      lte(appointments.startAt, range.end),
      gte(appointments.endAt, range.start),
    ),
    and(isNotNull(appointments.recurrenceRule), lte(appointments.startAt, range.end)),
  );
}

/** Each occurrence of a row inside the window: the row itself when it does not repeat. */
export function occurrencesOf(
  row: {
    startAt: Date;
    endAt: Date;
    timezone: string | null;
    recurrenceRule: string | null;
    recurrenceExceptions: string[] | null;
  },
  range: { start: Date; end: Date },
  fallbackZone: string,
): { startAt: Date; endAt: Date; occurrence: string | null }[] {
  const rule = parseRRule(row.recurrenceRule);
  if (!rule) return [{ startAt: row.startAt, endAt: row.endAt, occurrence: null }];
  const duration = row.endAt.getTime() - row.startAt.getTime();
  return expandOccurrences({
    start: row.startAt,
    rule,
    timeZone: safeTimeZone(row.timezone, fallbackZone),
    exceptions: row.recurrenceExceptions,
    from: range.start,
    to: range.end,
    durationMs: duration,
  }).map((startAt) => ({
    startAt,
    endAt: new Date(startAt.getTime() + duration),
    occurrence: startAt.toISOString(),
  }));
}

/** Busy time per person in the window: what they organise, and what they have not declined. */
export async function busyByUser(
  db: AnyDb,
  userIds: readonly string[],
  range: { start: Date; end: Date },
  zone: string,
): Promise<Record<string, BusySlot[]>> {
  if (userIds.length === 0) return {};
  const seriesColumns = {
    title: appointments.title,
    startAt: appointments.startAt,
    endAt: appointments.endAt,
    timezone: appointments.timezone,
    recurrenceRule: appointments.recurrenceRule,
    recurrenceExceptions: appointments.recurrenceExceptions,
  };
  const live = and(ne(appointments.status, "cancelled"), eq(appointments.allDay, false), inWindow(range));

  const [organizerRows, attendeeRows, externalRows] = await Promise.all([
    db
      .select({ ...seriesColumns, userId: appointments.organizerId })
      .from(appointments)
      .where(and(live, isNotNull(appointments.organizerId), inArray(appointments.organizerId, [...userIds]))),
    db
      .select({ ...seriesColumns, userId: appointmentAttendees.userId })
      .from(appointmentAttendees)
      .innerJoin(appointments, eq(appointmentAttendees.appointmentId, appointments.id))
      .where(
        and(
          live,
          isNotNull(appointmentAttendees.userId),
          inArray(appointmentAttendees.userId, [...userIds]),
          ne(appointmentAttendees.status, "declined"),
        ),
      ),
    tolerateUnmigrated(
      "connected calendars",
      () =>
        db
          .select({ userId: mailBusy.userId, startAt: mailBusy.startAt, endAt: mailBusy.endAt })
          .from(mailBusy)
          .where(
            and(
              inArray(mailBusy.userId, [...userIds]),
              lt(mailBusy.startAt, range.end),
              gt(mailBusy.endAt, range.start),
            ),
          ) as Promise<{ userId: string; startAt: Date; endAt: Date }[]>,
      [],
    ),
  ]);

  const result: Record<string, BusySlot[]> = {};
  for (const uid of userIds) result[uid] = [];
  for (const row of [...organizerRows, ...attendeeRows] as (Parameters<typeof occurrencesOf>[0] & {
    userId: string | null;
    title: string;
  })[]) {
    if (!row.userId || !result[row.userId]) continue;
    for (const o of occurrencesOf(row, range, zone)) {
      if (!(o.startAt < range.end && o.endAt > range.start)) continue;
      const exists = result[row.userId].some((b) => b.startAt.getTime() === o.startAt.getTime());
      if (!exists) result[row.userId].push({ startAt: o.startAt, endAt: o.endAt, title: row.title });
    }
  }
  for (const b of externalRows) {
    const mine = result[b.userId];
    if (!mine || mine.some((x) => x.startAt.getTime() === b.startAt.getTime())) continue;
    mine.push({ startAt: b.startAt, endAt: b.endAt, title: "" });
  }
  return result;
}

// ─── Bookable slots ───────────────────────────────────────────────────────────

export interface BookingWindow {
  durationMinutes: number;
  daysAhead: number;
  /** "09:00" and "18:00": the first start and the latest end, on the workspace's clock. */
  dayStart: string;
  dayEnd: string;
  /** ISO weekdays that can be booked, "12345" for Monday to Friday. */
  weekdays: string;
  bufferMinutes: number;
}

/** How soon a slot may start: nobody should find a meeting booked for ten minutes from now. */
export const MIN_NOTICE_MINUTES = 120;

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/**
 * The starts that can be booked, from today to `daysAhead` days on, on the workspace's
 * clock: on an allowed weekday, inside the day's hours, not before `MIN_NOTICE_MINUTES`
 * from now, and clear of every busy slot by `bufferMinutes` on either side.
 *
 * Pure — the page lists them, and the booking checks the one chosen against the same list.
 */
export function bookableSlots(window: BookingWindow, busy: readonly BusySlot[], now: Date, zone: string): Date[] {
  const out: Date[] = [];
  const step = window.durationMinutes;
  const first = minutesOf(window.dayStart);
  const last = minutesOf(window.dayEnd) - step;
  const earliest = now.getTime() + MIN_NOTICE_MINUTES * 60_000;
  const buffer = window.bufferMinutes * 60_000;
  const today = toWallDate(now, zone);

  for (let d = 0; d <= window.daysAhead; d++) {
    const day = addDaysToDate(today, d);
    // ISO weekday of the calendar date itself: Monday 1, Sunday 7.
    const weekday = ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
    if (!window.weekdays.includes(String(weekday))) continue;
    for (let m = first; m <= last; m += step) {
      const start = fromWallValue(`${day}T${hhmm(m)}`, zone);
      if (!start || start.getTime() < earliest) continue;
      const end = start.getTime() + step * 60_000;
      const clash = busy.some(
        (b) => start.getTime() < b.endAt.getTime() + buffer && end > b.startAt.getTime() - buffer,
      );
      if (!clash) out.push(start);
    }
  }
  return out;
}
