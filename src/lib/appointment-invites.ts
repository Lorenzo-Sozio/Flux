import { eq, inArray } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

import { appointmentAttendees, appointments, companies, contacts, users } from "@/db/schema";
import { getAppUrl } from "@/lib/app-url";
import { type DocumentLanguage, documentLanguage } from "@/lib/document-language";
import { type AppointmentEmailData, sendAppointmentInviteEmail } from "@/lib/email";
import { loadEmailBrand, signatureFor } from "@/lib/email-brand-load";
import { getEmailConfig } from "@/lib/email-provider";
import { generateICS, type ICSAttendee } from "@/lib/ical";
import { parseRRule } from "@/lib/recurrence";
import { describeRecurrence } from "@/lib/recurrence-text";
import { getDb } from "@/lib/tenant-context";
import { safeTimeZone } from "@/lib/wall-clock";
import { getWorkspaceTimeZone } from "@/lib/workspace-time-zone";

/**
 * Sends an appointment's invitations — or its cancellation — to everyone on it but the
 * organiser, with the calendar file attached.
 *
 * ⚠️ A library function, not an action: it was a private function of the appointments
 * actions file, and the public booking route needs it too (src/lib/booking.ts). Exported
 * from a `"use server"` module it would have become an endpoint anybody could call with any
 * appointment id. It reads the workspace from the request, so a caller outside the
 * dashboard runs it inside `runWithTenant`.
 */

export type InviteResult = {
  sent: number;
  failed: number;
  noProvider: boolean;
};

// Resolved per call, not at import: `getAppUrl()` refuses to guess in production.
function appBase(): string {
  return getAppUrl();
}

export async function dispatchInvites(
  appointmentId: string,
  method: "REQUEST" | "CANCEL",
  options: { isUpdate?: boolean } = {},
): Promise<InviteResult> {
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
      timezone: appointments.timezone,
      allDay: appointments.allDay,
      recurrenceRule: appointments.recurrenceRule,
      recurrenceExceptions: appointments.recurrenceExceptions,
      location: appointments.location,
      locationUrl: appointments.locationUrl,
      conferenceLink: appointments.conferenceLink,
      icalUid: appointments.icalUid,
      sequence: appointments.sequence,
      reminderMinutes: appointments.reminderMinutes,
      organizerId: appointments.organizerId,
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

  const timeZone = safeTimeZone(appt.timezone, await getWorkspaceTimeZone());

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
    timeZone,
    allDay: appt.allDay,
    recurrenceRule: appt.recurrenceRule,
    recurrenceExceptions: appt.recurrenceExceptions,
  };

  const icsContent = generateICS(icsEvent, method);

  // ⚠️ Each recipient reads it in their language: a customer's company decides it (as on the
  // quote), a colleague or an address typed by hand reads Italian. It was Italian for everybody.
  const contactIds = recipients.map((a) => a.contactId).filter((id): id is string => Boolean(id));
  const languageOf = new Map<string, DocumentLanguage>();
  if (contactIds.length > 0) {
    const rows = await db
      .select({ id: contacts.id, language: companies.language, country: companies.country })
      .from(contacts)
      .leftJoin(companies, eq(contacts.companyId, companies.id))
      .where(inArray(contacts.id, contactIds))
      .catch(() => []);
    for (const r of rows) languageOf.set(r.id, documentLanguage(r));
  }
  const langOf = (a: { contactId: string | null }): DocumentLanguage =>
    (a.contactId && languageOf.get(a.contactId)) || "it";

  const rule = parseRRule(appt.recurrenceRule);
  const recurrenceText = new Map<DocumentLanguage, string | null>();
  const brand = await loadEmailBrand(db);
  const signature = new Map<DocumentLanguage, string>();
  for (const lang of new Set(recipients.map(langOf))) {
    if (rule) {
      const t = (await getTranslations({ locale: lang, namespace: "appointment" })) as unknown as (
        key: string,
        values?: Record<string, string | number>,
      ) => string;
      recurrenceText.set(lang, describeRecurrence(t, rule, appt.startAt, timeZone, lang));
    }
    signature.set(lang, await signatureFor(db, appt.organizerId, brand, "compact", lang));
  }

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
    timeZone,
    allDay: appt.allDay,
    isUpdate: options.isUpdate,
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

      const lang = langOf(attendee);
      return sendAppointmentInviteEmail(
        { email: attendee.email, name: attendee.name },
        { ...emailData, recurrenceText: recurrenceText.get(lang) ?? null },
        rsvpLinks,
        { brand, signature: signature.get(lang) ?? "", lang },
      );
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
