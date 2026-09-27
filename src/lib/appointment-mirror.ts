/**
 * Appointments written into the organiser's own calendar at Google or Microsoft (V3.2): the
 * other direction of "calendar both ways" — the first is busy time, read in
 * src/lib/mail-sync.ts.
 *
 * - A new appointment becomes an event, a changed one updates it, a cancelled or deleted one
 *   removes it; a mirror row remembers which event is which.
 * - ⚠️ **No attendees are written to the event.** Flux already sends its own invitation; an
 *   event with guests would have Google or Microsoft send a second one.
 * - ⚠️ **A repeating series is not mirrored yet.** Its exceptions and "this and following"
 *   edits would each need translating into the provider's model, and a half-translated series
 *   is a calendar that disagrees with the CRM. A detached occurrence is an ordinary
 *   appointment and is mirrored.
 * - ⚠️ **Never on the save path.** It runs after the response; a provider that fails costs
 *   the person nothing but a line on their connection saying so.
 */
import { eq, inArray, isNull, or } from "drizzle-orm";

import { appointmentMirrors, appointments, mailConnections } from "@/db/schema";
import { accessTokenFor, loadConnection, recordConnectionError } from "@/lib/mail-connection";
import { providerFor } from "@/lib/mail-providers/registry";
import type { CalendarEvent, FetchLike, MailProviderId } from "@/lib/mail-providers/types";
import { ProviderError } from "@/lib/mail-providers/types";
import { safeTimeZone } from "@/lib/wall-clock";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle's database types differ per driver
type AnyDb = any;

type Outcome = "created" | "updated" | "deleted" | "skipped";

interface Options {
  zone: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: FetchLike;
  now?: Date;
}

async function withToken(db: AnyDb, connectionId: string, options: Options) {
  const [conn] = await db.select().from(mailConnections).where(eq(mailConnections.id, connectionId));
  if (!conn) return null;
  const provider = providerFor(conn.provider as MailProviderId, options.env, options.fetchImpl);
  if (!provider) return null;
  const token = await accessTokenFor(db, conn, provider, options.now);
  return token ? { conn, provider, token } : null;
}

/** Removes the event a mirror row stands for, and the row once the event is gone. */
async function unmirror(db: AnyDb, mirror: typeof appointmentMirrors.$inferSelect, options: Options) {
  const live = await withToken(db, mirror.connectionId, options);
  if (!live) {
    // ⚠️ A connection still active but not answering now (a token blip) keeps its row: forgotten
    // here, the event would stay in the calendar for good and come back as busy time. Only a
    // connection that is gone or revoked lets the row go — there is nobody left to ask.
    const [conn] = await db
      .select({ status: mailConnections.status })
      .from(mailConnections)
      .where(eq(mailConnections.id, mirror.connectionId));
    if (conn?.status === "active") return;
  }
  if (live) {
    try {
      await live.provider.deleteEvent(live.token, mirror.externalId);
    } catch (err) {
      // Left in place, the row is tried again at the next change; the connection says why.
      await recordConnectionError(db, live.conn.id, err, options.now);
      return;
    }
  }
  await db.delete(appointmentMirrors).where(eq(appointmentMirrors.id, mirror.id));
}

export async function mirrorAppointment(db: AnyDb, appointmentId: string, options: Options): Promise<Outcome> {
  const [appt] = await db.select().from(appointments).where(eq(appointments.id, appointmentId));
  const mirrors: (typeof appointmentMirrors.$inferSelect)[] = await db
    .select()
    .from(appointmentMirrors)
    .where(eq(appointmentMirrors.appointmentId, appointmentId));

  // Gone, cancelled or turned into a series: whatever was written for it goes.
  if (!appt || appt.status === "cancelled" || appt.recurrenceRule) {
    for (const m of mirrors) await unmirror(db, m, options);
    return mirrors.length > 0 ? "deleted" : "skipped";
  }

  const conn = appt.organizerId ? await loadConnection(db, appt.organizerId) : null;
  // A mirror in somebody else's calendar: the appointment changed hands.
  for (const m of mirrors.filter((x) => x.connectionId !== conn?.id)) await unmirror(db, m, options);
  if (!conn || conn.status !== "active") return "skipped";
  const live = await withToken(db, conn.id, options);
  if (!live) return "skipped";

  const link = appt.conferenceLink ?? appt.locationUrl;
  const event: CalendarEvent = {
    title: appt.title,
    description: [appt.description, link].filter(Boolean).join("\n\n") || null,
    location: appt.location,
    start: appt.startAt,
    end: appt.endAt,
    allDay: appt.allDay,
    timeZone: safeTimeZone(appt.timezone, options.zone),
  };
  const now = options.now ?? new Date();
  const mine = mirrors.find((x) => x.connectionId === conn.id);
  try {
    if (mine) {
      try {
        await live.provider.updateEvent(live.token, mine.externalId, event);
        await db.update(appointmentMirrors).set({ updatedAt: now }).where(eq(appointmentMirrors.id, mine.id));
        return "updated";
      } catch (err) {
        // Deleted at the provider by the person: written again, since the CRM still has it.
        if (!(err instanceof ProviderError && (err.status === 404 || err.status === 410))) throw err;
        const externalId = await live.provider.createEvent(live.token, event);
        await db
          .update(appointmentMirrors)
          .set({ externalId, updatedAt: now })
          .where(eq(appointmentMirrors.id, mine.id));
        return "created";
      }
    }
    const externalId = await live.provider.createEvent(live.token, event);
    const claimed = await db
      .insert(appointmentMirrors)
      .values({ appointmentId, connectionId: conn.id, externalId, createdAt: now, updatedAt: now })
      .onConflictDoNothing()
      .returning({ id: appointmentMirrors.id });
    // Two saves at once both created an event; the row decides which stays.
    if (claimed.length === 0) await live.provider.deleteEvent(live.token, externalId).catch(() => undefined);
    return "created";
  } catch (err) {
    await recordConnectionError(db, conn.id, err, now);
    return "skipped";
  }
}

/**
 * The appointments an action just touched, plus the detached occurrences of a series that
 * went with it. Nothing to do — the common case, nobody connected — costs one query.
 */
export async function mirrorAppointments(db: AnyDb, ids: readonly string[], options: Options): Promise<void> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const [anyConnection] = await db.select({ id: mailConnections.id }).from(mailConnections).limit(1);
  if (!anyConnection) return;
  // Detached copies go with their series — cancelled, or deleted outright, in which case only
  // the mirror row is left to say an event exists.
  const related: { appointmentId: string }[] = await db
    .select({ appointmentId: appointmentMirrors.appointmentId })
    .from(appointmentMirrors)
    .leftJoin(appointments, eq(appointments.id, appointmentMirrors.appointmentId))
    .where(or(isNull(appointments.id), inArray(appointments.recurrenceParentId, unique)));
  for (const id of new Set([...unique, ...related.map((o) => o.appointmentId)])) {
    await mirrorAppointment(db, id, options).catch((err) =>
      console.error("[appointment-mirror]", id, err instanceof Error ? err.message : err),
    );
  }
}
