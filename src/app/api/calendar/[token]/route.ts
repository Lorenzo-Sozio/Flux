/**
 * The calendar subscription feed (audit rilievo S-10).
 *
 * Fetched by Google Calendar, Outlook and Apple Calendar on their own schedule.
 * There is no session here and there cannot be one: a calendar client has no
 * browser, no cookie jar and nobody to ask for a password.
 *
 * ⚠️ So `getDb()` must never be called from this file. It reads the
 * `x-tenant-id` header the proxy injects only for authenticated dashboard
 * requests, and throws when it is absent — the defect that made every public
 * entry point in this codebase fail silently (rilievo B-01). The workspace comes
 * from the signed token, which is what identifies the subscription in the first
 * place.
 */
import { type NextRequest, NextResponse } from "next/server";

import { and, eq, gte, inArray, lte, or } from "drizzle-orm";

import { appointmentAttendees, appointments, users } from "@/db/schema";
import { verifyCalendarFeedToken } from "@/lib/calendar-feed-token";
import { type FeedEvent, generateFeedICS } from "@/lib/ical";
import { checkRateLimit } from "@/lib/rate-limiter";
import { openTenantDb } from "@/lib/tenant-resolve";

/**
 * How much of the calendar travels.
 *
 * A feed is re-fetched in full every time, so an unbounded one grows until it is
 * slow for everybody and then times out — which a calendar client reports to
 * nobody. The past is included because a calendar people scroll back through
 * with holes in it is worse than one that starts somewhere.
 */
const DAYS_BACK = 90;
const DAYS_AHEAD = 365;
const DAY_MS = 86_400_000;

/** An appointment nobody can attend has nothing to say to a calendar. */
const VISIBLE_STATUSES = ["scheduled", "completed", "cancelled"];

export async function GET(_req: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;

  // The URL is a credential and it is guessed the way credentials are guessed.
  if (!(await checkRateLimit(`calendar-feed:${token.slice(0, 24)}`, 60, 60_000))) {
    return new NextResponse("Too many requests", { status: 429 });
  }

  const identity = verifyCalendarFeedToken(token);
  if (!identity) return new NextResponse("Not found", { status: 404 });

  const db = await openTenantDb(identity.tenantId);
  if (!db) return new NextResponse("Not found", { status: 404 });

  // ⚠️ A token names a person, and people leave. Without this the subscription a
  // departing employee set up on their phone keeps delivering the company's
  // calendar for as long as they keep the URL — and nothing here would ever say
  // so, because from the workspace's side the account is simply gone.
  const person = await db.query.users.findFirst({
    where: eq(users.id, identity.userId),
    columns: { id: true, name: true, email: true },
  });
  if (!person) return new NextResponse("Not found", { status: 404 });

  const now = Date.now();
  const from = new Date(now - DAYS_BACK * DAY_MS);
  const until = new Date(now + DAYS_AHEAD * DAY_MS);

  // Theirs to organise, or theirs to attend: both belong on their calendar.
  const invited = await db
    .select({ appointmentId: appointmentAttendees.appointmentId })
    .from(appointmentAttendees)
    .where(eq(appointmentAttendees.userId, identity.userId));

  const invitedIds = invited.map((row) => row.appointmentId);
  const mine = invitedIds.length
    ? or(eq(appointments.organizerId, identity.userId), inArray(appointments.id, invitedIds))
    : eq(appointments.organizerId, identity.userId);

  const rows = await db
    .select({
      id: appointments.id,
      icalUid: appointments.icalUid,
      title: appointments.title,
      description: appointments.description,
      location: appointments.location,
      locationUrl: appointments.locationUrl,
      startAt: appointments.startAt,
      endAt: appointments.endAt,
      status: appointments.status,
      sequence: appointments.sequence,
      createdAt: appointments.createdAt,
      updatedAt: appointments.updatedAt,
    })
    .from(appointments)
    .where(
      and(
        mine,
        gte(appointments.startAt, from),
        lte(appointments.startAt, until),
        inArray(appointments.status, VISIBLE_STATUSES),
      ),
    );

  const events: FeedEvent[] = rows.map((row) => ({
    uid: row.icalUid || `${row.id}@flux`,
    title: row.title,
    description: row.description,
    location: row.location,
    locationUrl: row.locationUrl,
    startAt: row.startAt,
    endAt: row.endAt,
    status: row.status,
    sequence: row.sequence,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));

  const body = generateFeedICS(events, { name: person.name ? `Flux — ${person.name}` : "Flux" });

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="flux.ics"',
      // A feed is a live view, and a cached copy is a calendar that stops
      // updating without telling anyone it has.
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
