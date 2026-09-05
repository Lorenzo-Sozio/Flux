/**
 * Minutes, assembled from what was written down.
 *
 * On the tested surface because the output is a document that gets filed and
 * quoted back. Minutes that name the wrong attendee, or list a task from a
 * different week as something "agreed", are wrong in a way nobody checks —
 * everybody assumes the software read the record correctly.
 */
import { describe, expect, it } from "vitest";

import {
  buildMinutes,
  type MinutesActivity,
  type MinutesTask,
  splitParticipants,
  windowAround,
} from "./meeting-minutes";

const day = (iso: string) => new Date(`2026-09-${iso}`);
const WINDOW = { from: day("10T00:00:00Z"), to: day("11T23:59:59Z") };

let seq = 0;
const activity = (over: Partial<MinutesActivity> = {}): MinutesActivity => ({
  id: `a${seq++}`,
  type: "meeting",
  content: "Discussed the renewal",
  date: day("10T14:00:00Z"),
  durationMinutes: 45,
  participants: "Anna Rossi, Marco Bianchi",
  ownerName: "Anna",
  ...over,
});

const task = (over: Partial<MinutesTask> = {}): MinutesTask => ({
  id: `t${seq++}`,
  title: "Send the revised quote",
  ownerName: "Anna",
  dueDate: day("15T00:00:00Z"),
  createdAt: day("10T15:00:00Z"),
  status: "todo",
  ...over,
});

describe("buildMinutes", () => {
  it("⚠️ refuses to produce minutes when nobody met", () => {
    // A document of empty headings implies a meeting took place. Notes on their
    // own are not a meeting, and neither is an email.
    expect(buildMinutes([activity({ type: "note" }), activity({ type: "email" })], [], WINDOW)).toBeNull();
    expect(buildMinutes([], [], WINDOW)).toBeNull();
  });

  it("counts a call as a session, not just a meeting", () => {
    const m = buildMinutes([activity({ type: "call", durationMinutes: 20 })], [], WINDOW);
    expect(m?.sessions).toHaveLength(1);
    expect(m?.sessions[0].kind).toBe("call");
  });

  it("⚠️ leaves out anything outside the window", () => {
    // A task from a different week listed as agreed here is a fabrication that
    // reads exactly like a record.
    const m = buildMinutes(
      [activity(), activity({ date: day("20T14:00:00Z") })],
      [task(), task({ createdAt: day("20T09:00:00Z"), title: "Unrelated" })],
      WINDOW,
    );
    expect(m?.sessions).toHaveLength(1);
    expect(m?.agreed.map((t) => t.title)).toEqual(["Send the revised quote"]);
  });

  it("puts the sessions in the order they happened", () => {
    const m = buildMinutes(
      [activity({ id: "late", date: day("11T09:00:00Z") }), activity({ id: "early", date: day("10T09:00:00Z") })],
      [],
      WINDOW,
    );
    expect(m?.sessions.map((s) => s.id)).toEqual(["early", "late"]);
  });

  it("⚠️ quotes the note as written and never invents one", () => {
    const m = buildMinutes([activity({ content: "Agreed a 5% discount on renewal" })], [], WINDOW);
    expect(m?.sessions[0].notes).toBe("Agreed a 5% discount on renewal");
  });

  it("says nothing rather than something when the note is empty", () => {
    for (const content of [null, "", "   "]) {
      expect(buildMinutes([activity({ content })], [], WINDOW)?.sessions[0].notes, String(content)).toBeNull();
    }
  });

  it("gathers everyone named, without repeating them", () => {
    const m = buildMinutes(
      [
        activity({ participants: "Anna Rossi, Marco Bianchi" }),
        activity({ date: day("11T10:00:00Z"), participants: "anna rossi; Giulia Verdi" }),
      ],
      [],
      WINDOW,
    );
    expect(m?.attendees).toEqual(["Anna Rossi", "Marco Bianchi", "Giulia Verdi"]);
  });

  it("adds up the time spent", () => {
    const m = buildMinutes(
      [activity({ durationMinutes: 45 }), activity({ date: day("11T10:00:00Z"), durationMinutes: 30 })],
      [],
      WINDOW,
    );
    expect(m?.totalMinutes).toBe(75);
  });

  it("survives a session with no duration recorded", () => {
    const m = buildMinutes([activity({ durationMinutes: null })], [], WINDOW);
    expect(m?.totalMinutes).toBe(0);
  });

  it("keeps notes and emails as context, separate from the sessions", () => {
    const m = buildMinutes(
      [activity(), activity({ type: "note", date: day("10T16:00:00Z"), content: "Rang to confirm" })],
      [],
      WINDOW,
    );
    expect(m?.sessions).toHaveLength(1);
    expect(m?.context.map((c) => c.text)).toEqual(["Rang to confirm"]);
  });

  it("⚠️ lists what was agreed from the tasks, not from the prose", () => {
    // The only record of a decision this product holds is a task somebody
    // raised. Reading decisions out of a free-text note would be guesswork.
    const m = buildMinutes(
      [activity({ content: "We should probably renew" })],
      [task({ title: "Draft renewal" })],
      WINDOW,
    );
    expect(m?.agreed.map((t) => t.title)).toEqual(["Draft renewal"]);
  });

  it("ignores an activity with no date at all", () => {
    expect(buildMinutes([activity({ date: null })], [], WINDOW)).toBeNull();
  });
});

describe("splitParticipants", () => {
  it("splits on commas and semicolons and trims", () => {
    expect(splitParticipants("Anna Rossi,  Marco Bianchi ; Giulia")).toEqual(["Anna Rossi", "Marco Bianchi", "Giulia"]);
  });

  it("is empty for nothing", () => {
    expect(splitParticipants(null)).toEqual([]);
    expect(splitParticipants("  ,  ; ")).toEqual([]);
  });
});

describe("windowAround", () => {
  it("⚠️ reaches past the meeting, because the note is written afterwards", () => {
    // The note gets typed after the meeting, the tasks are raised in the hour
    // after that, and the follow-up goes the same day. A window closing when the
    // meeting ends produces minutes with nothing agreed in them.
    const w = windowAround(new Date("2026-09-10T16:30:00"));
    expect(w.from.getHours()).toBe(0);
    expect(w.to.getDate()).toBe(11);
    expect(w.to.getHours()).toBe(23);
  });

  it("covers the meeting's own day from its start", () => {
    const at = new Date("2026-09-10T16:30:00");
    const w = windowAround(at);
    expect(w.from <= at).toBe(true);
    expect(w.to >= at).toBe(true);
  });
});
