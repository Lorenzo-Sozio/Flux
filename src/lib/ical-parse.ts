/**
 * ical-parse.ts — reading a calendar somebody else published.
 *
 * The other half of S-10: an appointment made in Google Calendar showing up
 * here, so a meeting is not booked on top of one that already exists. The
 * obvious route is Google's API, which needs OAuth with the calendar scope and
 * therefore Google's verification — somebody else's queue.
 *
 * There is a second route that needs none of it. Google Calendar, Outlook and
 * Apple Calendar each publish a **secret address in iCal format** for a
 * calendar; pasting that address here is the mirror of pasting ours into them.
 * No OAuth screen, no tokens held on anybody's behalf, no verification.
 *
 * ⚠️ What this module does NOT do is as important as what it does, because a
 * calendar that quietly shows the wrong busy time is worse than one that shows
 * none. It reads events and expands the recurrence rules people actually use;
 * anything it does not understand it **drops rather than guesses**, and says so
 * in the result, so the caller can tell the difference between "you are free"
 * and "I could not read that".
 *
 * Pure. No network, no clock beyond what it is handed.
 */

// ─── Lines ────────────────────────────────────────────────────────────────────

export interface IcalLine {
  name: string;
  params: Record<string, string>;
  value: string;
}

/**
 * Undoes the folding RFC 5545 §3.1 applies to long lines.
 *
 * ⚠️ A continuation is CRLF followed by **one space or tab**, and that whitespace
 * belongs to the fold, not to the content. Stripping the wrong number of
 * characters corrupts every long description in the feed, which then looks like
 * the publisher's fault.
 */
export function unfold(text: string): string {
  return text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
}

/** Reverses the escaping of a TEXT value: §3.3.11, read backwards. */
export function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, c) => (c === "n" || c === "N" ? "\n" : c));
}

/** Splits one unfolded line into its name, its parameters and its value. */
export function parseLine(line: string): IcalLine | null {
  const colon = findValueColon(line);
  if (colon === -1) return null;

  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...rawParams] = head.split(";");

  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf("=");
    if (eq === -1) continue;
    params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }

  return { name: name.toUpperCase(), params, value };
}

/**
 * The colon that separates the head from the value.
 *
 * ⚠️ Not the first colon in the line. A parameter may be quoted and contain one
 * — `ATTENDEE;CN="Rossi: Anna":mailto:…` is legal — and splitting on the first
 * colon there produces a property called `ATTENDEE;CN="Rossi` whose value starts
 * mid-name. Everything after it in that event is then misread.
 */
function findValueColon(line: string): number {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ":" && !quoted) return i;
  }
  return -1;
}

// ─── Dates ────────────────────────────────────────────────────────────────────

export interface IcalDate {
  at: Date;
  /** A whole-day value: `VALUE=DATE`, written `YYYYMMDD` with no time at all. */
  allDay: boolean;
}

/**
 * Reads a DTSTART/DTEND value in any of the three shapes the spec allows.
 *
 * ⚠️ A floating time — one with no `Z` and no `TZID` — is deliberately read in
 * the zone the caller names rather than in the server's. The server's zone is an
 * accident of where this happens to run, and using it would move somebody's
 * 09:00 meeting by however many hours the data centre is away.
 */
export function parseIcalDate(value: string, params: Record<string, string>, fallbackZone: string): IcalDate | null {
  const date = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (date) {
    const [, y, m, d] = date;
    return { at: new Date(`${y}-${m}-${d}T00:00:00Z`), allDay: true };
  }

  const stamp = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!stamp) return null;

  const [, y, m, d, hh, mm, ss, z] = stamp;
  if (z === "Z") return { at: new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}Z`), allDay: false };

  const zone = params.TZID || fallbackZone;
  return { at: zonedToUtc(`${y}-${m}-${d}T${hh}:${mm}:${ss}`, zone), allDay: false };
}

/**
 * A wall-clock time in a named zone, as an instant.
 *
 * Uses `Intl` rather than a timezone library: this bundle already runs close to
 * the Workers size limit, and `Intl` is present everywhere this deploys. The
 * same reasoning the working-hours arithmetic uses.
 *
 * ⚠️ Two passes, and the second is not redundant. The offset depends on the
 * instant, and the instant is what is being computed — so the first guess can
 * land on the wrong side of a daylight-saving change and be off by an hour. The
 * second pass re-reads the offset at the guessed instant and corrects it.
 */
export function zonedToUtc(wallClock: string, zone: string): Date {
  const naive = Date.parse(`${wallClock}Z`);
  if (Number.isNaN(naive)) return new Date(Number.NaN);

  let guess = naive;
  for (let pass = 0; pass < 2; pass++) {
    const offset = zoneOffsetMs(new Date(guess), zone);
    guess = naive - offset;
  }
  return new Date(guess);
}

/** How far ahead of UTC a zone is, at a given instant. */
function zoneOffsetMs(at: Date, zone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(at);

    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
    const asUtc = Date.parse(
      `${get("year")}-${get("month")}-${get("day")}T${get("hour").replace("24", "00")}:${get("minute")}:${get("second")}Z`,
    );
    return asUtc - at.getTime();
  } catch {
    // An unknown TZID is the publisher's, not ours. Treating it as UTC keeps the
    // event rather than dropping it, and the error is bounded by the offset.
    return 0;
  }
}

// ─── Events ───────────────────────────────────────────────────────────────────

export interface ExternalEvent {
  uid: string;
  summary: string;
  start: Date;
  end: Date;
  allDay: boolean;
  /** True when this occurrence came from expanding a recurrence rule. */
  recurring: boolean;
}

export interface ParseResult {
  events: ExternalEvent[];
  /**
   * Events read but not understood well enough to place on a calendar.
   *
   * ⚠️ Counted rather than swallowed. A feed whose recurrences this module
   * cannot expand would otherwise look like a quiet week, and "you are free" is
   * a different statement from "I could not read that".
   */
  skipped: { uid: string; reason: string }[];
}

/** Statuses that mean the event is not happening. */
const NOT_HAPPENING = new Set(["CANCELLED"]);

/**
 * Reads a published calendar and returns the occurrences inside a window.
 *
 * The window is not a convenience: a yearly rule with no end would otherwise
 * expand for ever, and a feed is fetched to answer "am I busy on this screen",
 * which is always a bounded question.
 */
export function parseIcal(
  text: string,
  window: { from: Date; to: Date },
  options: { defaultZone?: string; maxOccurrences?: number } = {},
): ParseResult {
  const zone = options.defaultZone ?? "UTC";
  const cap = options.maxOccurrences ?? 500;

  const events: ExternalEvent[] = [];
  const skipped: { uid: string; reason: string }[] = [];

  for (const block of splitEvents(unfold(text))) {
    const lines = block
      .split(/\r?\n/)
      .map(parseLine)
      .filter((l): l is IcalLine => l !== null);

    const get = (name: string) => lines.find((l) => l.name === name);
    const uid = get("UID")?.value ?? "";
    const status = get("STATUS")?.value?.toUpperCase();
    if (status && NOT_HAPPENING.has(status)) continue;

    const dtstart = get("DTSTART");
    if (!dtstart) {
      skipped.push({ uid, reason: "no start" });
      continue;
    }

    const start = parseIcalDate(dtstart.value, dtstart.params, zone);
    if (!start) {
      skipped.push({ uid, reason: "unreadable start" });
      continue;
    }

    const end = readEnd(get("DTEND"), get("DURATION"), start, zone);
    if (!end) {
      skipped.push({ uid, reason: "unreadable end" });
      continue;
    }

    const summary = unescapeText(get("SUMMARY")?.value ?? "");
    const rrule = get("RRULE")?.value;
    const exdates = collectExdates(lines, zone);

    if (!rrule) {
      if (overlaps(start.at, end.at, window)) {
        events.push({ uid, summary, start: start.at, end: end.at, allDay: start.allDay, recurring: false });
      }
      continue;
    }

    const expansion = expandRrule(rrule, start.at, window, cap);
    if (!expansion) {
      skipped.push({ uid, reason: `unsupported recurrence: ${rrule}` });
      continue;
    }

    const length = end.at.getTime() - start.at.getTime();
    for (const at of expansion) {
      if (exdates.some((x) => x.getTime() === at.getTime())) continue;
      const finish = new Date(at.getTime() + length);
      if (!overlaps(at, finish, window)) continue;
      events.push({ uid, summary, start: at, end: finish, allDay: start.allDay, recurring: true });
    }
  }

  return { events, skipped };
}

function splitEvents(text: string): string[] {
  const out: string[] = [];
  const re = /BEGIN:VEVENT\r?\n([\s\S]*?)END:VEVENT/g;
  let m: RegExpExecArray | null = re.exec(text);
  while (m !== null) {
    out.push(m[1]);
    m = re.exec(text);
  }
  return out;
}

function overlaps(start: Date, end: Date, window: { from: Date; to: Date }): boolean {
  return start < window.to && end > window.from;
}

/**
 * When the event finishes.
 *
 * ⚠️ An event may declare a DURATION instead of a DTEND, and one with neither is
 * not malformed: the spec says a timed event with no end lasts an instant, and a
 * whole-day one lasts the day. Treating a missing end as "unreadable" would drop
 * perfectly good events from some publishers.
 */
function readEnd(
  dtend: IcalLine | undefined,
  duration: IcalLine | undefined,
  start: IcalDate,
  zone: string,
): IcalDate | null {
  if (dtend) return parseIcalDate(dtend.value, dtend.params, zone);

  if (duration) {
    const ms = parseDuration(duration.value);
    return ms === null ? null : { at: new Date(start.at.getTime() + ms), allDay: start.allDay };
  }

  const day = 86_400_000;
  return { at: new Date(start.at.getTime() + (start.allDay ? day : 0)), allDay: start.allDay };
}

/** An ISO 8601 duration, in the subset iCalendar allows. */
export function parseDuration(value: string): number | null {
  const m = value.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  const [, sign, w, d, h, min, s] = m;
  const n = (v: string | undefined) => (v ? Number(v) : 0);
  const total = n(w) * 604_800_000 + n(d) * 86_400_000 + n(h) * 3_600_000 + n(min) * 60_000 + n(s) * 1000;
  return sign === "-" ? -total : total;
}

function collectExdates(lines: IcalLine[], zone: string): Date[] {
  const out: Date[] = [];
  for (const line of lines) {
    if (line.name !== "EXDATE") continue;
    for (const part of line.value.split(",")) {
      const parsed = parseIcalDate(part.trim(), line.params, zone);
      if (parsed) out.push(parsed.at);
    }
  }
  return out;
}

// ─── Recurrence ───────────────────────────────────────────────────────────────

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/**
 * The occurrences a rule produces inside a window, or null if it is not one of
 * the shapes this understands.
 *
 * ⚠️ Returning **null** rather than an empty list is the whole design. An empty
 * list says "this never happens", a null says "I could not read this" — and the
 * caller reports the second so the person can see that part of their calendar is
 * missing rather than assuming it is free.
 *
 * Understood: FREQ of DAILY, WEEKLY, MONTHLY and YEARLY, with INTERVAL, COUNT,
 * UNTIL and — for WEEKLY — BYDAY. That covers every rule a person can create in
 * Google Calendar's own interface. Anything else, including BYSETPOS and the
 * ordinal forms of BYDAY such as `2MO`, is refused rather than approximated.
 */
export function expandRrule(rule: string, start: Date, window: { from: Date; to: Date }, cap: number): Date[] | null {
  const parts: Record<string, string> = {};
  for (const p of rule.split(";")) {
    const eq = p.indexOf("=");
    if (eq > 0) parts[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
  }

  const freq = parts.FREQ?.toUpperCase();
  if (!freq || !["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq)) return null;

  // Anything that reshapes the pattern rather than repeating it is refused.
  for (const unsupported of ["BYSETPOS", "BYMONTHDAY", "BYYEARDAY", "BYWEEKNO", "BYMONTH", "BYHOUR", "BYMINUTE"]) {
    if (parts[unsupported]) return null;
  }

  const interval = parts.INTERVAL ? Number(parts.INTERVAL) : 1;
  if (!Number.isFinite(interval) || interval < 1) return null;

  const count = parts.COUNT ? Number(parts.COUNT) : null;
  if (count !== null && (!Number.isFinite(count) || count < 1)) return null;

  let until: number | null = null;
  if (parts.UNTIL) {
    const parsed = parseIcalDate(parts.UNTIL, {}, "UTC");
    if (!parsed) return null;
    until = parsed.at.getTime();
  }

  let byDay: number[] | null = null;
  if (parts.BYDAY) {
    if (freq !== "WEEKLY") return null;
    byDay = [];
    for (const raw of parts.BYDAY.split(",")) {
      const day = raw.trim().toUpperCase();
      // `2MO` means "the second Monday", a different question from "every Monday".
      if (!WEEKDAYS.includes(day)) return null;
      byDay.push(WEEKDAYS.indexOf(day));
    }
    if (byDay.length === 0) return null;
  }

  const out: Date[] = [];
  let emitted = 0;
  const step = (from: Date, n: number) => advance(from, freq, n);

  // Walk from the start rather than from the window: which occurrence a COUNT
  // limit falls on depends on every one before it, including those already past.
  let cursor = new Date(start);
  for (let guard = 0; guard < cap * 8; guard++) {
    if (cursor.getTime() > window.to.getTime()) break;
    if (count !== null && emitted >= count) break;
    if (until !== null && cursor.getTime() > until) break;

    if (byDay) {
      // One week's worth of matching days, from the week this cursor sits in.
      const weekStart = new Date(cursor.getTime() - cursor.getUTCDay() * 86_400_000);
      for (const day of [...byDay].sort((a, b) => a - b)) {
        const at = new Date(weekStart.getTime() + day * 86_400_000);
        at.setUTCHours(start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds(), 0);
        if (at.getTime() < start.getTime()) continue;
        if (until !== null && at.getTime() > until) continue;
        if (count !== null && emitted >= count) break;
        emitted++;
        if (at.getTime() <= window.to.getTime() && at.getTime() >= window.from.getTime() - 86_400_000) out.push(at);
      }
    } else {
      emitted++;
      if (cursor.getTime() >= window.from.getTime() - 86_400_000) out.push(new Date(cursor));
    }

    if (out.length > cap) return out.slice(0, cap);
    cursor = step(cursor, interval);
  }

  return out;
}

/** One step of a frequency, honouring the interval. */
function advance(from: Date, freq: string, interval: number): Date {
  const next = new Date(from);
  switch (freq) {
    case "DAILY":
      next.setUTCDate(next.getUTCDate() + interval);
      break;
    case "WEEKLY":
      next.setUTCDate(next.getUTCDate() + 7 * interval);
      break;
    case "MONTHLY":
      next.setUTCMonth(next.getUTCMonth() + interval);
      break;
    default:
      next.setUTCFullYear(next.getUTCFullYear() + interval);
      break;
  }
  return next;
}
