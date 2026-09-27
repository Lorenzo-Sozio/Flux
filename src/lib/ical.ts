/**
 * ical.ts — RFC 5545 iCalendar generation for appointment invitations.
 * Compatible with Outlook, Google Calendar, and Apple Calendar.
 * No external dependencies.
 */

import { parseRRule } from "@/lib/recurrence";
import { wallParts } from "@/lib/wall-clock";

function formatUtcDate(d: Date): string {
  return `${d.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function formatWallDate(d: Date, timeZone: string): string {
  const p = wallParts(d, timeZone);
  return `${p.year}${pad2(p.month)}${pad2(p.day)}`;
}

function formatWallDateTime(d: Date, timeZone: string): string {
  const p = wallParts(d, timeZone);
  return `${p.year}${pad2(p.month)}${pad2(p.day)}T${pad2(p.hour)}${pad2(p.minute)}00`;
}

/**
 * How a repeating or all-day event is timed, beyond a plain start and end.
 *
 * ⚠️ A repeating event is written on its zone's clock (`TZID`), never in UTC. A
 * client expands a UTC rule in UTC, so a weekly meeting at ten in Rome becomes a
 * meeting at eleven for half the year — in every invitee's calendar, silently.
 */
export interface ICSTiming {
  /** The zone the series keeps to; required for recurrence and all-day. */
  timeZone?: string | null;
  allDay?: boolean;
  /** An RRULE without its prefix. */
  recurrenceRule?: string | null;
  /** Starts of removed occurrences. */
  recurrenceExceptions?: readonly string[] | null;
}

function minutesOffset(instant: Date, timeZone: string): number {
  const p = wallParts(instant, timeZone);
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - instant.getTime()) / 60_000);
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${pad2(Math.floor(abs / 60))}${pad2(abs % 60)}`;
}

const RULE_DAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

/**
 * A VTIMEZONE for a named zone, derived from what `Intl` knows about one year.
 *
 * RFC 5545 requires one for every TZID used. The daylight-saving changes are
 * found by walking the year a day at a time and then an hour at a time, and
 * written as yearly rules ("last Sunday of October"), which is how every zone
 * with summer time in use today is defined.
 */
export function vtimezone(timeZone: string, year: number): string[] {
  const jan = minutesOffset(new Date(Date.UTC(year, 0, 1)), timeZone);
  const jul = minutesOffset(new Date(Date.UTC(year, 6, 1)), timeZone);
  const lines = ["BEGIN:VTIMEZONE", `TZID:${timeZone}`];
  if (jan === jul) {
    lines.push(
      "BEGIN:STANDARD",
      "DTSTART:19700101T000000",
      `TZOFFSETFROM:${formatOffset(jan)}`,
      `TZOFFSETTO:${formatOffset(jan)}`,
      "END:STANDARD",
      "END:VTIMEZONE",
    );
    return lines;
  }

  const HOUR = 3_600_000;
  let t = Date.UTC(year, 0, 1);
  let prev = minutesOffset(new Date(t), timeZone);
  const end = Date.UTC(year + 1, 0, 1);
  while (t < end) {
    const next = t + 24 * HOUR;
    const off = minutesOffset(new Date(next), timeZone);
    if (off !== prev) {
      let h = t;
      while (minutesOffset(new Date(h + HOUR), timeZone) === prev) h += HOUR;
      const change = new Date(h + HOUR);
      // The wall-clock moment of the change, on the clock it changes from.
      const local = new Date(change.getTime() + prev * 60_000);
      const month = local.getUTCMonth() + 1;
      const day = local.getUTCDate();
      const lastOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const nth = day + 7 > lastOfMonth ? -1 : Math.ceil(day / 7);
      const weekday = RULE_DAYS[(local.getUTCDay() + 6) % 7];
      const kind = off > prev ? "DAYLIGHT" : "STANDARD";
      lines.push(
        `BEGIN:${kind}`,
        `DTSTART:${year}${pad2(month)}${pad2(day)}T${pad2(local.getUTCHours())}${pad2(local.getUTCMinutes())}00`,
        `RRULE:FREQ=YEARLY;BYMONTH=${month};BYDAY=${nth}${weekday}`,
        `TZOFFSETFROM:${formatOffset(prev)}`,
        `TZOFFSETTO:${formatOffset(off)}`,
        `END:${kind}`,
      );
      prev = off;
    }
    t = next;
  }
  lines.push("END:VTIMEZONE");
  return lines;
}

/** DTSTART, DTEND, RRULE and EXDATE for an event, and the zone it needs declared. */
function timingLines(
  startAt: Date,
  endAt: Date,
  timing: ICSTiming,
): { lines: string[]; zone: { id: string; year: number } | null } {
  const tz = timing.timeZone ?? null;
  const rule = timing.recurrenceRule && tz ? parseRRule(timing.recurrenceRule) : null;
  const exceptions = rule ? (timing.recurrenceExceptions ?? []) : [];

  if (timing.allDay && tz) {
    const lines = [
      `DTSTART;VALUE=DATE:${formatWallDate(startAt, tz)}`,
      `DTEND;VALUE=DATE:${formatWallDate(endAt, tz)}`,
    ];
    if (rule) {
      // With DATE values UNTIL has to be a DATE as well (RFC 5545 §3.3.10).
      const raw = (timing.recurrenceRule ?? "").replace(/UNTIL=[^;]+/, () =>
        rule.until ? `UNTIL=${formatWallDate(rule.until, tz)}` : "",
      );
      lines.push(`RRULE:${raw}`);
      if (exceptions.length) {
        lines.push(foldLine(`EXDATE;VALUE=DATE:${exceptions.map((e) => formatWallDate(new Date(e), tz)).join(",")}`));
      }
    }
    return { lines, zone: null };
  }

  if (rule && tz) {
    const lines = [
      `DTSTART;TZID=${tz}:${formatWallDateTime(startAt, tz)}`,
      `DTEND;TZID=${tz}:${formatWallDateTime(endAt, tz)}`,
      `RRULE:${timing.recurrenceRule}`,
    ];
    if (exceptions.length) {
      lines.push(foldLine(`EXDATE;TZID=${tz}:${exceptions.map((e) => formatWallDateTime(new Date(e), tz)).join(",")}`));
    }
    return { lines, zone: { id: tz, year: wallParts(startAt, tz).year } };
  }

  return { lines: [`DTSTART:${formatUtcDate(startAt)}`, `DTEND:${formatUtcDate(endAt)}`], zone: null };
}

function escapeText(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n").replace(/\r/g, "");
}

// RFC 5545 §3.1: fold lines longer than 75 octets (CRLF + SP continuation)
function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const chars = [...line];
  const chunks: string[] = [];
  let current = "";
  let byteLen = 0;
  for (const ch of chars) {
    const chBytes = enc.encode(ch).length;
    // First chunk: 75 bytes max; continuation chunks: 74 bytes (space prefix takes 1)
    const cap = chunks.length === 0 ? 75 : 74;
    if (byteLen + chBytes > cap) {
      chunks.push(current);
      current = ` ${ch}`;
      byteLen = 1 + chBytes;
    } else {
      current += ch;
      byteLen += chBytes;
    }
  }
  if (current) chunks.push(current);
  return chunks.join("\r\n");
}

export type AttendeeRole = "organizer" | "required" | "optional";
export type AttendeeStatus = "pending" | "accepted" | "declined" | "tentative";

export interface ICSAttendee {
  email: string;
  name: string;
  role: AttendeeRole;
  status: AttendeeStatus;
}

export interface ICSEvent extends ICSTiming {
  uid: string;
  title: string;
  description?: string | null;
  location?: string | null;
  locationUrl?: string | null;
  startAt: Date;
  endAt: Date;
  sequence: number;
  organizer: { email: string; name: string };
  attendees: ICSAttendee[];
  reminderMinutes?: number | null;
}

const PARTSTAT: Record<AttendeeStatus, string> = {
  pending: "NEEDS-ACTION",
  accepted: "ACCEPTED",
  declined: "DECLINED",
  tentative: "TENTATIVE",
};

const ROLE_MAP: Record<AttendeeRole, string> = {
  organizer: "CHAIR",
  required: "REQ-PARTICIPANT",
  optional: "OPT-PARTICIPANT",
};

export function generateICS(event: ICSEvent, method: "REQUEST" | "CANCEL" | "REPLY" = "REQUEST"): string {
  const now = formatUtcDate(new Date());
  const timing = timingLines(event.startAt, event.endAt, event);
  const status = method === "CANCEL" ? "CANCELLED" : "CONFIRMED";

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//FluxCRM//FluxCRM//EN",
    `METHOD:${method}`,
    ...(timing.zone ? vtimezone(timing.zone.id, timing.zone.year) : []),
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${now}`,
    ...timing.lines,
    foldLine(`SUMMARY:${escapeText(event.title)}`),
    foldLine(`ORGANIZER;CN="${escapeText(event.organizer.name)}":mailto:${event.organizer.email}`),
    `SEQUENCE:${event.sequence}`,
    `STATUS:${status}`,
  ];

  if (event.description) {
    lines.push(foldLine(`DESCRIPTION:${escapeText(event.description)}`));
  }

  const loc = event.locationUrl ?? event.location;
  if (loc) {
    lines.push(foldLine(`LOCATION:${escapeText(loc)}`));
  }

  if (event.locationUrl) {
    lines.push(foldLine(`URL:${event.locationUrl}`));
  }

  for (const attendee of event.attendees) {
    const partstat = PARTSTAT[attendee.status] ?? "NEEDS-ACTION";
    const role = ROLE_MAP[attendee.role] ?? "REQ-PARTICIPANT";
    lines.push(
      foldLine(
        `ATTENDEE;CUTYPE=INDIVIDUAL;CN="${escapeText(attendee.name)}";RSVP=TRUE;PARTSTAT=${partstat};ROLE=${role}:mailto:${attendee.email}`,
      ),
    );
  }

  if (event.reminderMinutes != null && method === "REQUEST") {
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      foldLine(`DESCRIPTION:Reminder: ${escapeText(event.title)}`),
      `TRIGGER:-PT${event.reminderMinutes}M`,
      "END:VALARM",
    );
  }

  lines.push("END:VEVENT", "END:VCALENDAR");
  return `${lines.join(CRLF)}${CRLF}`;
}

// ─── Subscription feed ────────────────────────────────────────────────────────

/**
 * The audit's S-10 asks for two-way sync with Google Calendar and Gmail, and
 * names the reason: double entry is the main thing that gets a CRM abandoned.
 * Google's API route to it is gated on Google verifying the calendar scope —
 * somebody else's queue, and not a date this project can promise.
 *
 * A subscription is not gated on anything, and removes the double entry in the
 * direction that causes it. Google Calendar, Outlook and Apple Calendar all
 * subscribe to a URL: an appointment booked here then appears in the person's
 * own calendar and keeps up to date, with no OAuth screen and no tokens held on
 * anybody's behalf.
 *
 * The other direction is the mirror of this one and needs Google no more than
 * this does: every calendar also *publishes* a secret iCal address, and
 * `ical-parse.ts` reads one back in. So neither direction waits on anybody.
 *
 * ⚠️ The difference from an invitation is not the format, it is the method. An
 * invitation is `REQUEST`: one event, addressed to attendees, which a mail client
 * turns into accept/decline buttons. A feed is `PUBLISH`: many events, addressed
 * to nobody, which a calendar mirrors. Sending a feed with `REQUEST` makes some
 * clients ask the subscriber to RSVP to every meeting in it.
 */

const CRLF = "\r\n";

export interface FeedEvent extends ICSTiming {
  uid: string;
  title: string;
  description?: string | null;
  location?: string | null;
  locationUrl?: string | null;
  startAt: Date;
  endAt: Date;
  sequence?: number | null;
  /** As stored on the appointment: `scheduled` | `completed` | `cancelled`. */
  status?: string | null;
  organizer?: { email: string; name: string } | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
}

/**
 * ⚠️ A cancelled appointment stays in the feed, marked `CANCELLED`. Dropping it
 * would be the obvious thing and it is wrong: a subscriber that stops seeing an
 * event does not delete its copy, it keeps it. Omitting a cancelled meeting
 * leaves it on everyone's calendar for ever — the exact failure this feature
 * exists to prevent, and one nobody would report, because from here it looks
 * cancelled.
 */
function feedStatus(status: string | null | undefined): string {
  return status === "cancelled" ? "CANCELLED" : "CONFIRMED";
}

function feedEventLines(event: FeedEvent, stamp: string, zones: Map<string, number>): string[] {
  const timing = timingLines(event.startAt, event.endAt, event);
  if (timing.zone && !zones.has(timing.zone.id)) zones.set(timing.zone.id, timing.zone.year);
  const lines = [
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${event.updatedAt ? formatUtcDate(event.updatedAt) : stamp}`,
    ...timing.lines,
    foldLine(`SUMMARY:${escapeText(event.title)}`),
    `SEQUENCE:${event.sequence ?? 0}`,
    `STATUS:${feedStatus(event.status)}`,
  ];

  if (event.description) lines.push(foldLine(`DESCRIPTION:${escapeText(event.description)}`));

  const loc = event.locationUrl ?? event.location;
  if (loc) lines.push(foldLine(`LOCATION:${escapeText(loc)}`));
  if (event.locationUrl) lines.push(foldLine(`URL:${event.locationUrl}`));
  if (event.createdAt) lines.push(`CREATED:${formatUtcDate(event.createdAt)}`);

  if (event.organizer?.email) {
    lines.push(foldLine(`ORGANIZER;CN="${escapeText(event.organizer.name)}":mailto:${event.organizer.email}`));
  }

  lines.push("END:VEVENT");
  return lines;
}

/**
 * A whole calendar, for a client to subscribe to.
 *
 * `X-WR-CALNAME` is not in the RFC, but every reader that matters honours it and
 * without it the subscription appears in someone's sidebar named after a URL.
 * The refresh hints are requests: a client polls when it feels like it, which is
 * why nothing here depends on being read at a particular moment.
 */
export function generateFeedICS(
  events: FeedEvent[],
  options: { name: string; productId?: string; now?: Date } = { name: "Flux CRM" },
): string {
  const stamp = formatUtcDate(options.now ?? new Date());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${options.productId ?? "-//FluxCRM//FluxCRM//EN"}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    foldLine(`X-WR-CALNAME:${escapeText(options.name)}`),
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
    "X-PUBLISHED-TTL:PT15M",
  ];

  const zones = new Map<string, number>();
  const body: string[] = [];
  for (const event of events) body.push(...feedEventLines(event, stamp, zones));
  for (const [id, year] of zones) lines.push(...vtimezone(id, year));
  lines.push(...body);

  lines.push("END:VCALENDAR");
  // RFC 5545 §3.4: the last content line is terminated by CRLF like any other.
  return `${lines.join(CRLF)}${CRLF}`;
}
