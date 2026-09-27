"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";

import { auth } from "@/auth";
import { appointmentAttendees, appointments, companies, contacts, deals, leads, users } from "@/db/schema";
import { dispatchInvites, type InviteResult } from "@/lib/appointment-invites";
import { mirrorAppointments } from "@/lib/appointment-mirror";
import { requireCapability, requireWriteAccess } from "@/lib/auth-guard";
import { type BusySlot, busyByUser, inWindow, occurrencesOf } from "@/lib/availability";
import { countBefore, formatRRule, parseRRule, rebaseRule } from "@/lib/recurrence";
import { tolerateUnmigrated } from "@/lib/schema-ready";
import { getDb } from "@/lib/tenant-context";
import { resolveTenantByProbe } from "@/lib/tenant-resolve";
import {
  addDaysToDate,
  addMinutesToWall,
  fromWallValue,
  safeTimeZone,
  toWallValue,
  wallDiffMinutes,
} from "@/lib/wall-clock";
import { getWorkspaceTimeZone } from "@/lib/workspace-time-zone";

export type { InviteResult };

/**
 * Which part of a repeating appointment a change is for — the three answers
 * every calendar asks for. Ignored for an appointment that does not repeat.
 */
export type RecurrenceScope = "this" | "following" | "all";

/** The occurrence a change was made from, and how far it reaches. */
export type OccurrenceTarget = { scope: RecurrenceScope; occurrence: string };

const NOT_NOTIFIED: InviteResult = { sent: 0, failed: 0, noProvider: false };

/** Adds up the notices of several sends, for the one toast the person sees. */
function sumInvites(...results: InviteResult[]): InviteResult {
  return results.reduce(
    (acc, r) => ({
      sent: acc.sent + r.sent,
      failed: acc.failed + r.failed,
      noProvider: acc.noProvider || r.noProvider,
    }),
    NOT_NOTIFIED,
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateJitsiLink(): string {
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `https://meet.jit.si/flux-${id}`;
}

function generateResponseToken(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/** A stored rule in its one written form; null for none; throws for one this product cannot expand. */
function normaliseRule(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const rule = parseRRule(raw);
  if (!rule) throw new Error("Unsupported recurrence rule");
  return formatRRule(rule);
}

function assertRange(startAt: Date, endAt: Date) {
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
    throw new Error("The end must be after the start");
  }
}

// ─── Create ───────────────────────────────────────────────────────────────────

export type AttendeeInput = {
  email: string;
  name: string;
  role?: "required" | "optional";
  userId?: string;
  contactId?: string;
};

type Db = Awaited<ReturnType<typeof getDb>>;
type AppointmentRow = typeof appointments.$inferSelect;

/**
 * Writes an appointment and the people invited to it in one commit.
 *
 * The id is made here so the meeting and the people invited to it are one
 * commit. They were an insert followed by a loop of inserts, one round trip
 * each: a failure partway through left a meeting with some of its invitees, and
 * the invitations then went out to exactly that half (audit rilievo M-04).
 */
async function insertAppointment(
  db: Db,
  values: Omit<typeof appointments.$inferInsert, "id" | "icalUid" | "sequence">,
  attendees: AttendeeInput[],
  organizerId: string | null | undefined,
): Promise<AppointmentRow> {
  const appointmentId = crypto.randomUUID();
  const attendeeRows: (typeof appointmentAttendees.$inferInsert)[] = [];

  // Whoever organises it is in the room by definition, and already accepted.
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

  const seen = new Set(attendeeRows.map((a) => a.email.toLowerCase()));
  for (const a of attendees) {
    const email = a.email.trim();
    if (!email || seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    attendeeRows.push({
      appointmentId,
      userId: a.userId,
      contactId: a.contactId,
      email,
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
        ...values,
        id: appointmentId,
        organizerId: organizerId ?? null,
        icalUid: `${crypto.randomUUID()}@fluxcrm.app`,
        sequence: 0,
      })
      .returning(),
  ];
  if (attendeeRows.length > 0) {
    writes.push(db.insert(appointmentAttendees).values(attendeeRows));
  }

  const results = await db.batch(writes as unknown as Parameters<typeof db.batch>[0]);
  const [appt] = results[0] as AppointmentRow[];
  return appt;
}

export async function createAppointment(data: {
  title: string;
  description?: string;
  startAt: Date;
  endAt: Date;
  allDay?: boolean;
  /** An RRULE without its prefix, as the form's recurrence picker writes it. */
  recurrenceRule?: string | null;
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
  /** False saves the meeting without emailing anybody. Defaults to true. */
  notifyAttendees?: boolean;
}) {
  await requireWriteAccess();
  if (!data.title?.trim()) throw new Error("A title is required");
  assertRange(data.startAt, data.endAt);
  const db = await getDb();
  const session = await auth();

  const conferenceLink =
    data.autoGenerateLink && data.conferenceType === "jitsi" ? generateJitsiLink() : (data.conferenceLink ?? undefined);

  const appt = await insertAppointment(
    db,
    {
      title: data.title.trim(),
      description: data.description,
      startAt: data.startAt,
      endAt: data.endAt,
      // The series keeps to the workspace's clock: the one the grid is drawn on
      // and the form was filled in on.
      timezone: await getWorkspaceTimeZone(),
      allDay: data.allDay ?? false,
      recurrenceRule: normaliseRule(data.recurrenceRule),
      location: data.location,
      locationUrl: data.locationUrl,
      conferenceType: data.conferenceType,
      conferenceLink,
      contactId: data.contactId,
      dealId: data.dealId,
      companyId: data.companyId,
      leadId: data.leadId,
      reminderMinutes: data.reminderMinutes,
    },
    data.attendees,
    session?.user?.id,
  );

  revalidatePath("/dashboard/calendar");

  const inviteStatus = data.notifyAttendees === false ? NOT_NOTIFIED : await dispatchInvites(appt.id, "REQUEST");
  await mirrorLater(appt.id);

  return { ...appt, inviteStatus };
}

/**
 * The organiser's connected calendar (V3.2, src/lib/appointment-mirror.ts), brought in line
 * after the response. Outside a request — a script, a test — it runs in place.
 */
async function mirrorLater(...ids: string[]) {
  const [db, zone] = await Promise.all([getDb(), getWorkspaceTimeZone()]);
  const work = () =>
    mirrorAppointments(db, ids, { zone }).catch((err) =>
      console.error("[appointments] calendar mirror failed:", err instanceof Error ? err.message : err),
    );
  try {
    after(work);
  } catch {
    await work();
  }
}

// ─── Update ───────────────────────────────────────────────────────────────────

export type AppointmentUpdate = {
  title?: string;
  description?: string | null;
  startAt?: Date;
  endAt?: Date;
  allDay?: boolean;
  recurrenceRule?: string | null;
  location?: string | null;
  locationUrl?: string | null;
  /** "none" or null removes the video call and its link. */
  conferenceType?: string | null;
  conferenceLink?: string | null;
  reminderMinutes?: number | null;
  contactId?: string | null;
  companyId?: string | null;
  dealId?: string | null;
  leadId?: string | null;
  attendees?: AttendeeInput[];
  /** False saves without emailing anybody. Defaults to true. */
  notifyAttendees?: boolean;
};

const blank = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() ? v.trim() : null);

/** The columns an update writes, from what the form sent and what is stored. */
function columnsFor(existing: AppointmentRow, data: AppointmentUpdate): Partial<typeof appointments.$inferInsert> {
  // ⚠️ A Jitsi room that already exists is kept. Regenerating it on every edit
  // would send everybody a new link and strand whoever saved the old one.
  let conferenceType: string | null | undefined = data.conferenceType;
  let conferenceLink: string | null | undefined = blank(data.conferenceLink);
  if (conferenceType === "none" || conferenceType === null) {
    conferenceType = null;
    conferenceLink = null;
  } else if (conferenceType === "jitsi") {
    conferenceLink =
      existing.conferenceType === "jitsi" && existing.conferenceLink ? existing.conferenceLink : generateJitsiLink();
  }

  const set: Partial<typeof appointments.$inferInsert> = {};
  if (data.title !== undefined) set.title = data.title.trim();
  if (data.description !== undefined) set.description = blank(data.description);
  if (data.startAt !== undefined) set.startAt = data.startAt;
  if (data.endAt !== undefined) set.endAt = data.endAt;
  if (data.allDay !== undefined) set.allDay = data.allDay;
  if (data.recurrenceRule !== undefined) set.recurrenceRule = normaliseRule(data.recurrenceRule);
  if (data.location !== undefined) set.location = blank(data.location);
  if (data.locationUrl !== undefined) set.locationUrl = blank(data.locationUrl);
  if (conferenceType !== undefined) set.conferenceType = conferenceType;
  if (conferenceLink !== undefined) set.conferenceLink = conferenceLink;
  if (data.reminderMinutes !== undefined) set.reminderMinutes = data.reminderMinutes;
  if (data.contactId !== undefined) set.contactId = data.contactId;
  if (data.companyId !== undefined) set.companyId = data.companyId;
  if (data.dealId !== undefined) set.dealId = data.dealId;
  if (data.leadId !== undefined) set.leadId = data.leadId;
  return set;
}

/** Everything a copy of `existing` carries, with `data` applied on top. */
function copyOf(existing: AppointmentRow, data: AppointmentUpdate) {
  const set = columnsFor(existing, data);
  return {
    title: set.title ?? existing.title,
    description: set.description !== undefined ? set.description : existing.description,
    startAt: set.startAt ?? existing.startAt,
    endAt: set.endAt ?? existing.endAt,
    timezone: existing.timezone,
    allDay: set.allDay ?? existing.allDay,
    recurrenceRule: set.recurrenceRule !== undefined ? set.recurrenceRule : existing.recurrenceRule,
    location: set.location !== undefined ? set.location : existing.location,
    locationUrl: set.locationUrl !== undefined ? set.locationUrl : existing.locationUrl,
    conferenceType: set.conferenceType !== undefined ? set.conferenceType : existing.conferenceType,
    conferenceLink: set.conferenceLink !== undefined ? set.conferenceLink : existing.conferenceLink,
    reminderMinutes: set.reminderMinutes !== undefined ? set.reminderMinutes : existing.reminderMinutes,
    contactId: set.contactId !== undefined ? set.contactId : existing.contactId,
    companyId: set.companyId !== undefined ? set.companyId : existing.companyId,
    dealId: set.dealId !== undefined ? set.dealId : existing.dealId,
    leadId: set.leadId !== undefined ? set.leadId : existing.leadId,
  };
}

async function currentAttendees(db: Db, id: string): Promise<AttendeeInput[]> {
  const rows = await db
    .select()
    .from(appointmentAttendees)
    .where(and(eq(appointmentAttendees.appointmentId, id), ne(appointmentAttendees.role, "organizer")));
  return rows.map((a) => ({
    email: a.email,
    name: a.name,
    role: a.role === "optional" ? "optional" : "required",
    userId: a.userId ?? undefined,
    contactId: a.contactId ?? undefined,
  }));
}

/**
 * Ends a series just before `occurrence`: a COUNT becomes the number already
 * held, anything else an UNTIL one second earlier.
 */
function ruleEndingBefore(existing: AppointmentRow, occurrence: Date, timeZone: string): string | null {
  const rule = parseRRule(existing.recurrenceRule);
  if (!rule) return existing.recurrenceRule;
  if (rule.count) {
    const held = countBefore({ start: existing.startAt, rule, timeZone, before: occurrence });
    return formatRRule({ ...rule, count: Math.max(held, 1), until: undefined });
  }
  return formatRRule({ ...rule, until: new Date(occurrence.getTime() - 1000), count: undefined });
}

/**
 * Edits an appointment. A field left `undefined` is untouched; `null` or an
 * empty string clears it, which is how a location or a reminder is removed.
 *
 * For a repeating appointment, `target` says which occurrence the edit was made
 * from and how far it reaches:
 *
 *   all        the series. Times move by as much as that occurrence moved, so
 *              dragging next Tuesday's meeting an hour later moves every one.
 *   this       that occurrence leaves the series (EXDATE) and becomes an
 *              appointment of its own, with the edit applied.
 *   following  the series ends before it, and a new series starts there.
 */
export async function updateAppointment(id: string, data: AppointmentUpdate, target?: OccurrenceTarget) {
  await requireWriteAccess();
  const db = await getDb();

  const [existing] = await db.select().from(appointments).where(eq(appointments.id, id));
  if (!existing) throw new Error("Appointment not found");
  if (data.title !== undefined && !data.title.trim()) throw new Error("A title is required");

  const timeZone = safeTimeZone(existing.timezone, await getWorkspaceTimeZone());
  const notify = data.notifyAttendees !== false && existing.status !== "cancelled";
  const occurrence = target ? new Date(target.occurrence) : null;
  const recurring = Boolean(existing.recurrenceRule) && occurrence && !Number.isNaN(occurrence.getTime());
  const scope = recurring ? (target?.scope ?? "all") : "all";

  /**
   * Whether the caller changed the rule, rather than sending the stored one back.
   * The form sends the rule on every save; treating that as an edit made "this
   * and following" start the rest of a ten-meeting series with ten more.
   */
  const storedRule = existing.recurrenceRule ? normaliseRule(existing.recurrenceRule) : null;
  const ruleEdited = data.recurrenceRule !== undefined && normaliseRule(data.recurrenceRule) !== storedRule;

  /**
   * How far an occurrence moved, on the wall clock: minutes, and whole days. A
   * series and its removed dates move by the same wall-clock amount, so a meeting
   * at ten moved to eleven is at eleven in summer and in winter alike.
   */
  const moveOf = (from: Date, to: Date) => {
    const a = toWallValue(from, timeZone);
    const b = toWallValue(to, timeZone);
    const minutes = wallDiffMinutes(a, b);
    const days = wallDiffMinutes(`${a.slice(0, 10)}T00:00`, `${b.slice(0, 10)}T00:00`) / 1440;
    const apply = (d: Date) => fromWallValue(addMinutesToWall(toWallValue(d, timeZone), minutes), timeZone) ?? d;
    return { minutes, days, apply };
  };

  // ── This occurrence only, or this and the ones after it ─────────────────────
  const splitsAtFirst = occurrence?.getTime() === existing.startAt.getTime();
  if (recurring && occurrence && (scope === "this" || (scope === "following" && !splitsAtFirst))) {
    const duration = existing.endAt.getTime() - existing.startAt.getTime();
    const startAt = data.startAt ?? occurrence;
    const endAt = data.endAt ?? new Date(startAt.getTime() + duration);
    assertRange(startAt, endAt);

    const cut: Partial<typeof appointments.$inferInsert> = { sequence: existing.sequence + 1, updatedAt: new Date() };
    let newRule: string | null;
    if (scope === "this") {
      cut.recurrenceExceptions = [...(existing.recurrenceExceptions ?? []), occurrence.toISOString()];
      newRule = null;
    } else {
      cut.recurrenceRule = ruleEndingBefore(existing, occurrence, timeZone);
      // What is left of a counted series travels to the new one: ten meetings
      // split at the fifth are four and six, not four and ten.
      const stored = parseRRule(existing.recurrenceRule);
      const held = stored ? countBefore({ start: existing.startAt, rule: stored, timeZone, before: occurrence }) : 0;
      const edited = ruleEdited ? parseRRule(data.recurrenceRule) : null;
      if (ruleEdited && !edited) {
        newRule = null;
      } else {
        const base = edited ?? stored;
        const withCount =
          base?.count !== undefined && stored?.count !== undefined && base.count === stored.count
            ? { ...base, count: Math.max(stored.count - held, 1) }
            : base;
        // A rule nobody touched follows the series to its new day.
        const moved = moveOf(occurrence, startAt);
        const rebased = withCount && !edited ? rebaseRule(withCount, moved.days, startAt, timeZone) : withCount;
        newRule = rebased ? formatRRule(rebased) : null;
      }
    }
    await db.update(appointments).set(cut).where(eq(appointments.id, id));

    const moved = moveOf(occurrence, startAt);
    const laterExceptions =
      scope === "following"
        ? (existing.recurrenceExceptions ?? [])
            .filter((e) => new Date(e) > occurrence)
            .map((e) => moved.apply(new Date(e)).toISOString())
        : null;

    const copy = await insertAppointment(
      db,
      {
        ...copyOf(existing, data),
        startAt,
        endAt,
        recurrenceRule: newRule,
        recurrenceExceptions: laterExceptions?.length ? laterExceptions : null,
        recurrenceParentId: scope === "this" ? existing.id : null,
      },
      data.attendees ?? (await currentAttendees(db, id)),
      existing.organizerId,
    );

    revalidatePath("/dashboard/calendar");
    const inviteStatus = notify
      ? sumInvites(await dispatchInvites(id, "REQUEST", { isUpdate: true }), await dispatchInvites(copy.id, "REQUEST"))
      : NOT_NOTIFIED;
    await mirrorLater(id, copy.id);
    return { inviteStatus, appointmentId: copy.id };
  }

  // ── The appointment, or the whole series ────────────────────────────────────
  const set = columnsFor(existing, data);
  let exceptions = existing.recurrenceExceptions;
  if (recurring && occurrence && data.startAt) {
    // The form shows the occurrence it was opened from; the series moves by the
    // same amount, and so do the dates removed from it.
    const moved = moveOf(occurrence, data.startAt);
    const length = data.endAt
      ? wallDiffMinutes(toWallValue(data.startAt, timeZone), toWallValue(data.endAt, timeZone))
      : wallDiffMinutes(toWallValue(existing.startAt, timeZone), toWallValue(existing.endAt, timeZone));
    set.startAt = moved.apply(existing.startAt);
    set.endAt = fromWallValue(addMinutesToWall(toWallValue(set.startAt, timeZone), length), timeZone) ?? existing.endAt;
    if (moved.minutes !== 0 && exceptions?.length) {
      exceptions = exceptions.map((e) => moved.apply(new Date(e)).toISOString());
      set.recurrenceExceptions = exceptions;
    }
    // A rule nobody touched follows the series to its new day of the week.
    const stored = parseRRule(existing.recurrenceRule);
    if (!ruleEdited && stored && moved.days !== 0) {
      set.recurrenceRule = formatRRule(rebaseRule(stored, moved.days, set.startAt, timeZone));
    }
  }
  assertRange(set.startAt ?? existing.startAt, set.endAt ?? existing.endAt);

  const timeChanged =
    (set.startAt !== undefined && set.startAt.getTime() !== existing.startAt.getTime()) ||
    (set.endAt !== undefined && set.endAt.getTime() !== existing.endAt.getTime()) ||
    (set.recurrenceRule !== undefined && set.recurrenceRule !== existing.recurrenceRule);
  const reminderChanged = set.reminderMinutes !== undefined && set.reminderMinutes !== existing.reminderMinutes;

  set.sequence = existing.sequence + 1;
  set.updatedAt = new Date();
  // A changed lead time rings again; a moved start rings again on its own,
  // because the stored occurrence no longer matches.
  if (reminderChanged) set.reminderSentFor = null;

  const writes: unknown[] = [db.update(appointments).set(set).where(eq(appointments.id, id))];

  // ⚠️ An answer given for Tuesday at ten is not an answer for Thursday at three.
  // The updated invitation asks again, so the answers it replaces are cleared.
  if (timeChanged) {
    writes.push(
      db
        .update(appointmentAttendees)
        .set({ status: "pending", responseAt: null })
        .where(and(eq(appointmentAttendees.appointmentId, id), ne(appointmentAttendees.role, "organizer"))),
    );
  }

  if (data.attendees) {
    const existingAttendees = await db
      .select()
      .from(appointmentAttendees)
      .where(and(eq(appointmentAttendees.appointmentId, id), ne(appointmentAttendees.role, "organizer")));

    const byEmail = new Map(existingAttendees.map((a) => [a.email.toLowerCase(), a]));
    const wanted = new Map(data.attendees.map((a) => [a.email.trim().toLowerCase(), a]));

    const dropped = existingAttendees.filter((ea) => !wanted.has(ea.email.toLowerCase())).map((ea) => ea.id);
    const added = [...wanted.entries()]
      .filter(([email]) => !byEmail.has(email))
      .map(([, a]) => ({
        appointmentId: id,
        userId: a.userId,
        contactId: a.contactId,
        email: a.email.trim(),
        name: a.name,
        role: a.role ?? "required",
        status: "pending",
        responseToken: generateResponseToken(),
      }));

    // One commit with the appointment itself: the invitations are sent from this
    // list a moment later, so a half-applied change is a half-invited meeting
    // (audit rilievo M-04).
    if (dropped.length > 0) {
      writes.push(db.delete(appointmentAttendees).where(inArray(appointmentAttendees.id, dropped)));
    }
    if (added.length > 0) {
      writes.push(db.insert(appointmentAttendees).values(added));
    }
    for (const [email, a] of wanted) {
      const current = byEmail.get(email);
      const role = a.role ?? "required";
      if (current && current.role !== role) {
        writes.push(db.update(appointmentAttendees).set({ role }).where(eq(appointmentAttendees.id, current.id)));
      }
    }
  }

  await db.batch(writes as unknown as Parameters<typeof db.batch>[0]);

  revalidatePath("/dashboard/calendar");
  // A cancelled appointment being tidied up is not news to anybody.
  const inviteStatus = notify ? await dispatchInvites(id, "REQUEST", { isUpdate: true }) : NOT_NOTIFIED;
  await mirrorLater(id);
  return { inviteStatus, appointmentId: id };
}

/**
 * Marks a meeting as held, or puts it back on the schedule. Nobody outside is
 * told: whether it happened is the workspace's own bookkeeping. A series has no
 * single answer to that, so it is left alone.
 */
export async function setAppointmentCompleted(id: string, completed: boolean) {
  await requireWriteAccess();
  const db = await getDb();
  await db
    .update(appointments)
    .set({ status: completed ? "completed" : "scheduled", updatedAt: new Date() })
    .where(and(eq(appointments.id, id), ne(appointments.status, "cancelled"), isNull(appointments.recurrenceRule)));
  revalidatePath("/dashboard/calendar");
}

// ─── Removing occurrences ─────────────────────────────────────────────────────

/**
 * Takes one occurrence, or it and every later one, out of a series. The series
 * goes out again as an update, which is how every other calendar learns that a
 * date is gone (EXDATE) or that the series now ends sooner.
 */
async function removeOccurrences(id: string, target: OccurrenceTarget, notify: boolean) {
  const db = await getDb();
  const [existing] = await db.select().from(appointments).where(eq(appointments.id, id));
  if (!existing) return { inviteStatus: NOT_NOTIFIED, removedAll: false };
  const occurrence = new Date(target.occurrence);
  const timeZone = safeTimeZone(existing.timezone, await getWorkspaceTimeZone());

  if (target.scope === "following" && occurrence.getTime() <= existing.startAt.getTime()) {
    return { inviteStatus: NOT_NOTIFIED, removedAll: true };
  }

  const set: Partial<typeof appointments.$inferInsert> = { sequence: existing.sequence + 1, updatedAt: new Date() };
  if (target.scope === "this") {
    set.recurrenceExceptions = [...(existing.recurrenceExceptions ?? []), occurrence.toISOString()];
  } else {
    set.recurrenceRule = ruleEndingBefore(existing, occurrence, timeZone);
  }
  await db.update(appointments).set(set).where(eq(appointments.id, id));
  revalidatePath("/dashboard/calendar");

  const inviteStatus =
    notify && existing.status === "scheduled" ? await dispatchInvites(id, "REQUEST", { isUpdate: true }) : NOT_NOTIFIED;
  return { inviteStatus, removedAll: false };
}

/** Occurrences edited on their own, which go wherever their series goes. */
async function detachedFrom(db: Db, id: string) {
  return db
    .select({ id: appointments.id, status: appointments.status, endAt: appointments.endAt })
    .from(appointments)
    .where(eq(appointments.recurrenceParentId, id));
}

// ─── Cancel ───────────────────────────────────────────────────────────────────

export async function cancelAppointment(
  id: string,
  options: { notifyAttendees?: boolean; target?: OccurrenceTarget } = {},
) {
  await requireWriteAccess();
  const db = await getDb();
  const notify = options.notifyAttendees !== false;

  if (options.target && options.target.scope !== "all") {
    const result = await removeOccurrences(id, options.target, notify);
    if (!result.removedAll) return { inviteStatus: result.inviteStatus };
  }

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

  const statuses: InviteResult[] = [notify ? await dispatchInvites(id, "CANCEL") : NOT_NOTIFIED];
  for (const child of await detachedFrom(db, id)) {
    if (child.status !== "scheduled") continue;
    await db
      .update(appointments)
      .set({ status: "cancelled", sequence: sql`${appointments.sequence} + 1`, updatedAt: new Date() })
      .where(eq(appointments.id, child.id));
    if (notify && child.endAt > new Date()) statuses.push(await dispatchInvites(child.id, "CANCEL"));
  }

  revalidatePath("/dashboard/calendar");
  await mirrorLater(id);
  return { inviteStatus: sumInvites(...statuses) };
}

/** Puts a cancelled appointment back on the calendar, and says so to whoever was invited. */
export async function restoreAppointment(id: string, options: { notifyAttendees?: boolean } = {}) {
  await requireWriteAccess();
  const db = await getDb();
  const [existing] = await db
    .select({ sequence: appointments.sequence, status: appointments.status })
    .from(appointments)
    .where(eq(appointments.id, id));
  if (!existing || existing.status !== "cancelled") return { inviteStatus: NOT_NOTIFIED };

  await db
    .update(appointments)
    .set({ status: "scheduled", sequence: existing.sequence + 1, updatedAt: new Date(), reminderSentFor: null })
    .where(eq(appointments.id, id));
  revalidatePath("/dashboard/calendar");
  const inviteStatus =
    options.notifyAttendees === false ? NOT_NOTIFIED : await dispatchInvites(id, "REQUEST", { isUpdate: true });
  await mirrorLater(id);
  return { inviteStatus };
}

/** Sends the invitation again, as it stands, to everybody on it. */
export async function resendInvitations(id: string) {
  await requireWriteAccess();
  return { inviteStatus: await dispatchInvites(id, "REQUEST", { isUpdate: true }) };
}

// ─── Delete ───────────────────────────────────────────────────────────────────

/**
 * Removes an appointment for good.
 *
 * ⚠️ Deleting one nobody was told about would leave it in every invitee's own
 * calendar, where it would stay forever. The cancellation has to be built from
 * rows that still exist, so it goes out first.
 */
export async function deleteAppointment(
  id: string,
  options: { notifyAttendees?: boolean; target?: OccurrenceTarget } = {},
) {
  await requireCapability("record:delete");
  const db = await getDb();
  const notify = options.notifyAttendees !== false;

  if (options.target && options.target.scope !== "all") {
    const result = await removeOccurrences(id, options.target, notify);
    if (!result.removedAll) return { inviteStatus: result.inviteStatus };
  }

  const [existing] = await db
    .select({
      status: appointments.status,
      sequence: appointments.sequence,
      endAt: appointments.endAt,
      recurrenceRule: appointments.recurrenceRule,
    })
    .from(appointments)
    .where(eq(appointments.id, id));
  if (!existing) return { inviteStatus: NOT_NOTIFIED };

  const statuses: InviteResult[] = [];
  const children = await detachedFrom(db, id);
  for (const target of [{ id, ...existing }, ...children.map((c) => ({ ...c, recurrenceRule: null, sequence: 0 }))]) {
    // A series is still ahead while it has not ended, which its first end does not say.
    const stillAhead = target.status === "scheduled" && (Boolean(target.recurrenceRule) || target.endAt > new Date());
    if (stillAhead && notify) {
      // RFC 5545 §3.7.4: the cancellation must carry a newer sequence to win.
      await db
        .update(appointments)
        .set({ sequence: sql`${appointments.sequence} + 1` })
        .where(eq(appointments.id, target.id));
      statuses.push(await dispatchInvites(target.id, "CANCEL"));
    }
  }

  const ids = [id, ...children.map((c) => c.id)];
  await db.delete(appointments).where(inArray(appointments.id, ids));
  revalidatePath("/dashboard/calendar");
  await mirrorLater(...ids);
  return { inviteStatus: sumInvites(...statuses) };
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

/**
 * Records an answer given some other way — on the phone, in a reply that did not
 * use the links. The organiser's own row is theirs and is not changed here.
 */
export async function setAttendeeStatus(attendeeId: string, status: "accepted" | "declined" | "tentative" | "pending") {
  await requireWriteAccess();
  if (!["accepted", "declined", "tentative", "pending"].includes(status)) throw new Error("Unknown status");
  const db = await getDb();
  await db
    .update(appointmentAttendees)
    .set({ status, responseAt: status === "pending" ? null : new Date() })
    .where(and(eq(appointmentAttendees.id, attendeeId), ne(appointmentAttendees.role, "organizer")));
  revalidatePath("/dashboard/calendar");
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/** What each occurrence is expanded against when a caller names no window. */
const DEFAULT_WINDOW_DAYS = 366;

function windowOrDefault(range?: { start: Date; end: Date }) {
  if (range) return range;
  const now = Date.now();
  return {
    start: new Date(now - DEFAULT_WINDOW_DAYS * 86_400_000),
    end: new Date(now + DEFAULT_WINDOW_DAYS * 86_400_000),
  };
}

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
      timezone: appointments.timezone,
      allDay: appointments.allDay,
      recurrenceRule: appointments.recurrenceRule,
      recurrenceExceptions: appointments.recurrenceExceptions,
      location: appointments.location,
      conferenceLink: appointments.conferenceLink,
      status: appointments.status,
      icalUid: appointments.icalUid,
      organizerId: appointments.organizerId,
      attendeeCount:
        sql<number>`(select count(*) from ${appointmentAttendees} where ${appointmentAttendees.appointmentId} = ${appointments.id} and ${appointmentAttendees.role} <> 'organizer')`.mapWith(
          Number,
        ),
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
    .where(and(userFilter, range ? inWindow(range) : undefined));

  return rows;
}

export type AppointmentLink = {
  type: "contact" | "company" | "deal" | "lead";
  id: string;
  label: string;
};

export async function getAppointmentById(id: string) {
  await requireCapability("record:read");
  const db = await getDb();
  const [row] = await db
    .select({
      appt: appointments,
      organizerName: users.name,
      organizerEmail: users.email,
      contactFirst: contacts.firstName,
      contactLast: contacts.lastName,
      companyName: companies.name,
      dealName: deals.name,
      leadFirst: leads.firstName,
      leadLast: leads.lastName,
    })
    .from(appointments)
    .leftJoin(users, eq(appointments.organizerId, users.id))
    .leftJoin(contacts, eq(appointments.contactId, contacts.id))
    .leftJoin(companies, eq(appointments.companyId, companies.id))
    .leftJoin(deals, eq(appointments.dealId, deals.id))
    .leftJoin(leads, eq(appointments.leadId, leads.id))
    .where(eq(appointments.id, id));

  if (!row) return null;
  const appt = row.appt;

  const attendees = await db.select().from(appointmentAttendees).where(eq(appointmentAttendees.appointmentId, id));

  const fullName = (first: string | null, last: string | null) => `${first ?? ""} ${last ?? ""}`.trim();
  // The form links one record; an older row carrying several shows the most
  // specific.
  const link: AppointmentLink | null = appt.contactId
    ? { type: "contact", id: appt.contactId, label: fullName(row.contactFirst, row.contactLast) }
    : appt.leadId
      ? { type: "lead", id: appt.leadId, label: fullName(row.leadFirst, row.leadLast) }
      : appt.dealId
        ? { type: "deal", id: appt.dealId, label: row.dealName ?? "" }
        : appt.companyId
          ? { type: "company", id: appt.companyId, label: row.companyName ?? "" }
          : null;

  return {
    ...appt,
    timezone: safeTimeZone(appt.timezone, await getWorkspaceTimeZone()),
    attendees,
    organizer: appt.organizerId ? { name: row.organizerName, email: row.organizerEmail } : null,
    link,
  };
}

/** When an appointment starts, so a link to it can open the right week. */
export async function getAppointmentStart(id: string): Promise<Date | null> {
  await requireCapability("record:read");
  const db = await getDb();
  const [row] = await db.select({ startAt: appointments.startAt }).from(appointments).where(eq(appointments.id, id));
  return row?.startAt ?? null;
}

/**
 * Appointments overlapping [start, end], for the conflict warning: occurrences
 * of a series included, all-day ones not — a day marked "offsite" is not a
 * clash with a meeting in it, and every calendar treats it that way.
 */
export async function getOverlappingAppointments(startAt: Date, endAt: Date, excludeId?: string) {
  await requireCapability("record:read");
  const db = await getDb();
  const range = { start: startAt, end: endAt };
  const rows = await db
    .select({
      id: appointments.id,
      title: appointments.title,
      startAt: appointments.startAt,
      endAt: appointments.endAt,
      timezone: appointments.timezone,
      recurrenceRule: appointments.recurrenceRule,
      recurrenceExceptions: appointments.recurrenceExceptions,
    })
    .from(appointments)
    .where(
      and(
        ne(appointments.status, "cancelled"),
        eq(appointments.allDay, false),
        ...(excludeId ? [ne(appointments.id, excludeId)] : []),
        inWindow(range),
      ),
    );
  const zone = await getWorkspaceTimeZone();
  return rows
    .filter((r) => occurrencesOf(r, range, zone).some((o) => o.startAt < endAt && o.endAt > startAt))
    .map((r) => ({ id: r.id, title: r.title }));
}

// For calendar action — returns formatted events, one per occurrence
export async function getAppointmentCalendarEvents(
  filterUserIds?: string[] | null,
  range?: { start: Date; end: Date },
) {
  await requireCapability("record:read");
  const span = windowOrDefault(range);
  // ⚠️ The home page and the calendar both read this. A workspace whose database
  // is behind the deployed code (a migration not yet applied) shows no
  // appointments for a moment rather than a page that does not load at all.
  const rows = await tolerateUnmigrated(
    "Appointments (repeating and all-day)",
    () => getAppointments(filterUserIds, span),
    [] as Awaited<ReturnType<typeof getAppointments>>,
  );
  const zone = await getWorkspaceTimeZone();

  return rows
    .filter((r) => r.status !== "cancelled")
    .flatMap((r) =>
      occurrencesOf(r, span, zone).map((o) => ({
        id: o.occurrence ? `${r.id}:${o.occurrence}` : r.id,
        appointmentId: r.id,
        occurrence: o.occurrence,
        recurring: Boolean(r.recurrenceRule),
        attendeeCount: r.attendeeCount,
        allDay: r.allDay,
        title: r.title,
        date: o.startAt,
        endAt: o.endAt,
        type: "appointment" as const,
        status: r.status,
        priority: "normal" as const,
        displayTitle: r.title.length > 50 ? `${r.title.slice(0, 50)}…` : r.title,
        entityName: r.contactName
          ? `${r.contactName} ${r.contactLastName ?? ""}`.trim()
          : (r.companyName ??
            r.dealName ??
            (r.leadName ? `${r.leadName} ${r.leadLastName ?? ""}`.trim() : "No Entity")),
        link: `/dashboard/calendar?appointment=${r.id}${o.occurrence ? `&occurrence=${encodeURIComponent(o.occurrence)}` : ""}`,
        location: r.location,
        conferenceLink: r.conferenceLink,
      })),
    );
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

export type { BusySlot };

/**
 * Who is busy when on one day, on the workspace's clock (src/lib/availability.ts).
 *
 * ⚠️ The day used to be cut with `setHours(0)` on the server, which on Workers
 * is midnight UTC: the morning of the day asked for was missing and the first
 * hours of the next were in it.
 */
export async function getColleagueAvailability(userIds: string[], day: string): Promise<Record<string, BusySlot[]>> {
  await requireCapability("record:read");
  if (userIds.length === 0) return {};
  const db = await getDb();
  const zone = await getWorkspaceTimeZone();
  const dayStart = fromWallValue(day, zone);
  const dayEnd = fromWallValue(addDaysToDate(day, 1), zone);
  if (!dayStart || !dayEnd) return {};
  return busyByUser(db, userIds, { start: dayStart, end: dayEnd }, zone);
}
