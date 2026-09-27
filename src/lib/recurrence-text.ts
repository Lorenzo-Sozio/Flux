/**
 * A repeating appointment described in words: the picker's options, the detail
 * panel and the invitation email all read this, so the three never describe one
 * series three ways.
 *
 * Pure: the translator is passed in, from `useTranslations("appointment")` on a
 * screen or `getTranslations` on the server.
 */

import { type Recurrence, WEEKDAYS, type Weekday, weekdayIn } from "@/lib/recurrence";

type T = (key: string, values?: Record<string, string | number>) => string;

/** The day's name in the locale. 1 January 2024 was a Monday. */
export function weekdayName(day: Weekday, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(
    Date.UTC(2024, 0, 1 + WEEKDAYS.indexOf(day)),
  );
}

function list(items: string[], locale: string): string {
  try {
    return new Intl.ListFormat(locale, { type: "conjunction" }).format(items);
  } catch {
    return items.join(", ");
  }
}

const WORKWEEK: readonly Weekday[] = ["MO", "TU", "WE", "TH", "FR"];

export function isWorkweek(rule: Recurrence): boolean {
  return (
    rule.freq === "WEEKLY" &&
    rule.interval === 1 &&
    rule.byDay?.length === WORKWEEK.length &&
    WORKWEEK.every((d) => rule.byDay?.includes(d))
  );
}

/** "Every 2 weeks on Monday and Thursday, 10 times". */
export function describeRecurrence(
  t: T,
  rule: Recurrence,
  start: Date,
  timeZone: string,
  locale: string,
  options: { withEnd?: boolean } = {},
): string {
  const n = rule.interval;
  let text: string;
  if (isWorkweek(rule)) {
    text = t("recurrence.weekdays");
  } else if (rule.freq === "DAILY") {
    text = t("recurrence.daily", { n });
  } else if (rule.freq === "WEEKLY") {
    const days = rule.byDay?.length ? rule.byDay : [weekdayIn(start, timeZone)];
    text = t("recurrence.weekly", {
      n,
      days: list(
        days.map((d) => weekdayName(d, locale)),
        locale,
      ),
    });
  } else if (rule.freq === "MONTHLY" && rule.nthWeekday) {
    const { n: nth, day } = rule.nthWeekday;
    text = t("recurrence.monthlyNth", {
      n,
      // Italian agrees the ordinal with the day: "la prima domenica", "il primo lunedì".
      ordinal: t(`recurrence.ordinal.${day === "SU" ? "f" : "m"}.${nth === -1 ? "last" : nth}`),
      weekday: weekdayName(day, locale),
    });
  } else if (rule.freq === "MONTHLY") {
    const day = Number(new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone }).format(start));
    text = t("recurrence.monthlyDay", { n, day });
  } else {
    const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone }).format(start);
    text = t("recurrence.yearly", { n, date });
  }

  if (options.withEnd === false) return text;
  if (rule.count) return `${text}, ${t("recurrence.count", { count: rule.count })}`;
  if (rule.until) {
    const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone }).format(
      rule.until,
    );
    return `${text}, ${t("recurrence.until", { date })}`;
  }
  return text;
}
