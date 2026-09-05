/**
 * ticket-handover.ts — what somebody taking over a ticket needs to know.
 *
 * The audit's fourth ask under S-05 is "a summary of the thread for whoever
 * takes over", and that was the one part recorded as genuinely needing a
 * language model. Writing it out, it is not.
 *
 * Ask what the person picking the ticket up actually needs, in the order they
 * need it, and none of it is prose:
 *
 *  • **Whose move is it.** The single fact that decides whether they open this
 *    ticket or the next one, and it is exact: whoever wrote the last public
 *    message is not the one being waited on.
 *  • **How long the wait has been.** Measured from that message, not from when
 *    the ticket was opened — a ticket open three weeks with an answer sent
 *    yesterday is not a ticket that has been ignored for three weeks.
 *  • **What was asked**, in the customer's own words, which is the first public
 *    message and not a paraphrase of it.
 *  • **What has been tried**, which lives in the internal notes.
 *  • **How much thread there is**, so they know whether to read it.
 *
 * A model asked for a paragraph would bury the first of those inside the last,
 * cost a call, and occasionally invent a detail — and a handover is read in
 * fifteen seconds by somebody deciding what to do next. So this is arithmetic
 * over the messages, and the panel quotes rather than summarises.
 */

export type Waiting = "us" | "customer" | "nobody";

export interface HandoverMessage {
  id: string;
  /** Set when one of our people wrote it; null for anything from outside. */
  senderId: string | null;
  senderName: string | null;
  /** False for an internal note, which the customer never sees. */
  isPublic: boolean;
  content: string;
  createdAt: Date;
}

export interface Handover {
  /** Whose move it is — the fact that decides whether to pick this up. */
  waiting: Waiting;
  /** Whole hours since the message that is being waited on. Null when nobody waits. */
  waitingHours: number | null;
  /** What the customer originally asked, verbatim. */
  opening: { text: string; at: Date; who: string | null } | null;
  /** The last public message, whoever wrote it. */
  lastWord: { text: string; at: Date; who: string | null; fromUs: boolean } | null;
  /** The most recent internal note: what somebody already tried. */
  lastNote: { text: string; at: Date; who: string | null } | null;
  publicMessages: number;
  internalNotes: number;
  /** How many times our side answered publicly. Zero is worth saying out loud. */
  replies: number;
  /** Nobody from our side has ever answered in public. */
  neverAnswered: boolean;
}

const HOUR_MS = 3_600_000;

/** Ours if a user account wrote it; anything without one came from outside. */
function fromUs(message: HandoverMessage): boolean {
  return message.senderId !== null;
}

/**
 * Reads the thread.
 *
 * Expects the messages in any order and sorts them; a caller that has already
 * ordered them loses nothing, and one that has not does not get a wrong answer.
 */
export function handover(messages: HandoverMessage[], now: number = Date.now()): Handover {
  const ordered = [...messages].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const publics = ordered.filter((m) => m.isPublic);
  const notes = ordered.filter((m) => !m.isPublic);
  const replies = publics.filter(fromUs).length;

  const first = publics.find((m) => !fromUs(m)) ?? publics[0] ?? null;
  const last = publics[publics.length - 1] ?? null;
  const lastNote = notes[notes.length - 1] ?? null;

  // Whoever spoke last is not the one being waited on. With nothing public at
  // all there is nobody to wait for: an internal note is not a conversation.
  let waiting: Waiting = "nobody";
  if (last) waiting = fromUs(last) ? "customer" : "us";

  return {
    waiting,
    waitingHours: last ? Math.max(0, Math.floor((now - last.createdAt.getTime()) / HOUR_MS)) : null,
    opening: first ? { text: first.content, at: first.createdAt, who: first.senderName } : null,
    lastWord: last ? { text: last.content, at: last.createdAt, who: last.senderName, fromUs: fromUs(last) } : null,
    lastNote: lastNote ? { text: lastNote.content, at: lastNote.createdAt, who: lastNote.senderName } : null,
    publicMessages: publics.length,
    internalNotes: notes.length,
    replies,
    neverAnswered: replies === 0,
  };
}

/**
 * The first line or so of a message, for a panel that has one line to spend.
 *
 * Cuts on a word boundary and marks the cut, because a quotation that stops
 * mid-word reads as corrupted text rather than as an excerpt.
 */
export function excerpt(text: string, limit = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= limit) return flat;
  const cut = flat.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
