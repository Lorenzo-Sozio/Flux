/**
 * Whose calendar is on screen: everybody, me, my group, or the people chosen.
 *
 * One URL value, `filter`, so every link the calendar builds (a day, the next week,
 * today) carries the choice without a second parameter to forget:
 *   all · mine · group · u:<id>,<id>,…
 *
 * No membership check is needed on the ids: each workspace has its own database, so
 * an id from elsewhere matches nothing, and everybody in a workspace sees all of its
 * records (decision D-D). They are only cleaned, so a hand-typed address cannot turn
 * into a query with a thousand parameters.
 */

export type CalendarFilter = "all" | "mine" | "group" | `u:${string}`;

const PEOPLE_PREFIX = "u:";
/** More people than this at once is not a calendar anybody can read. */
export const MAX_PEOPLE = 12;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The people a `u:` filter names, cleaned; null for the other filters. */
export function peopleOf(filter: string | null | undefined): string[] | null {
  if (!filter?.startsWith(PEOPLE_PREFIX)) return null;
  const ids = filter
    .slice(PEOPLE_PREFIX.length)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => ID.test(s));
  return [...new Set(ids)].slice(0, MAX_PEOPLE);
}

/** The filter for these people; nobody chosen is everybody. */
export function peopleFilter(ids: readonly string[]): CalendarFilter {
  const clean = peopleOf(`${PEOPLE_PREFIX}${ids.join(",")}`) ?? [];
  return clean.length === 0 ? "all" : `u:${clean.join(",")}`;
}

/** Whatever arrived in the address, as a filter the page can run on. */
export function parseCalendarFilter(raw: string | null | undefined): CalendarFilter {
  if (raw === "mine" || raw === "group") return raw;
  const people = peopleOf(raw);
  return people ? peopleFilter(people) : "all";
}

/**
 * A colour per chosen person, in the order they were chosen, so the same person
 * keeps theirs while others are added or removed after them. Static class names,
 * because Tailwind only ships classes it can read in the source.
 */
export const PERSON_STYLES = [
  { border: "border-l-rose-500", dot: "bg-rose-500" },
  { border: "border-l-sky-500", dot: "bg-sky-500" },
  { border: "border-l-lime-600", dot: "bg-lime-600" },
  { border: "border-l-fuchsia-500", dot: "bg-fuchsia-500" },
  { border: "border-l-orange-500", dot: "bg-orange-500" },
  { border: "border-l-teal-500", dot: "bg-teal-500" },
  { border: "border-l-indigo-500", dot: "bg-indigo-500" },
  { border: "border-l-yellow-500", dot: "bg-yellow-500" },
  { border: "border-l-cyan-600", dot: "bg-cyan-600" },
  { border: "border-l-pink-400", dot: "bg-pink-400" },
  { border: "border-l-emerald-600", dot: "bg-emerald-600" },
  { border: "border-l-violet-400", dot: "bg-violet-400" },
] as const;

/**
 * Whose colour an event wears when several people are on screen: the first of the
 * chosen people (in the order chosen) who is involved in it. Null when only one
 * person is chosen — there is nobody to tell apart — or none of them is involved.
 */
export function personIndexFor(involved: readonly string[], chosen: readonly string[] | null): number | null {
  if (!chosen || chosen.length < 2) return null;
  const at = chosen.findIndex((id) => involved.includes(id));
  return at === -1 ? null : at % PERSON_STYLES.length;
}
