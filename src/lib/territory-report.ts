import { type Located, type TerritoryRule, territoryOf } from "@/lib/territory";

/**
 * Figures rolled up by territory.
 *
 * The database groups by distinct address — a few hundred rows however many
 * records there are — and this module maps each address to its territory. The
 * territory is never stored on a record (see src/lib/territory.ts), so this is
 * also what makes a territory edited this morning report correctly for records
 * written last year.
 *
 * ⚠️⚠️ Two rules make the table honest rather than flattering:
 *
 *   * **Every territory is a row, including the ones with nothing in them.** A
 *     territory missing from the table reads as "not set up", when the fact worth
 *     seeing is that it has no pipeline.
 *   * **Records in no territory are a row too, and it is always there.** Dropping
 *     them would make the totals quietly smaller than the pipeline page's, and the
 *     share nobody covers is exactly what a territory plan is for finding.
 */

export interface TerritoryFigures {
  openLeads: number;
  newLeads: number;
  convertedLeads: number;
  openDeals: number;
  openValue: number;
  wonDeals: number;
  wonValue: number;
  lostDeals: number;
}

export const NO_FIGURES: TerritoryFigures = {
  openLeads: 0,
  newLeads: 0,
  convertedLeads: 0,
  openDeals: 0,
  openValue: 0,
  wonDeals: 0,
  wonValue: 0,
  lostDeals: 0,
};

export interface TerritoryRow {
  /** Null for the records no territory covers. */
  territoryId: string | null;
  name: string | null;
  figures: TerritoryFigures;
  /** Of the deals that closed in the period; null when none did. */
  winRate: number | null;
}

const blank = (v: string | null | undefined) => !v || v.trim() === "";

/**
 * Where a deal is: its company's address, or its contact's when the company has
 * none. A deal has no address of its own.
 *
 * ⚠️ Whole address from one record or the other, never mixed: the company's
 * country with the contact's province is a place neither of them is in.
 */
export function placeOfDeal(company: Located, contact: Located): Located {
  const hasAny = (p: Located) => !blank(p.country) || !blank(p.state) || !blank(p.zipCode);
  return hasAny(company) ? company : contact;
}

/** Postgres returns counts and sums as strings; a missing sum as null. */
function num(v: unknown): number {
  return Number(v ?? 0);
}

export function rollUp(
  rows: readonly { place: Located; figures: Partial<Record<keyof TerritoryFigures, unknown>> }[],
  rules: readonly TerritoryRule[],
): TerritoryRow[] {
  const byId = new Map<string | null, TerritoryFigures>();
  for (const rule of rules) byId.set(rule.id, { ...NO_FIGURES });
  byId.set(null, { ...NO_FIGURES });

  for (const row of rows) {
    const id = territoryOf(row.place, rules)?.id ?? null;
    const into = byId.get(id) as TerritoryFigures;
    for (const key of Object.keys(NO_FIGURES) as (keyof TerritoryFigures)[]) {
      into[key] += num(row.figures[key]);
    }
  }

  const named = rules
    .map((rule) => toRow(rule.id, rule.name, byId.get(rule.id) as TerritoryFigures))
    .sort((a, b) => b.figures.openValue - a.figures.openValue || (a.name ?? "").localeCompare(b.name ?? ""));
  return [...named, toRow(null, null, byId.get(null) as TerritoryFigures)];
}

function toRow(territoryId: string | null, name: string | null, figures: TerritoryFigures): TerritoryRow {
  const closed = figures.wonDeals + figures.lostDeals;
  return {
    territoryId,
    name,
    figures,
    winRate: closed ? Math.round((figures.wonDeals / closed) * 100) : null,
  };
}
