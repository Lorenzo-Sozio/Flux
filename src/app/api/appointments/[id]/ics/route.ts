/**
 * One appointment as an .ics file, for "add to my calendar".
 *
 * A dashboard request: the session and the workspace header are there, so
 * `getDb()` is the right way in. Published rather than requested, so the
 * calendar that opens it files it instead of asking its owner to RSVP to a
 * meeting they organised.
 */
import { type NextRequest, NextResponse } from "next/server";

import { and, eq } from "drizzle-orm";

import { appointments, users } from "@/db/schema";
import { getActor } from "@/lib/auth-guard";
import { generateFeedICS } from "@/lib/ical";
import { can } from "@/lib/permissions";
import { recordScope, visibleWhere } from "@/lib/record-visibility";
import { getDb } from "@/lib/tenant-context";
import { safeTimeZone } from "@/lib/wall-clock";
import { getWorkspaceTimeZone } from "@/lib/workspace-time-zone";

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor || !can(actor, "record:read")) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await context.params;
  const db = await getDb();
  const [row] = await db
    .select({ appt: appointments, organizerName: users.name, organizerEmail: users.email })
    .from(appointments)
    .leftJoin(users, eq(appointments.organizerId, users.id))
    // A meeting the person cannot see is one that does not exist, for them.
    .where(and(eq(appointments.id, id), visibleWhere("appointment", await recordScope())));
  if (!row) return new NextResponse("Not found", { status: 404 });

  const a = row.appt;
  const body = generateFeedICS(
    [
      {
        uid: a.icalUid,
        title: a.title,
        description: a.description,
        location: a.location,
        locationUrl: a.locationUrl ?? a.conferenceLink,
        startAt: a.startAt,
        endAt: a.endAt,
        timeZone: safeTimeZone(a.timezone, await getWorkspaceTimeZone()),
        allDay: a.allDay,
        recurrenceRule: a.recurrenceRule,
        recurrenceExceptions: a.recurrenceExceptions,
        status: a.status,
        sequence: a.sequence,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
        organizer: row.organizerEmail ? { email: row.organizerEmail, name: row.organizerName ?? "" } : null,
      },
    ],
    { name: a.title },
  );

  // Only letters and digits reach the header: the title is typed by a person.
  const filename = `${
    a.title
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "appointment"
  }.ics`;
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
