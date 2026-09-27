import "server-only";

import { cache } from "react";

import { businessCalendar } from "@/db/schema";
import { FALLBACK_CALENDAR } from "@/lib/business-calendar";
import { getCurrentTenantId, getDb } from "@/lib/tenant-context";

/**
 * Once per request and workspace: the home page asked three times — the page, its agenda
 * and its figures. The workspace is the key, not decoration: `getDb()` answers for it.
 */
const readTimeZoneFor = cache(async (_workspaceId: string | null): Promise<string> => {
  try {
    const db = await getDb();
    const [row] = await db.select({ timeZone: businessCalendar.timeZone }).from(businessCalendar).limit(1);
    return row?.timeZone ?? FALLBACK_CALENDAR.timeZone;
  } catch {
    return FALLBACK_CALENDAR.timeZone;
  }
});

/**
 * The time zone the workspace keeps its hours in: the one set on its business
 * calendar, or the default before anybody has set one.
 *
 * ⚠️ The server's own zone is not an answer. On Workers it is UTC, so a page that
 * lays out a day with `getHours()` draws a ten o'clock meeting in Rome at eight.
 *
 * ⚠️ Remembered per workspace, never per request alone: inside `runWithTenant` a job moves
 * from one workspace to the next within one request, and a zone remembered without its
 * workspace would be the first one's for all of them. `getCurrentTenantId()` answers with
 * the job's workspace there.
 */
export async function getWorkspaceTimeZone(): Promise<string> {
  return readTimeZoneFor(await getCurrentTenantId());
}

/**
 * The wall-clock time of `instant` in `timeZone`, as a Date whose *local* fields
 * (getHours, getDate, date-fns' format) read that wall clock on this server.
 *
 * For laying out and labelling on the server only. The result is not the same
 * instant, so it must never be handed to the browser or written anywhere.
 */
export function wallClock(instant: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return new Date(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
}
