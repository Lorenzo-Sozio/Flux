/**
 * How long is left before a deadline, said the way a person would say it.
 *
 * Lived inside the CRM dashboard page, then the ticket list needed the same
 * sentence — and a second copy would have drifted the first time somebody
 * changed "2h left" to "in 2h". The words are in the `common` namespace for the
 * same reason: they are not about any one screen.
 */
export interface TimeLeft {
  text: string;
  /** Past the deadline. The caller decides what red means. */
  late: boolean;
}

/** A translator over the `common` namespace — the six timing keys live there. */
type Words = (key: string, values?: Record<string, number>) => string;

export function timeLeft(deadline: Date | string | null | undefined, t: Words): TimeLeft | null {
  if (!deadline) return null;

  const ms = new Date(deadline).getTime() - Date.now();
  const late = ms < 0;
  const minutes = Math.round(Math.abs(ms) / 60_000);

  if (minutes < 60) return { text: t(late ? "minutesLate" : "minutesLeft", { n: minutes }), late };
  const hours = Math.round(minutes / 60);
  if (hours < 24) return { text: t(late ? "hoursLate" : "hoursLeft", { n: hours }), late };
  return { text: t(late ? "daysLate" : "daysLeft", { n: Math.round(hours / 24) }), late };
}
