import "server-only";

import { and, eq, gt, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";

import { appointmentAttendees, appointments } from "@/db/schema";
import { type NotificationInput, notifyMany } from "@/lib/notify";
import { nextOccurrence, parseRRule } from "@/lib/recurrence";
import { safeTimeZone } from "@/lib/wall-clock";

// biome-ignore lint/suspicious/noExplicitAny: the schema generic is irrelevant to these statements
type AnyDb = NeonHttpDatabase<any>;

type Claimed = { id: string; title: string; occurrence: Date; organizerId: string | null };

/**
 * The reminder somebody set on an appointment, delivered to the people inside
 * the workspace who are going.
 *
 * `reminder_minutes` used to reach only the VALARM in the emailed .ics, so it
 * worked for a guest whose calendar imported the invitation and for nobody who
 * booked the meeting in here.
 *
 * ⚠️ **The claim is the update.** `reminder_sent_for` records which occurrence
 * the reminder rang for, and the update that sets it carries the condition that
 * it does not already say so. Two runs overlapping — or two isolates — cannot
 * both win it: only the statement that changed the row gets it back. Reading
 * first and marking after would ring twice.
 *
 * Storing the occurrence rather than a flag is what makes the rest free: an
 * appointment moved to another time, and the next meeting of a series, no longer
 * match what is stored and so ring again, with nothing to reset.
 *
 * Only occurrences that have not started: a job that was down for an hour does
 * not wake anybody afterwards about a meeting already under way.
 */
export async function sendDueAppointmentReminders(
  db: AnyDb,
  now: Date = new Date(),
  fallbackZone = "Europe/Rome",
): Promise<number> {
  const claimed: Claimed[] = [];

  // ── Single appointments: one statement ─────────────────────────────────────
  const single = await db
    .update(appointments)
    .set({ reminderSentFor: sql`${appointments.startAt}` })
    .where(
      and(
        eq(appointments.status, "scheduled"),
        isNull(appointments.recurrenceRule),
        isNotNull(appointments.reminderMinutes),
        or(isNull(appointments.reminderSentFor), ne(appointments.reminderSentFor, appointments.startAt)),
        gt(appointments.startAt, now),
        lte(sql`${appointments.startAt} - (${appointments.reminderMinutes} * interval '1 minute')`, now),
      ),
    )
    .returning({
      id: appointments.id,
      title: appointments.title,
      startAt: appointments.startAt,
      organizerId: appointments.organizerId,
    });
  for (const s of single) claimed.push({ id: s.id, title: s.title, occurrence: s.startAt, organizerId: s.organizerId });

  // ── Series: the next occurrence is worked out here, then claimed the same way ──
  const series = await db
    .select({
      id: appointments.id,
      title: appointments.title,
      startAt: appointments.startAt,
      timezone: appointments.timezone,
      recurrenceRule: appointments.recurrenceRule,
      recurrenceExceptions: appointments.recurrenceExceptions,
      reminderMinutes: appointments.reminderMinutes,
      reminderSentFor: appointments.reminderSentFor,
      organizerId: appointments.organizerId,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.status, "scheduled"),
        isNotNull(appointments.recurrenceRule),
        isNotNull(appointments.reminderMinutes),
        lte(appointments.startAt, new Date(now.getTime() + 8 * 86_400_000)),
      ),
    );

  for (const row of series) {
    const rule = parseRRule(row.recurrenceRule);
    if (!rule || row.reminderMinutes === null) continue;
    const next = nextOccurrence({
      start: row.startAt,
      rule,
      timeZone: safeTimeZone(row.timezone, fallbackZone),
      exceptions: row.recurrenceExceptions,
      after: now,
    });
    if (!next || next.getTime() - row.reminderMinutes * 60_000 > now.getTime()) continue;
    if (row.reminderSentFor?.getTime() === next.getTime()) continue;

    const [won] = await db
      .update(appointments)
      .set({ reminderSentFor: next })
      .where(
        and(
          eq(appointments.id, row.id),
          or(isNull(appointments.reminderSentFor), ne(appointments.reminderSentFor, next)),
        ),
      )
      .returning({ id: appointments.id });
    if (won) claimed.push({ id: row.id, title: row.title, occurrence: next, organizerId: row.organizerId });
  }

  if (claimed.length === 0) return 0;

  // Colleagues invited to it, except whoever already said they are not coming.
  const invited = await db
    .select({ appointmentId: appointmentAttendees.appointmentId, userId: appointmentAttendees.userId })
    .from(appointmentAttendees)
    .where(
      and(
        inArray(
          appointmentAttendees.appointmentId,
          claimed.map((c) => c.id),
        ),
        isNotNull(appointmentAttendees.userId),
        ne(appointmentAttendees.status, "declined"),
      ),
    );

  const rows: NotificationInput[] = [];
  for (const appt of claimed) {
    const people = new Set<string>();
    if (appt.organizerId) people.add(appt.organizerId);
    for (const a of invited) if (a.appointmentId === appt.id && a.userId) people.add(a.userId);

    const minutes = Math.max(1, Math.round((appt.occurrence.getTime() - now.getTime()) / 60_000));
    // Relative, because the job knows no reader's time zone; the unit and count travel as
    // values, so the bell says it in the reader's language.
    const when =
      minutes < 60
        ? { unit: "minute", count: minutes }
        : minutes < 1440
          ? { unit: "hour", count: Math.round(minutes / 60) }
          : { unit: "day", count: Math.round(minutes / 1440) };

    for (const userId of people) {
      rows.push({
        userId,
        type: "appointment_reminder",
        key: "appointmentReminder" as const,
        params: { title: appt.title, ...when },
        link: `/dashboard/calendar?appointment=${appt.id}&occurrence=${encodeURIComponent(appt.occurrence.toISOString())}`,
      });
    }
  }

  await notifyMany(rows);
  return rows.length;
}
