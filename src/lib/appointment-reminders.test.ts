/**
 * The reminder set on an appointment.
 *
 * Two failures matter and both are silent from the inside: a reminder that
 * rings twice (a phone buzzing every ten minutes until the meeting, which is how
 * a person turns notifications off for good), and one that never rings again
 * after the meeting moved or the series moved on to its next occurrence.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";
import { appointmentAttendees, appointments, users } from "@/db/schema";

const sent: { userId: string; link?: string }[] = [];
vi.mock("server-only", () => ({}));
vi.mock("@/lib/notify", () => ({
  notifyMany: async (rows: { userId: string; link?: string }[]) => {
    sent.push(...rows);
  },
}));

const { sendDueAppointmentReminders } = await import("./appointment-reminders");

const db = drizzle(new PGlite());
const run = (now: Date) => sendDueAppointmentReminders(db as never, now, "Europe/Rome");
const MIN = 60_000;

beforeAll(async () => {
  await applyTenantMigrations(db as never);
  await db.insert(users).values([
    { id: "anna", email: "anna@example.com", name: "Anna" },
    { id: "bruno", email: "bruno@example.com", name: "Bruno" },
    { id: "carla", email: "carla@example.com", name: "Carla" },
  ]);
  // Every migration applied in-process: under a full parallel run this outlasts the 10s default.
}, 120_000);

beforeEach(async () => {
  sent.length = 0;
  await db.execute(sql`delete from appointment`);
});

async function appointment(values: Partial<typeof appointments.$inferInsert> & { startAt: Date }) {
  const id = crypto.randomUUID();
  await db.insert(appointments).values({
    id,
    title: "Kickoff",
    endAt: new Date(values.startAt.getTime() + 60 * MIN),
    icalUid: `${id}@test`,
    organizerId: "anna",
    reminderMinutes: 30,
    timezone: "Europe/Rome",
    ...values,
  });
  return id;
}

describe("a single appointment", () => {
  it("reminds the organiser and the colleagues going, once", async () => {
    const start = new Date("2026-10-05T08:00:00Z");
    const id = await appointment({ startAt: start });
    await db.insert(appointmentAttendees).values([
      { appointmentId: id, userId: "bruno", email: "bruno@example.com", name: "Bruno", status: "accepted" },
      { appointmentId: id, userId: "carla", email: "carla@example.com", name: "Carla", status: "declined" },
      { appointmentId: id, email: "guest@example.com", name: "Guest" },
    ]);

    expect(await run(new Date(start.getTime() - 45 * MIN))).toBe(0);
    expect(await run(new Date(start.getTime() - 25 * MIN))).toBe(2);
    expect(sent.map((s) => s.userId).sort()).toEqual(["anna", "bruno"]);
    // ⚠️ The job runs again ten minutes later, and must stay quiet.
    expect(await run(new Date(start.getTime() - 15 * MIN))).toBe(0);
  });

  it("⚠️ rings again once the appointment has moved", async () => {
    const start = new Date("2026-10-05T08:00:00Z");
    const id = await appointment({ startAt: start });
    expect(await run(new Date(start.getTime() - 20 * MIN))).toBe(1);

    const moved = new Date(start.getTime() + 3 * 60 * MIN);
    await db
      .update(appointments)
      .set({ startAt: moved, endAt: new Date(moved.getTime() + 60 * MIN) })
      .where(sql`id = ${id}`);
    expect(await run(new Date(moved.getTime() - 20 * MIN))).toBe(1);
  });

  it("stays quiet for one already started, cancelled, or without a reminder", async () => {
    const start = new Date("2026-10-05T08:00:00Z");
    await appointment({ startAt: start });
    await appointment({ startAt: new Date(start.getTime() + 10 * MIN), status: "cancelled" });
    await appointment({ startAt: new Date(start.getTime() + 10 * MIN), reminderMinutes: null });
    expect(await run(new Date(start.getTime() + 5 * MIN))).toBe(0);
  });
});

describe("a series", () => {
  it("⚠️ reminds before every occurrence, each once", async () => {
    const first = new Date("2026-10-05T08:00:00Z"); // Monday, 10:00 in Rome
    await appointment({ startAt: first, recurrenceRule: "FREQ=WEEKLY" });

    expect(await run(new Date(first.getTime() - 20 * MIN))).toBe(1);
    expect(await run(new Date(first.getTime() - 10 * MIN))).toBe(0);

    const second = new Date(first.getTime() + 7 * 24 * 60 * MIN);
    expect(await run(new Date(second.getTime() - 20 * MIN))).toBe(1);
    expect(sent[1].link).toContain(encodeURIComponent(second.toISOString()));
    expect(await run(new Date(second.getTime() - 5 * MIN))).toBe(0);
  });

  it("skips an occurrence removed from the series", async () => {
    const first = new Date("2026-10-05T08:00:00Z");
    const second = new Date(first.getTime() + 7 * 24 * 60 * MIN);
    await appointment({
      startAt: first,
      recurrenceRule: "FREQ=WEEKLY",
      recurrenceExceptions: [second.toISOString()],
    });
    expect(await run(new Date(second.getTime() - 20 * MIN))).toBe(0);
  });

  it("stops when the series has ended", async () => {
    const first = new Date("2026-10-05T08:00:00Z");
    await appointment({ startAt: first, recurrenceRule: "FREQ=WEEKLY;COUNT=1" });
    const second = new Date(first.getTime() + 7 * 24 * 60 * MIN);
    expect(await run(new Date(second.getTime() - 20 * MIN))).toBe(0);
  });
});
