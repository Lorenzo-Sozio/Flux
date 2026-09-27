import { and, eq, gte, isNotNull, lte, or } from "drizzle-orm";

import { activities } from "@/db/schema";
import type { getDb } from "@/lib/tenant-context";
import { dayBounds } from "@/lib/workspace-day";

/**
 * How far around "now" a run of the email worker looks for activity reminders.
 *
 * ⚠️⚠️ **Never narrower than the worker's schedule.** It looked two minutes ahead, which
 * was right while the worker ran every minute. Since the frequent jobs moved to one
 * ten-minute schedule (see CLAUDE.md — the database bill), a reminder falling between two
 * runs matched neither: about four in five were never sent, and nothing said so.
 * `repeating-jobs.test.ts` compares these with the schedule in custom-worker.ts.
 *
 * Ahead by the schedule, so every moment is covered by the run before it — a reminder may
 * arrive up to ten minutes early, never late. Behind by two, so a run that starts late
 * still covers the moments it should have. The overlap is harmless: the worker remembers
 * what it has already sent today.
 */
export const REMINDER_LOOKAHEAD_MINUTES = 10;
export const REMINDER_LOOKBACK_MINUTES = 2;

/**
 * Activities whose reminder falls due in the window around `now`.
 *
 * Not a server action: it used to live in a `"use server"` file, which made it an endpoint
 * any signed-in browser could call, unguarded, for the content of every reminded activity
 * in the workspace. Only the worker needs it.
 */
export async function activitiesDueForReminder(db: Awaited<ReturnType<typeof getDb>>, now = new Date()) {
  const from = new Date(now.getTime() - REMINDER_LOOKBACK_MINUTES * 60_000);
  const to = new Date(now.getTime() + REMINDER_LOOKAHEAD_MINUTES * 60_000);

  const rows = await db
    .select({
      id: activities.id,
      type: activities.type,
      content: activities.content,
      date: activities.date,
      reminderMinutes: activities.reminderMinutes,
      ownerId: activities.ownerId,
      contactId: activities.contactId,
      leadId: activities.leadId,
      companyId: activities.companyId,
    })
    .from(activities)
    // A reminder fires at or before its activity, so nothing that ended before the window
    // can still be due: that bound keeps a workspace's history out of every run.
    .where(and(isNotNull(activities.reminderMinutes), gte(activities.date, from)));

  return rows.filter((r) => {
    if (!r.date || r.reminderMinutes == null) return false;
    const fireAt = r.date.getTime() - r.reminderMinutes * 60_000;
    return fireAt >= from.getTime() && fireAt <= to.getTime();
  });
}

/**
 * Calls and meetings dated today, for the morning "you have a call today" reminder.
 *
 * Moved here with `activitiesDueForReminder`, for the same reason: in a `"use server"` file
 * it was an unguarded endpoint returning every call and meeting of the day.
 */
export async function activitiesDueToday(db: Awaited<ReturnType<typeof getDb>>, timeZone: string, now = new Date()) {
  // The workspace's day, not the server's UTC one.
  const { start, end: next } = dayBounds(now, timeZone);
  const end = new Date(next.getTime() - 1);

  return db
    .select({
      id: activities.id,
      type: activities.type,
      content: activities.content,
      date: activities.date,
      ownerId: activities.ownerId,
      contactId: activities.contactId,
      leadId: activities.leadId,
      companyId: activities.companyId,
    })
    .from(activities)
    .where(
      and(
        isNotNull(activities.date),
        gte(activities.date, start),
        lte(activities.date, end),
        or(eq(activities.type, "call"), eq(activities.type, "meeting")),
      ),
    );
}
