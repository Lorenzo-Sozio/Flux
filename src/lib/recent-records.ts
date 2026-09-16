/**
 * recent-records.ts — the records this person keeps coming back to.
 *
 * Kept in the browser, per person, per device and per workspace, because that is
 * what it is: a convenience, not data. Every access is guarded — a private window,
 * cleared site data, or a browser set to refuse storage all throw rather than
 * return empty — and losing it costs nothing.
 *
 * ⚠️ There used to be two of these, with two keys and two shapes: one written by
 * the palette, one by four detail pages, neither knowing the workspace. There is
 * one now, fed by `RecordVisit` on every detail page and read by the header list
 * and the palette.
 *
 * ⚠️ Kept per type as well as overall. With one list of fifteen, a morning spent
 * on invoices pushed every contact out of it; each kind keeps its last few, so the
 * list grouped by section still has something in every section it had before.
 */

import { ENTITY_TYPES, type EntityType } from "@/lib/entities";

const PREFIX = "flux.recent.v2:";
export const RECENT_PER_TYPE = 10;
export const RECENT_TOTAL = 80;
/** Notified in this tab when the list changes; `storage` covers the other tabs. */
export const RECENT_EVENT = "flux:recent-records";

export interface RecentRecord {
  type: EntityType;
  id: string;
  label: string;
  sub?: string | null;
  url: string;
  /** When it was last opened, so the list stays in the order it is useful in. */
  at: number;
}

const key = (scope: string) => `${PREFIX}${scope}`;

function isRecord(r: unknown): r is RecentRecord {
  const x = r as RecentRecord;
  return (
    typeof x?.id === "string" &&
    typeof x?.url === "string" &&
    typeof x?.label === "string" &&
    typeof x?.at === "number" &&
    (ENTITY_TYPES as readonly string[]).includes(x?.type)
  );
}

export function readRecentRecords(scope: string | null): RecentRecord[] {
  if (!scope) return [];
  try {
    const raw = window.localStorage.getItem(key(scope));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecord).sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}

/** Keeps the newest `RECENT_PER_TYPE` of each kind, and `RECENT_TOTAL` overall. */
export function trimRecent(records: RecentRecord[]): RecentRecord[] {
  const perType = new Map<string, number>();
  const out: RecentRecord[] = [];
  for (const r of [...records].sort((a, b) => b.at - a.at)) {
    const n = perType.get(r.type) ?? 0;
    if (n >= RECENT_PER_TYPE) continue;
    perType.set(r.type, n + 1);
    out.push(r);
    if (out.length >= RECENT_TOTAL) break;
  }
  return out;
}

function write(scope: string, records: RecentRecord[]) {
  window.localStorage.setItem(key(scope), JSON.stringify(records));
  window.dispatchEvent(new Event(RECENT_EVENT));
}

/**
 * Remembers one, most recent first. Re-opening something moves it to the top
 * rather than adding it twice, which is the whole reason the list is worth having.
 */
export function rememberRecord(scope: string | null, record: Omit<RecentRecord, "at">): void {
  if (!scope) return;
  try {
    const existing = readRecentRecords(scope).filter((r) => !(r.type === record.type && r.id === record.id));
    write(scope, trimRecent([{ ...record, at: Date.now() }, ...existing]));
  } catch {
    // A browser that will not store this is not a problem worth reporting.
  }
}

/** Forgets every record, or only those of the given kinds. */
export function clearRecentRecords(scope: string | null, types?: readonly string[]): void {
  if (!scope) return;
  try {
    const kept = types ? readRecentRecords(scope).filter((r) => !types.includes(r.type)) : [];
    write(scope, kept);
  } catch {
    // Nothing to clear where nothing could be stored.
  }
}
