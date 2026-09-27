import { and, eq, sql } from "drizzle-orm";

import { appointmentAttendees, appointments, bookingLinks, contacts, leads, users } from "@/db/schema";
import { mirrorAppointments } from "@/lib/appointment-mirror";
import { bookableSlots, busyByUser } from "@/lib/availability";
import { newArchiveToken } from "@/lib/mail-archive";
import { addDaysToDate, fromWallValue, toWallDate } from "@/lib/wall-clock";

/**
 * A person's public booking page (§ V3.5): a visitor picks a free slot, leaves their name
 * and address, and the appointment is in the person's calendar — with the visitor filed as
 * the contact or lead they are, or a new lead when they are neither.
 *
 * ⚠️⚠️ The slot offered and the slot taken are the same computation: `bookableSlots` over
 * the same busy time the colleague picker reads (src/lib/availability.ts). A booking for a
 * start that is not in the list — a stale page, a forged request, a meeting added since —
 * is refused rather than written on top of something.
 *
 * ⚠️⚠️ Two visitors on the same slot: the second is refused by the unique index on
 * (organiser, start) for booked appointments, taken by the insert itself. There is no
 * transaction on the HTTP driver to check first and write after.
 *
 * The token is the only thing in the address besides the workspace, and is not a
 * credential for anything but booking: disabling the link closes the page at once.
 */

// biome-ignore lint/suspicious/noExplicitAny: Drizzle's database types differ per driver
type AnyDb = any;

export type BookingLink = typeof bookingLinks.$inferSelect;

export const BOOKING_DURATIONS = [15, 30, 45, 60] as const;
export const MAX_DAYS_AHEAD = 60;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface BookingSettings {
  enabled: boolean;
  title: string;
  durationMinutes: number;
  daysAhead: number;
  dayStart: string;
  dayEnd: string;
  weekdays: string;
  bufferMinutes: number;
}

/** Whatever the form sent, as settings the page can run on; null when the hours make no day. */
export function cleanBookingSettings(input: Partial<Record<keyof BookingSettings, unknown>>): BookingSettings | null {
  const duration = Number(input.durationMinutes);
  const days = Math.round(Number(input.daysAhead));
  const buffer = Math.round(Number(input.bufferMinutes ?? 0));
  const dayStart = String(input.dayStart ?? "");
  const dayEnd = String(input.dayEnd ?? "");
  const weekdays = [...new Set(String(input.weekdays ?? "").replace(/[^1-7]/g, ""))].sort().join("");
  if (!(BOOKING_DURATIONS as readonly number[]).includes(duration)) return null;
  if (!Number.isFinite(days) || days < 1 || days > MAX_DAYS_AHEAD) return null;
  if (!Number.isFinite(buffer) || buffer < 0 || buffer > 60) return null;
  if (!TIME.test(dayStart) || !TIME.test(dayEnd) || dayStart >= dayEnd) return null;
  if (!weekdays) return null;
  return {
    enabled: Boolean(input.enabled),
    title: String(input.title ?? "")
      .trim()
      .slice(0, 120),
    durationMinutes: duration,
    daysAhead: days,
    dayStart,
    dayEnd,
    weekdays,
    bufferMinutes: buffer,
  };
}

/** This person's link, created — closed — the first time it is asked for. */
export async function ensureBookingLink(db: AnyDb, userId: string): Promise<BookingLink> {
  await db.insert(bookingLinks).values({ userId, token: newArchiveToken() }).onConflictDoNothing();
  const [row] = await db.select().from(bookingLinks).where(eq(bookingLinks.userId, userId));
  return row;
}

export async function saveBookingSettings(db: AnyDb, userId: string, settings: BookingSettings): Promise<BookingLink> {
  await ensureBookingLink(db, userId);
  const [row] = await db
    .update(bookingLinks)
    .set({ ...settings, title: settings.title || null, updatedAt: new Date() })
    .where(eq(bookingLinks.userId, userId))
    .returning();
  return row;
}

export async function bookingLinkByToken(db: AnyDb, token: string): Promise<BookingLink | null> {
  if (!/^[a-z2-7]{20}$/.test(token)) return null;
  const [row] = await db.select().from(bookingLinks).where(eq(bookingLinks.token, token));
  return row ?? null;
}

/** The starts a visitor can choose now. */
export async function openSlots(db: AnyDb, link: BookingLink, zone: string, now: Date = new Date()): Promise<Date[]> {
  if (!link.enabled) return [];
  const today = toWallDate(now, zone);
  const start = fromWallValue(today, zone);
  const end = fromWallValue(addDaysToDate(today, link.daysAhead + 1), zone);
  if (!start || !end) return [];
  const busy = await busyByUser(db, [link.userId], { start, end }, zone);
  return bookableSlots(link, busy[link.userId] ?? [], now, zone);
}

export interface Visitor {
  name: string;
  email: string;
  phone?: string | null;
  note?: string | null;
}

export type BookingResult =
  | { ok: true; appointmentId: string; startAt: Date; endAt: Date; contactId: string | null; leadId: string | null }
  | { ok: false; reason: "closed" | "taken" };

/**
 * Books `start` for the visitor. Who they are is decided the way everything else here
 * decides it: a contact with that address, else an open lead, else a new lead the link's
 * owner owns — never a duplicate of somebody already known.
 */
export async function bookSlot(
  db: AnyDb,
  link: BookingLink,
  input: { start: Date; visitor: Visitor; zone: string; defaultTitle: string },
  now: Date = new Date(),
): Promise<BookingResult> {
  if (!link.enabled) return { ok: false, reason: "closed" };
  const offered = await openSlots(db, link, input.zone, now);
  if (!offered.some((s) => s.getTime() === input.start.getTime())) return { ok: false, reason: "taken" };

  const email = input.visitor.email.trim().toLowerCase();
  const name = input.visitor.name.trim().slice(0, 120);
  const [contact] = await db
    .select({ id: contacts.id, companyId: contacts.companyId })
    .from(contacts)
    .where(sql`lower(${contacts.email}) = ${email}`)
    .limit(1);
  let leadId: string | null = null;
  if (!contact) {
    const [lead] = await db
      .select({ id: leads.id })
      .from(leads)
      .where(and(sql`lower(${leads.email}) = ${email}`, eq(leads.isConverted, false)))
      .limit(1);
    leadId = lead?.id ?? null;
    if (!leadId) {
      const [first, ...rest] = name.split(/\s+/);
      leadId = crypto.randomUUID();
      await db.insert(leads).values({
        id: leadId,
        firstName: first || email,
        lastName: rest.join(" "),
        email,
        phone: input.visitor.phone?.trim() || null,
        source: "booking",
        status: "new",
        ownerId: link.userId,
        marketingConsent: false,
      });
    }
  }

  const appointmentId = crypto.randomUUID();
  const endAt = new Date(input.start.getTime() + link.durationMinutes * 60_000);
  const created: { id: string }[] = await db
    .insert(appointments)
    .values({
      id: appointmentId,
      title: `${link.title || input.defaultTitle}: ${name}`.slice(0, 200),
      description: input.visitor.note?.trim().slice(0, 2000) || null,
      startAt: input.start,
      endAt,
      timezone: input.zone,
      status: "scheduled",
      organizerId: link.userId,
      contactId: contact?.id ?? null,
      companyId: contact?.companyId ?? null,
      leadId,
      bookedVia: "link",
      icalUid: `${crypto.randomUUID()}@fluxcrm.app`,
    })
    .onConflictDoNothing()
    .returning({ id: appointments.id });
  if (created.length === 0) return { ok: false, reason: "taken" };

  const [organizer] = await db
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, link.userId));
  await db.insert(appointmentAttendees).values([
    ...(organizer?.email
      ? [
          {
            appointmentId,
            userId: link.userId,
            email: organizer.email,
            name: organizer.name ?? "Organizer",
            role: "organizer",
            status: "accepted",
          },
        ]
      : []),
    {
      appointmentId,
      contactId: contact?.id ?? null,
      email,
      name: name || email,
      role: "required",
      // They chose the time: there is nothing left for them to accept.
      status: "accepted",
    },
  ]);
  // Into the person's own calendar too, when they connected one (src/lib/appointment-mirror.ts):
  // a booking is the appointment they most need to see there. Never at the visitor's expense.
  await mirrorAppointments(db, [appointmentId], { zone: input.zone }).catch((err) =>
    console.error("[booking] calendar mirror failed:", err instanceof Error ? err.message : err),
  );
  return { ok: true, appointmentId, startAt: input.start, endAt, contactId: contact?.id ?? null, leadId };
}
