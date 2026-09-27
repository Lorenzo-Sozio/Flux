/**
 * How late a receivable is, as plain arithmetic on YYYY-MM-DD days (src/lib/receivables.ts).
 *
 * ⚠️ Its own module so the Finance card can import it: receivables.ts carries the schema, and
 * pulling that into the client bundle costs the Worker size budget.
 */

export type AgingBucket = "current" | "1-30" | "31-60" | "61-90" | "90+";
export const AGING_BUCKETS: readonly AgingBucket[] = ["current", "1-30", "31-60", "61-90", "90+"];

/** Days between two YYYY-MM-DD dates, `to` minus `from`. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** How late an amount due on `due` is on `today`: not yet (or today), or by how many days. */
export function agingBucket(due: string, today: string): { bucket: AgingBucket; daysOverdue: number } {
  const late = daysBetween(due, today);
  if (late <= 0) return { bucket: "current", daysOverdue: 0 };
  if (late <= 30) return { bucket: "1-30", daysOverdue: late };
  if (late <= 60) return { bucket: "31-60", daysOverdue: late };
  if (late <= 90) return { bucket: "61-90", daysOverdue: late };
  return { bucket: "90+", daysOverdue: late };
}
