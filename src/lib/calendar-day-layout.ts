/**
 * How the calendar's day view is drawn: a "list" — the day's appointments one under
 * another, the free time between them named — or the hour "grid".
 *
 * ⚠️ On a phone the grid is seven in the morning to ten at night at 64px an hour, about
 * 960px, whatever the day holds: two meetings meant scrolling a screen and a half to see
 * them both. So a phone that has not chosen gets the list, and from md up the grid stays
 * (null below: the page draws both and CSS picks, like the default week). A choice is
 * remembered for this browser.
 *
 * A module of its own, not the toggle's file: a constant exported from a "use client" file
 * reaches a server component as a client reference, not as the value.
 */
export type DayLayout = "list" | "grid";

export const DAY_LAYOUT_COOKIE = "flux_cal_day";

export function parseDayLayout(value: string | undefined): DayLayout | null {
  return value === "list" || value === "grid" ? value : null;
}

/** The address wins, then this browser's last choice; null is "list on a phone, grid above". */
export function resolveDayLayout(fromUrl: string | undefined, remembered: string | undefined): DayLayout | null {
  return parseDayLayout(fromUrl) ?? parseDayLayout(remembered);
}
