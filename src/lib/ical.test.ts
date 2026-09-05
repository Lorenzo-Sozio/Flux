/**
 * The calendar feed, on the wire.
 *
 * On the tested surface because of how this fails. A calendar client that
 * dislikes a feed does not report it: Google Calendar shows an empty
 * subscription, Outlook quietly keeps the last copy that parsed. Nobody is told,
 * and from inside the product everything looks correct — the appointments are
 * there, the URL responds, the page says it is connected. So the format is held
 * here rather than by looking at it.
 */
import { describe, expect, it } from "vitest";

import { type FeedEvent, generateFeedICS, generateICS } from "./ical";

const NOW = new Date("2026-09-05T09:00:00Z");

const event = (over: Partial<FeedEvent> = {}): FeedEvent => ({
  uid: "appt-1@flux",
  title: "Kickoff",
  startAt: new Date("2026-09-10T14:00:00Z"),
  endAt: new Date("2026-09-10T15:00:00Z"),
  ...over,
});

/** Unfolds the way a reader does, so assertions are about content, not layout. */
const unfold = (ics: string) => ics.replace(/\r\n /g, "");
const lines = (ics: string) => unfold(ics).split("\r\n");

describe("generateFeedICS", () => {
  it("is a calendar a reader will open", () => {
    const ics = generateFeedICS([event()], { name: "Flux", now: NOW });
    expect(lines(ics)[0]).toBe("BEGIN:VCALENDAR");
    expect(lines(ics)).toContain("VERSION:2.0");
    expect(unfold(ics)).toContain("END:VCALENDAR");
  });

  it("⚠️ publishes, and does not request", () => {
    // REQUEST asks the subscriber to RSVP to every meeting in the feed.
    const ics = generateFeedICS([event()], { name: "Flux", now: NOW });
    expect(lines(ics)).toContain("METHOD:PUBLISH");
    expect(lines(ics)).not.toContain("METHOD:REQUEST");
  });

  it("⚠️ terminates the last line, as the spec requires", () => {
    expect(generateFeedICS([event()], { name: "Flux", now: NOW }).endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("separates lines with CRLF and never a bare LF", () => {
    const ics = generateFeedICS([event()], { name: "Flux", now: NOW });
    expect(ics.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("writes times as UTC instants", () => {
    const ics = generateFeedICS([event()], { name: "Flux", now: NOW });
    expect(lines(ics)).toContain("DTSTART:20260910T140000Z");
    expect(lines(ics)).toContain("DTEND:20260910T150000Z");
  });

  it("names the calendar, so it is not filed under its URL", () => {
    const ics = generateFeedICS([], { name: "Appuntamenti", now: NOW });
    expect(unfold(ics)).toContain("X-WR-CALNAME:Appuntamenti");
  });

  it("is still a valid calendar with nothing in it", () => {
    const ics = generateFeedICS([], { name: "Flux", now: NOW });
    expect(lines(ics)[0]).toBe("BEGIN:VCALENDAR");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).not.toContain("BEGIN:VEVENT");
  });

  it("carries every appointment it was given", () => {
    const ics = generateFeedICS([event({ uid: "a" }), event({ uid: "b" })], { name: "Flux", now: NOW });
    expect(unfold(ics).match(/BEGIN:VEVENT/g)).toHaveLength(2);
  });

  it("⚠️ keeps a cancelled appointment, marked cancelled", () => {
    // Dropping it is the obvious thing and it is wrong: a subscriber that stops
    // seeing an event keeps its copy, so the meeting would stay on the calendar
    // for ever — and from here it would look cancelled.
    const ics = generateFeedICS([event({ status: "cancelled" })], { name: "Flux", now: NOW });
    expect(unfold(ics)).toContain("BEGIN:VEVENT");
    expect(lines(ics)).toContain("STATUS:CANCELLED");
  });

  it("treats a scheduled appointment as confirmed", () => {
    const ics = generateFeedICS([event({ status: "scheduled" })], { name: "Flux", now: NOW });
    expect(lines(ics)).toContain("STATUS:CONFIRMED");
  });

  it("carries the sequence, so an edit replaces rather than duplicates", () => {
    const ics = generateFeedICS([event({ sequence: 3 })], { name: "Flux", now: NOW });
    expect(lines(ics)).toContain("SEQUENCE:3");
  });

  it("stamps an edited appointment with when it was edited", () => {
    const ics = generateFeedICS([event({ updatedAt: new Date("2026-09-04T08:30:00Z") })], { name: "Flux", now: NOW });
    expect(lines(ics)).toContain("DTSTAMP:20260904T083000Z");
  });

  it("omits what it has nothing to say about", () => {
    const ics = generateFeedICS([event()], { name: "Flux", now: NOW });
    for (const property of ["DESCRIPTION", "LOCATION", "URL", "ORGANIZER", "CREATED"]) {
      expect(unfold(ics), property).not.toContain(`${property}:`);
    }
  });

  it("⚠️ escapes the characters that would otherwise end a property", () => {
    // A comma in a title is ordinary. Unescaped it starts a second value, and the
    // reader either drops the rest of the title or rejects the event.
    const ics = generateFeedICS([event({ title: "Riunione, poi pranzo; con Rossi" })], { name: "Flux", now: NOW });
    expect(unfold(ics)).toContain("SUMMARY:Riunione\\, poi pranzo\\; con Rossi");
  });

  it("turns a multi-line note into one property", () => {
    const ics = generateFeedICS([event({ description: "Prima riga\nSeconda riga" })], { name: "Flux", now: NOW });
    expect(unfold(ics)).toContain("DESCRIPTION:Prima riga\\nSeconda riga");
    expect(lines(ics)).not.toContain("Seconda riga");
  });

  it("prefers a meeting link to a room name for the location", () => {
    const ics = generateFeedICS([event({ location: "Sala A", locationUrl: "https://meet.example/x" })], {
      name: "Flux",
      now: NOW,
    });
    expect(unfold(ics)).toContain("LOCATION:https://meet.example/x");
    expect(unfold(ics)).toContain("URL:https://meet.example/x");
  });

  it("names the organiser when there is one", () => {
    const ics = generateFeedICS([event({ organizer: { name: "Anna Rossi", email: "anna@example.com" } })], {
      name: "Flux",
      now: NOW,
    });
    expect(unfold(ics)).toContain('ORGANIZER;CN="Anna Rossi":mailto:anna@example.com');
  });
});

describe("line folding", () => {
  it("keeps every line within 75 octets", () => {
    const ics = generateFeedICS([event({ title: "Riunione ".repeat(30) })], { name: "Flux", now: NOW });
    for (const line of ics.split("\r\n")) {
      expect(new TextEncoder().encode(line).length, line).toBeLessThanOrEqual(75);
    }
  });

  it("⚠️ counts octets, not characters", () => {
    // Accented Italian is two bytes a character and the product is used in
    // Italian, so a fold counted in characters overruns on ordinary text.
    const ics = generateFeedICS([event({ title: "però ".repeat(30) })], { name: "Flux", now: NOW });
    for (const line of ics.split("\r\n")) {
      expect(new TextEncoder().encode(line).length, line).toBeLessThanOrEqual(75);
    }
  });

  it("⚠️ never splits a character across the fold", () => {
    // A fold landing inside a multi-byte sequence corrupts the character, and the
    // damage survives unfolding — so it reaches the calendar as mojibake.
    const title = "è".repeat(120);
    const ics = generateFeedICS([event({ title })], { name: "Flux", now: NOW });
    expect(unfold(ics)).toContain(`SUMMARY:${title}`);
    expect(ics).not.toContain("�");
  });

  it("survives a round trip through folding for long accented text", () => {
    const description = "Discussione approfondita sull'offerta però senza impegno. ".repeat(6);
    const ics = generateFeedICS([event({ description })], { name: "Flux", now: NOW });
    expect(unfold(ics)).toContain(`DESCRIPTION:${description.replace(/,/g, "\\,")}`);
  });
});

describe("generateICS still invites", () => {
  // The feed shares its primitives with invitations, so the invitation path is
  // checked here too: a change made for the feed must not alter what goes out
  // attached to an email.
  const invite = {
    uid: "appt-9@flux",
    title: "Kickoff",
    startAt: new Date("2026-09-10T14:00:00Z"),
    endAt: new Date("2026-09-10T15:00:00Z"),
    sequence: 0,
    organizer: { email: "anna@example.com", name: "Anna Rossi" },
    attendees: [],
  };

  it("asks, where the feed publishes", () => {
    expect(lines(generateICS(invite))).toContain("METHOD:REQUEST");
  });

  it("cancels when told to", () => {
    expect(lines(generateICS(invite, "CANCEL"))).toContain("STATUS:CANCELLED");
  });

  it("terminates its last line too", () => {
    expect(generateICS(invite).endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});
