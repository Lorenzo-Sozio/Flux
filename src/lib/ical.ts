/**
 * ical.ts — RFC 5545 iCalendar generation for appointment invitations.
 * Compatible with Outlook, Google Calendar, and Apple Calendar.
 * No external dependencies.
 */

function formatUtcDate(d: Date): string {
  return `${d.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
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

export interface ICSEvent {
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
  const dtstart = formatUtcDate(event.startAt);
  const dtend = formatUtcDate(event.endAt);
  const status = method === "CANCEL" ? "CANCELLED" : "CONFIRMED";

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//FluxCRM//FluxCRM//EN",
    `METHOD:${method}`,
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
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

export interface FeedEvent {
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

function feedEventLines(event: FeedEvent, stamp: string): string[] {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${event.updatedAt ? formatUtcDate(event.updatedAt) : stamp}`,
    `DTSTART:${formatUtcDate(event.startAt)}`,
    `DTEND:${formatUtcDate(event.endAt)}`,
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

  for (const event of events) lines.push(...feedEventLines(event, stamp));

  lines.push("END:VCALENDAR");
  // RFC 5545 §3.4: the last content line is terminated by CRLF like any other.
  return `${lines.join(CRLF)}${CRLF}`;
}
