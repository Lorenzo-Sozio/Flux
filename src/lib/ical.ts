/**
 * ical.ts — RFC 5545 iCalendar generation for appointment invitations.
 * Compatible with Outlook, Google Calendar, and Apple Calendar.
 * No external dependencies.
 */

function formatUtcDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
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
      current = " " + ch;
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
  return lines.join("\r\n");
}
