/**
 * recent-records.ts — the handful of records this person keeps coming back to.
 *
 * The palette at rest showed seven links to the module index pages, which is the
 * sidebar again in a smaller box (audit rilievo S-01). What a person actually
 * wants there is the thing they had open twenty minutes ago.
 *
 * Kept in the browser, per person and per device, because that is what it is: a
 * convenience, not data. Every access is guarded — a private window, cleared site
 * data, or a browser set to refuse storage all throw rather than return empty —
 * and losing it costs nothing.
 */

const KEY = "flux.recent-records";
const LIMIT = 6;

export interface RecentRecord {
  id: string;
  label: string;
  sub?: string | null;
  url: string;
  entity: string;
  /** When it was last opened, so the list stays in the order it is useful in. */
  at: number;
}

export function readRecentRecords(): RecentRecord[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((r): r is RecentRecord => typeof r?.id === "string" && typeof r?.url === "string")
      .sort((a, b) => b.at - a.at)
      .slice(0, LIMIT);
  } catch {
    return [];
  }
}

/**
 * Remembers one, most recent first.
 *
 * Re-opening something moves it to the top rather than adding it twice, which is
 * the whole reason the list is worth having.
 */
export function rememberRecord(record: Omit<RecentRecord, "at">): void {
  try {
    const existing = readRecentRecords().filter((r) => r.id !== record.id);
    const next = [{ ...record, at: Date.now() }, ...existing].slice(0, LIMIT);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // A browser that will not store this is not a problem worth reporting: the
    // palette simply has nothing to show at rest, which is where it started.
  }
}
