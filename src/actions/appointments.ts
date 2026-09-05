"use server";

import { revalidatePath } from "next/cache";

import { and, eq, gte, inArray, isNotNull, lte, ne, or } from "drizzle-orm";

import { auth } from "@/auth";
import { appointmentAttendees, appointments, companies, contacts, deals, leads, users } from "@/db/schema";
import { getAppUrl } from "@/lib/app-url";
import { requireCapability, requireWriteAccess } from "@/lib/auth-guard";
import { type AppointmentEmailData, sendAppointmentInviteEmail } from "@/lib/email";
import { getEmailConfig } from "@/lib/email-provider";
import { generateICS, type ICSAttendee } from "@/lib/ical";
import { getDb } from "@/lib/tenant-context";
import { resolveTenantByProbe } from "@/lib/tenant-resolve";

export type InviteResult = {
  sent: number;
  failed: number;
  noProvider: boolean;
};

// Resolved per call, not at import: `getAppUrl()` refuses to guess in production,
// and a module-scope call would make that refusal a build failure rather than a
// clear error on the request that was about to send a wrong link (rilievo B-04).
function appBase(): string {
  return getAppUrl();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateJitsiLink(): string {
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `https://meet.jit.si/flux-${id}`;
}

function generateResponseToken(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

async function dispatchInvites(appointmentId: string, method: "REQUEST" | "CANCEL"): Promise<InviteResult> {
  const db = await getDb();
  // Check email provider before doing any work
  const config = await getEmailConfig();
  const isConfigured =
    (config.provider === "resend" && !!config.resendApiKey) || (config.provider === "smtp" && !!config.smtpHost);

  if (!isConfigured) {
    console.warn("[EMAIL] No provider configured — invites not sent for appointment", appointmentId);
    return { sent: 0, failed: 0, noProvider: true };
  }

  const appt = await db
    .select({
      id: appointments.id,
      title: appointments.title,
      description: appointments.description,
      startAt: appointments.startAt,
      endAt: appointments.endAt,
      location: appointments.location,
      locationUrl: appointments.locationUrl,
      conferenceLink: appointments.conferenceLink,
      icalUid: appointments.icalUid,
      sequence: appointments.sequence,
      reminderMinutes: appointments.reminderMinutes,
      organizerName: users.name,
      organizerEmail: users.email,
    })
    .from(appointments)
    .leftJoin(users, eq(appointments.organizerId, users.id))
    .where(eq(appointments.id, appointmentId))
    .then((r) => r[0]);

  if (!appt) return { sent: 0, failed: 0, noProvider: false };

  const attendeeRows = await db
    .select()
    .from(appointmentAttendees)
    .where(eq(appointmentAttendees.appointmentId, appointmentId));

  const recipients = attendeeRows.filter((a) => a.role !== "organizer");
  if (recipients.length === 0) return { sent: 0, failed: 0, noProvider: false };

  const icsAttendees: ICSAttendee[] = attendeeRows.map((a) => ({
    email: a.email,
    name: a.name,
    role: (a.role as ICSAttendee["role"]) ?? "required",
    status: (a.status as ICSAttendee["status"]) ?? "pending",
  }));

  const icsEvent = {
    uid: appt.icalUid,
    title: appt.title,
    description: appt.description,
    location: appt.location,
    // conferenceLink doubles as locationUrl in the ICS when no explicit URL is set,
    // so conference clients (Outlook, Google) show/join the link directly.
    locationUrl: appt.locationUrl ?? appt.conferenceLink ?? null,
    startAt: appt.startAt,
    endAt: appt.endAt,
    sequence: appt.sequence,
    organizer: {
      email: appt.organizerEmail ?? "noreply@fluxcrm.app",
      name: appt.organizerName ?? "Flux CRM",
    },
    attendees: icsAttendees,
    reminderMinutes: appt.reminderMinutes,
  };

  const icsContent = generateICS(icsEvent, method);

  const emailData: AppointmentEmailData = {
    title: appt.title,
    description: appt.description,
    startAt: appt.startAt,
    endAt: appt.endAt,
    location: appt.location,
    locationUrl: appt.locationUrl,
    conferenceLink: appt.conferenceLink,
    organizerName: appt.organizerName ?? "Flux CRM",
    icsContent,
    method,
  };

  const results = await Promise.all(
    recipients.map((attendee) => {
      const rsvpLinks =
        method === "REQUEST" && attendee.responseToken
          ? {
              accept: `${appBase()}/api/appointments/rsvp?token=${attendee.responseToken}&r=accept`,
              decline: `${appBase()}/api/appointments/rsvp?token=${attendee.responseToken}&r=decline`,
              tentative: `${appBase()}/api/appointments/rsvp?token=${attendee.responseToken}&r=tentative`,
            }
          : undefined;

      return sendAppointmentInviteEmail({ email: attendee.email, name: attendee.name }, emailData, rsvpLinks);
    }),
  );

  const sent = results.filter((r) => r.success).length;
  const failed = results.length - sent;

  if (failed > 0) {
    const errors = results.filter((r) => !r.success).map((r) => r.error ?? "unknown");
    console.error("[EMAIL] Appointment invite failures:", errors);
  }

  return { sent, failed, noProvider: false };
}

// ─── Create ───────────────────────────────────────────────────────────────────

export type AttendeeInput = {
  email: string;
  name: string;
  role?: "required" | "optional";
  userId?: string;
  contactId?: string;
};

export async function createAppointment(data: {
  title: string;
  description?: string;
  startAt: Date;
  endAt: Date;
  timezone?: string;
  location?: string;
  locationUrl?: string;
  conferenceType?: string;
  conferenceLink?: string;
  autoGenerateLink?: boolean;
  reminderMinutes?: number;
  contactId?: string;
  dealId?: string;
  companyId?: string;
  leadId?: string;
  attendees: AttendeeInput[];
}) {
  await requireWriteAccess();
  const db = await getDb();
  const session = await auth();
  const organizerId = session?.user?.id;

  const conferenceLink =
    data.autoGenerateLink && data.conferenceType === "jitsi" ? generateJitsiLink() : (data.conferenceLink ?? undefined);

  const icalUid = `${crypto.randomUUID()}@fluxcrm.app`;

  // The id is made here so the meeting and the people invited to it are one
  // commit. They were an insert followed by a loop of inserts, one round trip
  // each: a failure partway through left a meeting with some of its invitees, and
  // the invitations then went out to exactly that half (audit rilievo M-04).
  const appointmentId = crypto.randomUUID();

  const attendeeRows: (typeof appointmentAttendees.$inferInsert)[] = [];

  // Whoever is calling is in the room by definition, and already accepted.
  if (organizerId) {
    const organizer = await db
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, organizerId))
      .then((r) => r[0]);

    if (organizer?.email) {
      attendeeRows.push({
        appointmentId,
        userId: organizerId,
        email: organizer.email,
        name: organizer.name ?? "Organizer",
        role: "organizer",
        status: "accepted",
      });
    }
  }

  for (const a of data.attendees) {
    attendeeRows.push({
      appointmentId,
      userId: a.userId,
      contactId: a.contactId,
      email: a.email,
      name: a.name,
      role: a.role ?? "required",
      status: "pending",
      responseToken: generateResponseToken(),
    });
  }

  const writes: unknown[] = [
    db
      .insert(appointments)
      .values({
        id: appointmentId,
        title: data.title,
        description: data.description,
        startAt: data.startAt,
        endAt: data.endAt,
        timezone: data.timezone ?? "Europe/Rome",
        location: data.location,
        locationUrl: data.locationUrl,
        conferenceType: data.conferenceType,
        conferenceLink,
        icalUid,
        sequence: 0,
        organizerId,
        contactId: data.contactId,
        dealId: data.dealId,
        companyId: data.companyId,
        leadId: data.leadId,
        reminderMinutes: data.reminderMinutes,
      })
      .returning(),
  ];
  if (attendeeRows.length > 0) {
    writes.push(db.insert(appointmentAttendees).values(attendeeRows));
  }

  const results = await db.batch(writes as unknown as Parameters<typeof db.batch>[0]);
  const [appt] = results[0] as (typeof appointments.$inferSelect)[];

  revalidatePath("/dashboard/calendar");

  const inviteStatus = await dispatchInvites(appt.id, "REQUEST");

  return { ...appt, inviteStatus };
}

// ─── Update ───────────────────────────────────────────────────────────────────

export async function updateAppointment(
  id: string,
  data: {
    title?: string;
    description?: string;
    startAt?: Date;
    endAt?: Date;
    location?: string;
    locationUrl?: string;
    conferenceType?: string;
    conferenceLink?: string;
    autoGenerateLink?: boolean;
    reminderMinutes?: number;
    attendees?: AttendeeInput[];
  },
) {
  await requireWriteAccess();
  const db = await getDb();

  const [existing] = await db
    .select({ sequence: appointments.sequence })
    .from(appointments)
    .where(eq(appointments.id, id));
  if (!existing) throw new Error("Appointment not found");

  const conferenceLink =
    data.autoGenerateLink && data.conferenceType === "jitsi" ? generateJitsiLink() : data.conferenceLink;

  await db
    .update(appointments)
    .set({
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.startAt !== undefined ? { startAt: data.startAt } : {}),
      ...(data.endAt !== undefined ? { endAt: data.endAt } : {}),
      ...(data.location !== undefined ? { location: data.location } : {}),
      ...(data.locationUrl !== undefined ? { locationUrl: data.locationUrl } : {}),
      ...(data.conferenceType !== undefined ? { conferenceType: data.conferenceType } : {}),
      ...(conferenceLink !== undefined ? { conferenceLink } : {}),
      ...(data.reminderMinutes !== undefined ? { reminderMinutes: data.reminderMinutes } : {}),
      sequence: existing.sequence + 1,
      updatedAt: new Date(),
    })
    .where(eq(appointments.id, id));

  // Re-sync attendees if provided
  if (data.attendees) {
    const existingAttendees = await db
      .select()
      .from(appointmentAttendees)
      .where(and(eq(appointmentAttendees.appointmentId, id), ne(appointmentAttendees.role, "organizer")));

    const existingEmails = new Set(existingAttendees.map((a) => a.email));
    const newEmails = new Set(data.attendees.map((a) => a.email));

    const dropped = existingAttendees.filter((ea) => !newEmails.has(ea.email)).map((ea) => ea.id);
    const added = data.attendees
      .filter((a) => !existingEmails.has(a.email))
      .map((a) => ({
        appointmentId: id,
        userId: a.userId,
        contactId: a.contactId,
        email: a.email,
        name: a.name,
        role: a.role ?? "required",
        status: "pending",
        responseToken: generateResponseToken(),
      }));

    // One commit, and one round trip each way rather than one per person. The
    // invitations are sent from this list a moment later, so a half-applied
    // change is a half-invited meeting (audit rilievo M-04).
    const writes: unknown[] = [];
    if (dropped.length > 0) {
      writes.push(db.delete(appointmentAttendees).where(inArray(appointmentAttendees.id, dropped)));
    }
    if (added.length > 0) {
      writes.push(db.insert(appointmentAttendees).values(added));
    }
    if (writes.length > 0) {
      await db.batch(writes as unknown as Parameters<typeof db.batch>[0]);
    }
  }

  revalidatePath("/dashboard/calendar");
  const inviteStatus = await dispatchInvites(id, "REQUEST");
  return { inviteStatus };
}

// ─── Cancel ───────────────────────────────────────────────────────────────────

export async function cancelAppointment(id: string) {
  await requireWriteAccess();
  const db = await getDb();

  // Increment sequence so iCalendar clients recognise this as a newer update (RFC 5545 §3.7.4)
  const [existing] = await db
    .select({ sequence: appointments.sequence })
    .from(appointments)
    .where(eq(appointments.id, id));

  await db
    .update(appointments)
    .set({
      status: "cancelled",
      sequence: (existing?.sequence ?? 0) + 1,
      updatedAt: new Date(),
    })
    .where(eq(appointments.id, id));

  revalidatePath("/dashboard/calendar");
  const inviteStatus = await dispatchInvites(id, "CANCEL");
  return { inviteStatus };
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function deleteAppointment(id: string) {
  await requireWriteAccess();
  const db = await getDb();
  await db.delete(appointments).where(eq(appointments.id, id));
  revalidatePath("/dashboard/calendar");
}

// ─── RSVP ─────────────────────────────────────────────────────────────────────

/**
 * Records an invitee's answer from the emailed RSVP link.
 *
 * The person clicking is external: no account, no session, no workspace header.
 * `getDb()` therefore threw before reading anything, so every RSVP link in every
 * invitation was dead (audit rilievo B-01). The workspace is derived from the
 * attendee token, which is what identifies the invitation in the first place.
 */
export async function updateAttendeeRsvp(token: string, response: "accept" | "decline" | "tentative") {
  const resolved = await resolveTenantByProbe(`rsvp:${token}`, async (tenantDb) => {
    const row = await tenantDb.query.appointmentAttendees.findFirst({
      where: eq(appointmentAttendees.responseToken, token),
      columns: { id: true },
    });
    return Boolean(row);
  }).catch(() => null);

  if (!resolved) return { success: false, error: "Invalid or expired invitation link." };

  const db = resolved.db;
  const statusMap = {
    accept: "accepted",
    decline: "declined",
    tentative: "tentative",
  } as const;

  const [attendee] = await db
    .select({ id: appointmentAttendees.id, appointmentId: appointmentAttendees.appointmentId })
    .from(appointmentAttendees)
    .where(eq(appointmentAttendees.responseToken, token));

  if (!attendee) return { success: false, error: "Invalid or expired invitation link." };

  await db
    .update(appointmentAttendees)
    .set({ status: statusMap[response], responseAt: new Date() })
    .where(eq(appointmentAttendees.id, attendee.id));

  return { success: true, appointmentId: attendee.appointmentId };
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getAppointments(filterUserIds?: string[] | null, range?: { start: Date; end: Date }) {
  await requireCapability("record:read");
  const db = await getDb();
  let userFilter: ReturnType<typeof or> | undefined;

  if (filterUserIds && filterUserIds.length > 0) {
    // Collect appointment IDs where one of the filtered users is an attendee
    const attendeeRows = await db
      .select({ appointmentId: appointmentAttendees.appointmentId })
      .from(appointmentAttendees)
      .where(and(isNotNull(appointmentAttendees.userId), inArray(appointmentAttendees.userId, filterUserIds)));

    const attendeeApptIds = [...new Set(attendeeRows.map((r) => r.appointmentId))];
    const conditions: Parameters<typeof or> = [inArray(appointments.organizerId, filterUserIds)];
    if (attendeeApptIds.length > 0) conditions.push(inArray(appointments.id, attendeeApptIds));
    userFilter = or(...conditions);
  }

  const rows = await db
    .select({
      id: appointments.id,
      title: appointments.title,
      description: appointments.description,
      startAt: appointments.startAt,
      endAt: appointments.endAt,
      location: appointments.location,
      conferenceLink: appointments.conferenceLink,
      status: appointments.status,
      icalUid: appointments.icalUid,
      organizerId: appointments.organizerId,
      contactName: contacts.firstName,
      contactLastName: contacts.lastName,
      companyName: companies.name,
      dealName: deals.name,
      leadName: leads.firstName,
      leadLastName: leads.lastName,
      contactId: appointments.contactId,
      companyId: appointments.companyId,
      dealId: appointments.dealId,
      leadId: appointments.leadId,
    })
    .from(appointments)
    .leftJoin(contacts, eq(appointments.contactId, contacts.id))
    .leftJoin(companies, eq(appointments.companyId, companies.id))
    .leftJoin(deals, eq(appointments.dealId, deals.id))
    .leftJoin(leads, eq(appointments.leadId, leads.id))
    .where(
      and(
        userFilter,
        range ? gte(appointments.startAt, range.start) : undefined,
        range ? lte(appointments.startAt, range.end) : undefined,
      ),
    );

  return rows;
}

export async function getAppointmentById(id: string) {
  await requireCapability("record:read");
  const db = await getDb();
  const [appt] = await db.select().from(appointments).where(eq(appointments.id, id));

  if (!appt) return null;

  const attendees = await db.select().from(appointmentAttendees).where(eq(appointmentAttendees.appointmentId, id));

  return { ...appt, attendees };
}

// Returns appointments that overlap with [start, end] for conflict detection
export async function getOverlappingAppointments(startAt: Date, endAt: Date, excludeId?: string) {
  await requireCapability("record:read");
  const db = await getDb();
  const rows = await db
    .select({
      id: appointments.id,
      title: appointments.title,
      startAt: appointments.startAt,
      endAt: appointments.endAt,
    })
    .from(appointments)
    .where(
      and(
        ne(appointments.status, "cancelled"),
        ...(excludeId ? [ne(appointments.id, excludeId)] : []),
        lte(appointments.startAt, endAt),
        gte(appointments.endAt, startAt),
      ),
    );
  return rows;
}

// For calendar action — returns formatted events
export async function getAppointmentCalendarEvents(
  filterUserIds?: string[] | null,
  range?: { start: Date; end: Date },
) {
  await requireCapability("record:read");
  const rows = await getAppointments(filterUserIds, range);

  return rows
    .filter((r) => r.status !== "cancelled")
    .map((r) => ({
      id: r.id,
      title: r.title,
      date: r.startAt,
      endAt: r.endAt,
      type: "appointment" as const,
      status: r.status,
      priority: "normal" as const,
      displayTitle: r.title.length > 50 ? `${r.title.slice(0, 50)}…` : r.title,
      entityName: r.contactName
        ? `${r.contactName} ${r.contactLastName ?? ""}`.trim()
        : (r.companyName ?? r.dealName ?? (r.leadName ? `${r.leadName} ${r.leadLastName ?? ""}`.trim() : "No Entity")),
      link: `/dashboard/calendar?appointment=${r.id}`,
      location: r.location,
      conferenceLink: r.conferenceLink,
    }));
}

// Lists all users for participant picker (only those with a verified email)
export async function getInternalUsers() {
  await requireCapability("record:read");
  const db = await getDb();
  return await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(isNotNull(users.email));
}

// Lists contacts for participant picker
export async function getContactsForPicker() {
  await requireCapability("record:read");
  const db = await getDb();
  return await db
    .select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
    })
    .from(contacts)
    .where(eq(contacts.status, "active"))
    .limit(500);
}

// ─── Colleague availability ───────────────────────────────────────────────────

export type BusySlot = { startAt: Date; endAt: Date; title: string };

export async function getColleagueAvailability(userIds: string[], date: Date): Promise<Record<string, BusySlot[]>> {
  await requireCapability("record:read");
  if (userIds.length === 0) return {};
  const db = await getDb();

  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);

  // Organizer-side busy slots
  const organizerRows = await db
    .select({
      title: appointments.title,
      startAt: appointments.startAt,
      endAt: appointments.endAt,
      organizerId: appointments.organizerId,
    })
    .from(appointments)
    .where(
      and(
        ne(appointments.status, "cancelled"),
        isNotNull(appointments.organizerId),
        inArray(appointments.organizerId, userIds),
        gte(appointments.startAt, dayStart),
        lte(appointments.startAt, dayEnd),
      ),
    );

  // Attendee-side busy slots
  const attendeeRows = await db
    .select({
      title: appointments.title,
      startAt: appointments.startAt,
      endAt: appointments.endAt,
      userId: appointmentAttendees.userId,
    })
    .from(appointmentAttendees)
    .innerJoin(appointments, eq(appointmentAttendees.appointmentId, appointments.id))
    .where(
      and(
        ne(appointments.status, "cancelled"),
        isNotNull(appointmentAttendees.userId),
        inArray(appointmentAttendees.userId, userIds),
        gte(appointments.startAt, dayStart),
        lte(appointments.startAt, dayEnd),
      ),
    );

  const result: Record<string, BusySlot[]> = {};
  for (const uid of userIds) result[uid] = [];

  for (const row of organizerRows) {
    if (row.organizerId) {
      result[row.organizerId].push({ startAt: row.startAt, endAt: row.endAt, title: row.title });
    }
  }

  for (const row of attendeeRows) {
    if (row.userId && result[row.userId]) {
      const exists = result[row.userId].some((s) => s.startAt.getTime() === row.startAt.getTime());
      if (!exists) result[row.userId].push({ startAt: row.startAt, endAt: row.endAt, title: row.title });
    }
  }

  return result;
}
