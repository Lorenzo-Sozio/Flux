import { fromWallValue, toWallDate } from "@/lib/wall-clock";

/**
 * A month, a quarter or a year, named as sales targets name them: `2026-09`, `2026-Q3`,
 * `2026` (`sales_target.period`).
 *
 * The scorecard is read per calendar period because that is what a target is set for, and
 * its figures link to the board with the same key (`closed=`), so the list a number opens
 * is the list the number counted. Bounds are on the workspace's clock: a deal won at 00:30
 * on the first of the month belongs to that month in Rome, whatever the server's zone.
 *
 * Pure: read by server actions and by the client that draws the period picker.
 */

export type PeriodKind = "month" | "quarter" | "year";

export interface CalendarPeriod {
  kind: PeriodKind;
  year: number;
  /** 1–12 for a month, 1–4 for a quarter, 0 for a year. */
  index: number;
}

const KEY = /^(\d{4})(?:-(0[1-9]|1[0-2])|-Q([1-4]))?$/;

export function parsePeriodKey(key: string | null | undefined): CalendarPeriod | null {
  const m = KEY.exec((key ?? "").trim());
  if (!m) return null;
  const year = Number(m[1]);
  if (year < 2000 || year > 2100) return null;
  if (m[2]) return { kind: "month", year, index: Number(m[2]) };
  if (m[3]) return { kind: "quarter", year, index: Number(m[3]) };
  return { kind: "year", year, index: 0 };
}

export function periodKey(p: CalendarPeriod): string {
  if (p.kind === "month") return `${p.year}-${String(p.index).padStart(2, "0")}`;
  if (p.kind === "quarter") return `${p.year}-Q${p.index}`;
  return String(p.year);
}

/** The months a period covers, as month keys, in order. */
export function monthKeysOf(key: string): string[] {
  const p = parsePeriodKey(key);
  if (!p) return [];
  const first = p.kind === "month" ? p.index : p.kind === "quarter" ? (p.index - 1) * 3 + 1 : 1;
  const count = p.kind === "month" ? 1 : p.kind === "quarter" ? 3 : 12;
  return Array.from({ length: count }, (_, i) => periodKey({ kind: "month", year: p.year, index: first + i }));
}

/** The period of `kind` containing `now`, on the workspace's clock. */
export function currentPeriodKey(kind: PeriodKind, now: Date, timeZone: string): string {
  const [year, month] = toWallDate(now, timeZone).split("-").map(Number);
  if (kind === "month") return periodKey({ kind, year, index: month });
  if (kind === "quarter") return periodKey({ kind, year, index: Math.ceil(month / 3) });
  return periodKey({ kind, year, index: 0 });
}

/** The period `n` steps away of the same kind: the month before, the next quarter. */
export function shiftPeriod(key: string, n: number): string | null {
  const p = parsePeriodKey(key);
  if (!p) return null;
  if (p.kind === "year") return periodKey({ ...p, year: p.year + n });
  const per = p.kind === "month" ? 12 : 4;
  const flat = p.year * per + (p.index - 1) + n;
  return periodKey({ kind: p.kind, year: Math.floor(flat / per), index: (flat % per) + 1 });
}

/** From the first instant of the period to the first instant after it, in `timeZone`. */
export function periodBounds(key: string, timeZone: string): { from: Date; to: Date } | null {
  const months = monthKeysOf(key);
  if (months.length === 0) return null;
  const after = shiftPeriod(months[months.length - 1], 1) as string;
  const from = fromWallValue(`${months[0]}-01`, timeZone);
  const to = fromWallValue(`${after}-01`, timeZone);
  return from && to ? { from, to } : null;
}

/**
 * One person's target for a period, from their `sales_target` rows.
 *
 * A target written for the period itself wins. Otherwise a quarter is its months and a
 * year its quarters, each resolved the same way — so a person given monthly targets has a
 * quarterly one without anybody typing it twice, and one given both is not counted twice.
 * Null when nothing covers the period: "no target" is not a target of zero.
 */
export function targetFor(rows: readonly { period: string; amount: number }[], key: string): number | null {
  const own = rows.filter((r) => r.period === key);
  if (own.length > 0) return own.reduce((s, r) => s + r.amount, 0);
  const p = parsePeriodKey(key);
  if (!p || p.kind === "month") return null;
  const parts =
    p.kind === "quarter"
      ? monthKeysOf(key)
      : [1, 2, 3, 4].map((q) => periodKey({ kind: "quarter", year: p.year, index: q }));
  const resolved = parts.map((part) => targetFor(rows, part)).filter((v): v is number => v !== null);
  return resolved.length > 0 ? resolved.reduce((s, v) => s + v, 0) : null;
}

/** The period of another kind that starts where `key` starts: September → Q3 → 2026, and back to its first month. */
export function periodOfKind(key: string, kind: PeriodKind): string | null {
  const first = parsePeriodKey(monthKeysOf(key)[0]);
  if (!first) return null;
  if (kind === "month") return periodKey(first);
  if (kind === "quarter") return periodKey({ kind, year: first.year, index: Math.ceil(first.index / 3) });
  return periodKey({ kind, year: first.year, index: 0 });
}
