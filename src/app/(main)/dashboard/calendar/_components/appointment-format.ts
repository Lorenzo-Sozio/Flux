/**
 * The small pieces of wording the appointment form and the detail panel share,
 * so the two never describe the same reminder or duration differently.
 */

type T = (key: string, values?: Record<string, string | number>) => string;

/** Lead times offered for a reminder, in minutes. */
export const REMINDER_OPTIONS = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080] as const;

/** Lengths offered as one-click durations, in minutes. */
export const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120] as const;

/** "At the start", "30 minutes before", "2 hours before", "1 day before". */
export function reminderLabel(t: T, minutes: number): string {
  if (minutes === 0) return t("fields.reminderAtStart");
  if (minutes % 1440 === 0) return t("fields.reminderDays", { count: minutes / 1440 });
  if (minutes % 60 === 0) return t("fields.reminderHours", { count: minutes / 60 });
  return t("fields.reminderMinutes", { count: minutes });
}

/** "45 min", "1 h", "1 h 30 min", "2 d 3 h". */
export function durationLabel(t: T, totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d > 0) return h > 0 ? t("duration.daysHours", { d, h }) : t("duration.days", { d });
  if (h > 0) return m > 0 ? t("duration.hoursMinutes", { h, m }) : t("duration.hours", { h });
  return t("duration.minutes", { m });
}

/**
 * Fired by a click on an empty slot of the calendar grid, heard by the page's
 * create dialog. An event rather than a URL so the same slot can be clicked
 * twice, and so choosing a time costs no round trip to the server.
 *
 * `start` is a wall-clock value on the workspace's clock, like every time the
 * grid and the form exchange.
 */
export const NEW_APPOINTMENT_EVENT = "flux:new-appointment";

export type NewAppointmentDetail = { start: string; allDay?: boolean };
