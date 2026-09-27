/**
 * The appointment actions, against a real Postgres.
 *
 * What is checked here is what only a database run can answer, and what fails
 * as a plausible calendar rather than as an error:
 *
 *  1. a change to one occurrence of a series must leave the others where they
 *     were, and the one changed must appear once — not twice, not missing;
 *  2. a change to the whole series made from its third occurrence must move
 *     every occurrence by the same amount, and the dates removed from it with
 *     them, or a cancelled Tuesday comes back as a Wednesday;
 *  3. "this and following" must not change how many meetings there are in all;
 *  4. deleting a series must take the occurrences edited on their own with it;
 *  5. the conflict warning and colleagues' availability must see a series, not
 *     only its first date, and read a day on the workspace's clock.
 *
 * The guards and the email provider are mocked away: `permissions.test.ts` owns
 * who may do this, and with no provider configured no invitation is attempted.
 */
import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";
import { appointmentAttendees, appointments, users } from "@/db/schema";
import { fromWallValue, toWallValue } from "@/lib/wall-clock";

const TZ = "Europe/Rome";
const pg = drizzle(new PGlite());
// The Neon driver's `batch` is one transaction; statement by statement is enough here.
const db = Object.assign(pg, {
  batch: async (queries: unknown[]) => {
    const out: unknown[] = [];
    for (const q of queries) out.push(await q);
    return out;
  },
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/tenant-context", () => ({ getDb: async () => db, getCurrentTenantId: async () => "t1" }));
vi.mock("@/lib/auth-guard", () => ({
  requireCapability: async () => ({ userId: "anna", tenantRole: "admin" }),
  requireWriteAccess: async () => ({ userId: "anna", tenantRole: "admin" }),
}));
vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "anna" } }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/email-provider", () => ({ getEmailConfig: async () => ({ provider: "none" }) }));
vi.mock("@/lib/email", () => ({ sendAppointmentInviteEmail: async () => ({ success: true }) }));
vi.mock("@/lib/tenant-resolve", () => ({ resolveTenantByProbe: async () => null }));
vi.mock("@/lib/workspace-time-zone", () => ({ getWorkspaceTimeZone: async () => TZ }));

const {
  cancelAppointment,
  createAppointment,
  deleteAppointment,
  getAppointmentCalendarEvents,
  getColleagueAvailability,
  getOverlappingAppointments,
  restoreAppointment,
  updateAppointment,
} = await import("./appointments");

const at = (wall: string) => fromWallValue(wall, TZ) as Date;
const wall = (d: Date | string) => toWallValue(new Date(d), TZ);
const OCTOBER = { start: at("2026-10-01T00:00"), end: at("2026-11-30T00:00") };

async function shown() {
  const events = await getAppointmentCalendarEvents(null, OCTOBER);
  return events.map((e) => `${wall(e.date)} ${e.title}`).sort();
}

async function weekly(count?: number) {
  return createAppointment({
    title: "Sync",
    startAt: at("2026-10-05T10:00"), // Monday
    endAt: at("2026-10-05T11:00"),
    recurrenceRule: `FREQ=WEEKLY${count ? `;COUNT=${count}` : ""}`,
    attendees: [{ email: "bruno@example.com", name: "Bruno", userId: "bruno" }],
  });
}

beforeAll(async () => {
  await applyTenantMigrations(pg as never);
  await pg.insert(users).values([
    { id: "anna", email: "anna@example.com", name: "Anna" },
    { id: "bruno", email: "bruno@example.com", name: "Bruno" },
  ]);
}, 120_000);

beforeEach(async () => {
  await pg.execute(sql`delete from appointment`);
});

describe("a single appointment", () => {
  it("is created on the workspace's clock, with its organiser and guests", async () => {
    const appt = await createAppointment({
      title: "Kickoff",
      startAt: at("2026-10-05T10:00"),
      endAt: at("2026-10-05T11:00"),
      attendees: [{ email: "guest@example.com", name: "Guest" }],
    });
    expect(appt.timezone).toBe(TZ);
    const people = await pg.select().from(appointmentAttendees).where(eq(appointmentAttendees.appointmentId, appt.id));
    expect(people.map((p) => p.role).sort()).toEqual(["organizer", "required"]);
    expect(await shown()).toEqual(["2026-10-05T10:00 Kickoff"]);
  });

  it("refuses an end before the start, and a rule it cannot expand", async () => {
    await expect(
      createAppointment({ title: "x", startAt: at("2026-10-05T10:00"), endAt: at("2026-10-05T09:00"), attendees: [] }),
    ).rejects.toThrow();
    await expect(
      createAppointment({
        title: "x",
        startAt: at("2026-10-05T10:00"),
        endAt: at("2026-10-05T11:00"),
        recurrenceRule: "FREQ=HOURLY",
        attendees: [],
      }),
    ).rejects.toThrow();
  });

  it("⚠️ asks again when the time changes, and keeps answers when it does not", async () => {
    const appt = await createAppointment({
      title: "Kickoff",
      startAt: at("2026-10-05T10:00"),
      endAt: at("2026-10-05T11:00"),
      attendees: [{ email: "guest@example.com", name: "Guest" }],
    });
    await pg.update(appointmentAttendees).set({ status: "accepted" }).where(eq(appointmentAttendees.role, "required"));
    await updateAppointment(appt.id, { title: "Kickoff, renamed" });
    const [kept] = await pg.select().from(appointmentAttendees).where(eq(appointmentAttendees.role, "required"));
    expect(kept.status).toBe("accepted");

    await updateAppointment(appt.id, { startAt: at("2026-10-06T10:00"), endAt: at("2026-10-06T11:00") });
    const [asked] = await pg.select().from(appointmentAttendees).where(eq(appointmentAttendees.role, "required"));
    expect(asked.status).toBe("pending");
  });

  it("is cancelled, hidden, and restored", async () => {
    const appt = await createAppointment({
      title: "Kickoff",
      startAt: at("2026-10-05T10:00"),
      endAt: at("2026-10-05T11:00"),
      attendees: [],
    });
    await cancelAppointment(appt.id);
    expect(await shown()).toEqual([]);
    await restoreAppointment(appt.id);
    expect(await shown()).toEqual(["2026-10-05T10:00 Kickoff"]);
  });
});

describe("an all-day appointment", () => {
  it("covers its days, and clashes with nothing", async () => {
    await createAppointment({
      title: "Offsite",
      allDay: true,
      startAt: at("2026-10-05"),
      endAt: at("2026-10-07"),
      attendees: [],
    });
    const [ev] = await getAppointmentCalendarEvents(null, OCTOBER);
    expect(ev.allDay).toBe(true);
    expect(await getOverlappingAppointments(at("2026-10-05T10:00"), at("2026-10-05T11:00"))).toEqual([]);
  });
});

describe("a series", () => {
  it("shows every occurrence in the window, and only those", async () => {
    await weekly(3);
    expect(await shown()).toEqual(["2026-10-05T10:00 Sync", "2026-10-12T10:00 Sync", "2026-10-19T10:00 Sync"]);
  });

  it("⚠️ changes one occurrence without touching the others", async () => {
    const series = await weekly(3);
    await updateAppointment(
      series.id,
      { title: "Sync (moved)", startAt: at("2026-10-13T15:00"), endAt: at("2026-10-13T16:00") },
      { scope: "this", occurrence: at("2026-10-12T10:00").toISOString() },
    );
    expect(await shown()).toEqual(["2026-10-05T10:00 Sync", "2026-10-13T15:00 Sync (moved)", "2026-10-19T10:00 Sync"]);
    // The copy keeps who was invited.
    const [copy] = await pg.select().from(appointments).where(eq(appointments.recurrenceParentId, series.id));
    const people = await pg.select().from(appointmentAttendees).where(eq(appointmentAttendees.appointmentId, copy.id));
    expect(people.map((p) => p.email).sort()).toEqual(["anna@example.com", "bruno@example.com"]);
  });

  it("⚠️ moves the whole series by as much as the occurrence it was edited from, exceptions included", async () => {
    const series = await weekly(4);
    await cancelAppointment(series.id, { target: { scope: "this", occurrence: at("2026-10-19T10:00").toISOString() } });
    await updateAppointment(
      series.id,
      { startAt: at("2026-10-12T11:30"), endAt: at("2026-10-12T12:00") },
      { scope: "all", occurrence: at("2026-10-12T10:00").toISOString() },
    );
    expect(await shown()).toEqual([
      "2026-10-05T11:30 Sync",
      "2026-10-12T11:30 Sync",
      // 19 October stays removed.
      "2026-10-26T11:30 Sync",
    ]);
  });

  it("⚠️ splits at an occurrence without changing how many there are in all", async () => {
    const series = await weekly(5);
    await updateAppointment(
      series.id,
      { title: "Sync v2", startAt: at("2026-10-19T09:00"), endAt: at("2026-10-19T10:00") },
      { scope: "following", occurrence: at("2026-10-19T10:00").toISOString() },
    );
    expect(await shown()).toEqual([
      "2026-10-05T10:00 Sync",
      "2026-10-12T10:00 Sync",
      "2026-10-19T09:00 Sync v2",
      "2026-10-26T09:00 Sync v2",
      "2026-11-02T09:00 Sync v2",
    ]);
  });

  it("⚠️ keeps the total when the form sends the stored rule back unchanged", async () => {
    // The form sends the rule on every save. Taken as an edit, the rest of a
    // five-meeting series restarted with five more.
    const series = await weekly(5);
    await updateAppointment(
      series.id,
      { title: "Sync v2", recurrenceRule: "FREQ=WEEKLY;COUNT=5" },
      { scope: "following", occurrence: at("2026-10-19T10:00").toISOString() },
    );
    expect(await shown()).toHaveLength(5);
  });

  it("⚠️ takes the rule to the new day when a whole series is moved to another weekday", async () => {
    const series = await createAppointment({
      title: "Sync",
      startAt: at("2026-10-06T10:00"), // Tuesday
      endAt: at("2026-10-06T11:00"),
      recurrenceRule: "FREQ=WEEKLY;BYDAY=TU;COUNT=3",
      attendees: [],
    });
    // Dragged from the second Tuesday to the Wednesday after it.
    await updateAppointment(
      series.id,
      { startAt: at("2026-10-14T10:00"), endAt: at("2026-10-14T11:00") },
      { scope: "all", occurrence: at("2026-10-13T10:00").toISOString() },
    );
    expect(await shown()).toEqual(["2026-10-07T10:00 Sync", "2026-10-14T10:00 Sync", "2026-10-21T10:00 Sync"]);
  });

  it("⚠️ moves a series by wall-clock time, not by milliseconds, across the change of hour", async () => {
    // Rome leaves summer time on 25 October. Moved an hour later from a winter
    // occurrence, the summer ones must be an hour later too — at eleven.
    const series = await weekly(4);
    await updateAppointment(
      series.id,
      { startAt: at("2026-10-26T11:00"), endAt: at("2026-10-26T12:00") },
      { scope: "all", occurrence: at("2026-10-26T10:00").toISOString() },
    );
    expect(await shown()).toEqual([
      "2026-10-05T11:00 Sync",
      "2026-10-12T11:00 Sync",
      "2026-10-19T11:00 Sync",
      "2026-10-26T11:00 Sync",
    ]);
  });

  it("ends at an occurrence when it and the following ones are removed", async () => {
    const series = await weekly();
    await deleteAppointment(series.id, {
      target: { scope: "following", occurrence: at("2026-10-19T10:00").toISOString() },
    });
    expect(await shown()).toEqual(["2026-10-05T10:00 Sync", "2026-10-12T10:00 Sync"]);
  });

  it("⚠️ takes the occurrences edited on their own with it when deleted", async () => {
    const series = await weekly(3);
    await updateAppointment(
      series.id,
      { title: "Moved" },
      { scope: "this", occurrence: at("2026-10-12T10:00").toISOString() },
    );
    await deleteAppointment(series.id, { target: { scope: "all", occurrence: at("2026-10-05T10:00").toISOString() } });
    expect(await shown()).toEqual([]);
    expect(await pg.select().from(appointments)).toEqual([]);
  });

  it("is seen by the conflict warning and by colleagues' availability", async () => {
    await weekly();
    const clash = await getOverlappingAppointments(at("2026-11-16T10:30"), at("2026-11-16T11:30"));
    expect(clash.map((c) => c.title)).toEqual(["Sync"]);

    const busy = await getColleagueAvailability(["bruno", "anna"], "2026-11-16");
    expect(busy.bruno.map((b) => wall(b.startAt))).toEqual(["2026-11-16T10:00"]);
    expect(busy.anna.map((b) => wall(b.startAt))).toEqual(["2026-11-16T10:00"]);
    expect((await getColleagueAvailability(["bruno"], "2026-11-17")).bruno).toEqual([]);
  });
});
