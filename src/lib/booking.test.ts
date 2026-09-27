/**
 * The public booking link, against a real Postgres: what is offered, and what a visitor
 * can take.
 *
 * ⚠️⚠️ The slot offered and the slot booked are one computation, over the busy time the
 * colleague picker reads; two visitors on one slot are one appointment, because the
 * insert decides.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";

import { bookableSlots, MIN_NOTICE_MINUTES } from "./availability";
import {
  type BookingLink,
  bookSlot,
  cleanBookingSettings,
  ensureBookingLink,
  openSlots,
  saveBookingSettings,
} from "./booking";

const ROME = "Europe/Rome";
// Monday 28 September 2026, 08:00 in Rome.
const NOW = new Date("2026-09-28T06:00:00Z");
const at = (wall: string) => new Date(`${wall}:00+02:00`);

const WINDOW = {
  durationMinutes: 60,
  daysAhead: 7,
  dayStart: "09:00",
  dayEnd: "12:00",
  weekdays: "12345",
  bufferMinutes: 0,
};

describe("⚠️⚠️ the slots offered", () => {
  it("are on the workspace's clock, on the chosen weekdays, inside the hours", () => {
    const slots = bookableSlots(WINDOW, [], NOW, ROME);
    // Monday: 09:00 is inside the two hours' notice from 08:00, so 10:00 and 11:00.
    expect(slots.slice(0, 2)).toEqual([at("2026-09-28T10:00"), at("2026-09-28T11:00")]);
    // No Saturday or Sunday (3 and 4 October).
    expect(
      slots.some((s) => s.toISOString().startsWith("2026-10-03") || s.toISOString().startsWith("2026-10-04")),
    ).toBe(false);
    // The last start leaves room for the whole meeting before 12:00.
    expect(slots.every((s) => s.getUTCHours() + 2 < 12)).toBe(true);
  });

  it("⚠️ leave out what is busy, with the buffer on either side", () => {
    const busy = [{ startAt: at("2026-09-29T10:00"), endAt: at("2026-09-29T10:30"), title: "x" }];
    const tuesday = (w: typeof WINDOW) =>
      bookableSlots(w, busy, NOW, ROME).filter((s) => s.toISOString().startsWith("2026-09-29"));
    expect(tuesday(WINDOW)).toEqual([at("2026-09-29T09:00"), at("2026-09-29T11:00")]);
    // Fifteen minutes each side: 09:00–10:00 now touches 09:45, 11:00 starts after 10:45.
    expect(tuesday({ ...WINDOW, bufferMinutes: 15 })).toEqual([at("2026-09-29T11:00")]);
  });

  it("never start sooner than the notice", () => {
    expect(bookableSlots(WINDOW, [], NOW, ROME)[0].getTime()).toBeGreaterThanOrEqual(
      NOW.getTime() + MIN_NOTICE_MINUTES * 60_000,
    );
  });

  it("settings that make no day are refused", () => {
    expect(cleanBookingSettings({ ...WINDOW, dayStart: "18:00", dayEnd: "09:00" })).toBeNull();
    expect(cleanBookingSettings({ ...WINDOW, durationMinutes: 50 })).toBeNull();
    expect(cleanBookingSettings({ ...WINDOW, weekdays: "89" })).toBeNull();
    expect(cleanBookingSettings({ ...WINDOW, weekdays: "5,1,1" })?.weekdays).toBe("15");
  });
});

const db = drizzle(new PGlite());
let link: BookingLink;

describe("⚠️⚠️ booking", () => {
  beforeAll(async () => {
    await applyTenantMigrations(db as never);
  }, 120_000);

  beforeEach(async () => {
    for (const t of ["appointment_attendee", "appointment", "contact", "lead", "booking_link"]) {
      await db.execute(sql.raw(`delete from "${t}"`));
    }
    await db.execute(sql`delete from "user"`);
    await db.execute(sql`insert into "user" (id, name, email) values ('anna', 'Anna', 'anna@firm.it')`);
    await ensureBookingLink(db, "anna");
    const settings = cleanBookingSettings({ ...WINDOW, enabled: true, title: "Consulenza" });
    if (!settings) throw new Error("settings");
    link = await saveBookingSettings(db, "anna", settings);
  });

  const book = (start: Date, email = "mario@example.com", name = "Mario Rossi") =>
    bookSlot(db, link, { start, visitor: { name, email }, zone: ROME, defaultTitle: "Meeting" }, NOW);

  async function rows(table: string) {
    return (await db.execute(sql.raw(`select * from "${table}"`))).rows as Record<string, unknown>[];
  }

  it("a free slot becomes the owner's appointment, and a stranger a lead the owner owns", async () => {
    const result = await book(at("2026-09-29T09:00"));
    expect(result).toMatchObject({ ok: true, contactId: null });
    const [appointment] = await rows("appointment");
    expect(appointment).toMatchObject({
      organizer_id: "anna",
      title: "Consulenza: Mario Rossi",
      booked_via: "link",
      status: "scheduled",
    });
    expect(await rows("lead")).toEqual([
      expect.objectContaining({
        email: "mario@example.com",
        source: "booking",
        owner_id: "anna",
        marketing_consent: false,
      }),
    ]);
    expect((await rows("appointment_attendee")).map((a) => [a.email, a.role])).toEqual(
      expect.arrayContaining([
        ["anna@firm.it", "organizer"],
        ["mario@example.com", "required"],
      ]),
    );
  });

  it("⚠️ somebody already known is filed as who they are — no duplicate lead", async () => {
    await db.execute(
      sql`insert into contact (id, first_name, last_name, email) values ('c1', 'Mario', 'Rossi', 'Mario@Example.com')`,
    );
    const result = await book(at("2026-09-29T09:00"));
    expect(result).toMatchObject({ ok: true, contactId: "c1", leadId: null });
    expect(await rows("lead")).toEqual([]);
  });

  it("⚠️⚠️ the slot just taken is not offered again, and a second visitor on it is refused", async () => {
    const slot = at("2026-09-29T09:00");
    expect((await book(slot)).ok).toBe(true);
    expect((await openSlots(db, link, ROME, NOW)).some((s) => s.getTime() === slot.getTime())).toBe(false);
    expect(await book(slot, "luca@example.com", "Luca")).toEqual({ ok: false, reason: "taken" });
    expect(await rows("appointment")).toHaveLength(1);
  });

  it("⚠️⚠️ two visitors at the same moment: both saw the slot free, one of them gets it", async () => {
    const slot = at("2026-09-29T10:00");
    const results = await Promise.all([book(slot), book(slot, "luca@example.com", "Luca")]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, reason: "taken" }]);
    expect(await rows("appointment")).toHaveLength(1);
  });

  it("⚠️ a start that was never offered is refused, not written on top of something", async () => {
    // Saturday, and a time outside the hours.
    expect(await book(at("2026-10-03T10:00"))).toEqual({ ok: false, reason: "taken" });
    expect(await book(at("2026-09-29T15:00"))).toEqual({ ok: false, reason: "taken" });
    expect(await rows("appointment")).toEqual([]);
  });

  it("a closed link offers nothing and books nothing", async () => {
    const closed = cleanBookingSettings({ ...WINDOW, enabled: false });
    if (!closed) throw new Error("settings");
    link = await saveBookingSettings(db, "anna", closed);
    expect(await openSlots(db, link, ROME, NOW)).toEqual([]);
    expect(await book(at("2026-09-29T09:00"))).toEqual({ ok: false, reason: "closed" });
  });
});
