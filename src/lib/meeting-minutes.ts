/**
 * meeting-minutes.ts — the minutes, from what was actually written down.
 *
 * The audit's third ask under S-06 is "minutes of the meeting from the recorded
 * activity", and it was filed with the two that were said to need a language
 * model. This one does not need one — it is the case where a model would be
 * actively harmful.
 *
 * ⚠️ **Nothing in this product records what was said.** There is no transcript,
 * no recording, no attendee notes beyond whatever one person typed into the
 * activity afterwards. A model handed "meeting with Rossi, 45 minutes" and asked
 * for minutes has nothing to summarise, so it writes plausible minutes instead —
 * decisions nobody took, in a document that will be filed and quoted back. The
 * failure would look exactly like the feature working.
 *
 * So this assembles rather than composes. Every sentence in the output was typed
 * by a person; the module decides what belongs, in what order, and what was
 * agreed — which it takes from the tasks that came out of the window rather than
 * from anybody's memory of the conversation.
 */

export type SessionKind = "meeting" | "call";

export interface MinutesActivity {
  id: string;
  /** `note`, `call`, `meeting`, `email` as stored. */
  type: string;
  content: string | null;
  date: Date | null;
  durationMinutes: number | null;
  /** Comma-separated names or addresses, as the form collects them. */
  participants: string | null;
  ownerName: string | null;
}

export interface MinutesTask {
  id: string;
  title: string;
  ownerName: string | null;
  dueDate: Date | null;
  createdAt: Date;
  status: string;
}

export interface MinutesSession {
  id: string;
  kind: SessionKind;
  at: Date;
  durationMinutes: number | null;
  participants: string[];
  notes: string | null;
  recordedBy: string | null;
}

export interface Minutes {
  from: Date;
  to: Date;
  sessions: MinutesSession[];
  /** Notes and emails logged in the window that were not themselves a session. */
  context: { id: string; type: string; at: Date; text: string; recordedBy: string | null }[];
  /** What came out of it: the tasks raised in the window. */
  agreed: MinutesTask[];
  /** Everyone named across the sessions, de-duplicated, in first-seen order. */
  attendees: string[];
  totalMinutes: number;
}

/** Splits the free-text participants field the form collects. */
export function splitParticipants(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,;]/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function isSession(activity: MinutesActivity): activity is MinutesActivity & { date: Date } {
  return (activity.type === "meeting" || activity.type === "call") && activity.date !== null;
}

/**
 * Assembles the minutes for one window.
 *
 * Returns null when there was no meeting and no call in it: a minutes document
 * for a period in which nobody met is a page of headings, and filing one implies
 * a meeting took place. Notes on their own are not a meeting.
 */
export function buildMinutes(
  activities: MinutesActivity[],
  tasks: MinutesTask[],
  window: { from: Date; to: Date },
): Minutes | null {
  const within = (d: Date) => d >= window.from && d <= window.to;

  const sessions: MinutesSession[] = activities
    .filter((a) => isSession(a) && within(a.date as Date))
    .map((a) => ({
      id: a.id,
      kind: a.type as SessionKind,
      at: a.date as Date,
      durationMinutes: a.durationMinutes,
      participants: splitParticipants(a.participants),
      notes: a.content?.trim() ? a.content.trim() : null,
      recordedBy: a.ownerName,
    }))
    .sort((x, y) => x.at.getTime() - y.at.getTime());

  if (sessions.length === 0) return null;

  const context = activities
    .filter((a) => !isSession(a) && a.date !== null && within(a.date as Date) && a.content?.trim())
    .map((a) => ({
      id: a.id,
      type: a.type,
      at: a.date as Date,
      text: (a.content as string).trim(),
      recordedBy: a.ownerName,
    }))
    .sort((x, y) => x.at.getTime() - y.at.getTime());

  // What was agreed is what somebody wrote down as a task, not what anybody
  // remembers agreeing. Raised in the window, whatever has happened to it since.
  const agreed = tasks.filter((t) => within(t.createdAt)).sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime());

  const attendees: string[] = [];
  for (const session of sessions) {
    for (const person of session.participants) {
      if (!attendees.some((a) => a.toLowerCase() === person.toLowerCase())) attendees.push(person);
    }
  }

  return {
    from: window.from,
    to: window.to,
    sessions,
    context,
    agreed,
    attendees,
    totalMinutes: sessions.reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0),
  };
}

/**
 * The window a "minutes for this meeting" button means.
 *
 * A meeting is not one instant: the note gets written afterwards, the tasks get
 * raised in the hour after that, and the follow-up email goes the same day. So
 * the window runs from the session's start to the end of that day, which is what
 * somebody means by "the meeting" when they ask for its minutes.
 */
export function windowAround(at: Date, daysAfter = 1): { from: Date; to: Date } {
  const from = new Date(at);
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + daysAfter);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}
