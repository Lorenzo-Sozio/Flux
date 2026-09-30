/**
 * "3 min ago", "yesterday", in the interface language — for the recents and the bell, where the
 * question is how long ago, not the date.
 */
export function relativeTime(at: number | string | Date, locale: string, now = Date.now()): string {
  const time = at instanceof Date ? at.getTime() : typeof at === "string" ? Date.parse(at) : at;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const mins = Math.round((time - now) / 60_000);
  if (Math.abs(mins) < 60) return rtf.format(mins, "minute");
  const hours = Math.round(mins / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, "hour");
  return rtf.format(Math.round(hours / 24), "day");
}

export type DayBucket = "today" | "yesterday" | "week" | "older";

/** Which heading a moment goes under, by the reader's own calendar days. */
export function dayBucket(at: number | string | Date, now = new Date()): DayBucket {
  const time = new Date(at);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86_400_000;
  const t = time.getTime();
  if (t >= startOfToday) return "today";
  if (t >= startOfToday - day) return "yesterday";
  if (t >= startOfToday - 6 * day) return "week";
  return "older";
}
