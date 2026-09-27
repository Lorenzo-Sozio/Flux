import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";

import { activities, deals, salesTargets } from "@/db/schema";
import { monthKeysOf, parsePeriodKey, periodBounds, periodKey, targetFor } from "@/lib/calendar-period";
import { closedBetween, dealEur, winRatePercent } from "@/lib/metrics";
import { ownerCondition, UNASSIGNED } from "@/lib/pipeline-filters";

/**
 * One row per salesperson for a calendar period: the view a sales manager asks for first
 * (§11.2) — HubSpot's "Sales rep productivity", Pipedrive's "Insights".
 *
 * ⚠️⚠️ Every figure is the one the rest of the product shows (src/lib/metrics.ts): won is
 * dated by `closedAt`, the win rate is won over decided in the same period, values are EUR.
 * A scorecard that disagreed with the pipeline pages about the same person's month would
 * be worse than none.
 *
 * ⚠️ Five grouped statements whatever the size of the team. The report it replaces ran
 * three queries per person, which on a Worker is a subrequest budget spent on a table.
 *
 * - **Coverage** is open pipeline over what is left of the target: 3× says there is three
 *   times as much in play as still needs winning. Null with no target, or none left to win.
 * - **Cycle** is the average days from creation to win, over the deals won in the period.
 * - **Open** is what is open now, whatever the period: pipeline has no past.
 */

// biome-ignore lint/suspicious/noExplicitAny: Drizzle's database types differ per driver
type AnyDb = any;

export interface ScorecardMember {
  id: string;
  name: string | null;
  email: string | null;
  /** No longer in the workspace: shown only when the period has figures for them. */
  former?: boolean;
}

export interface ScorecardRow {
  /** A user id, or `none` (UNASSIGNED) for deals nobody owns. */
  ownerId: string;
  name: string;
  former: boolean;
  won: number;
  wonValue: number;
  lost: number;
  winRate: number | null;
  avgWon: number | null;
  cycleDays: number | null;
  open: number;
  openValue: number;
  target: number | null;
  /** Won as a share of the target, in whole percent. */
  attainment: number | null;
  /** Open value over what is left of the target, one decimal. */
  coverage: number | null;
  calls: number;
  meetings: number;
  emails: number;
}

const COUNTED_ACTIVITIES = ["call", "meeting", "email"] as const;

export async function repScorecard(
  db: AnyDb,
  input: { period: string; timeZone: string; members: readonly ScorecardMember[]; owners?: readonly string[] },
): Promise<{ period: string; rows: ScorecardRow[]; totals: ScorecardRow } | null> {
  const parsed = parsePeriodKey(input.period);
  const bounds = periodBounds(input.period, input.timeZone);
  if (!parsed || !bounds) return null;
  const owners = input.owners ?? [];
  const last = new Date(bounds.to.getTime() - 1);

  // Every key a target for this period could be written under.
  const months = monthKeysOf(input.period);
  const quarters = [
    ...new Set(
      months.map((m) => periodKey({ kind: "quarter", year: parsed.year, index: Math.ceil(Number(m.slice(5)) / 3) })),
    ),
  ];
  const targetKeys = [...new Set([input.period, ...months, ...quarters, String(parsed.year)])];

  const [closedRows, openRows, activityRows, targetRows] = await Promise.all([
    db
      .select({
        ownerId: deals.ownerId,
        won: sql<number>`count(*) filter (where ${deals.status} = 'won')::int`,
        wonValue: sql<number>`coalesce(sum(${dealEur}) filter (where ${deals.status} = 'won'), 0)`,
        lost: sql<number>`count(*) filter (where ${deals.status} = 'lost')::int`,
        cycleDays: sql<
          number | null
        >`avg(extract(epoch from (${deals.closedAt} - ${deals.createdAt})) / 86400) filter (where ${deals.status} = 'won')`,
      })
      .from(deals)
      .where(
        and(
          sql`(${closedBetween("won", bounds.from, last)} or ${closedBetween("lost", bounds.from, last)})`,
          ownerCondition(deals.ownerId, owners),
        ),
      )
      .groupBy(deals.ownerId),
    db
      .select({
        ownerId: deals.ownerId,
        open: sql<number>`count(*)::int`,
        openValue: sql<number>`coalesce(sum(${dealEur}), 0)`,
      })
      .from(deals)
      .where(and(eq(deals.status, "open"), ownerCondition(deals.ownerId, owners)))
      .groupBy(deals.ownerId),
    db
      .select({ ownerId: activities.ownerId, type: activities.type, n: sql<number>`count(*)::int` })
      .from(activities)
      .where(
        and(
          inArray(activities.type, [...COUNTED_ACTIVITIES]),
          gte(sql`coalesce(${activities.date}, ${activities.createdAt})`, bounds.from),
          lt(sql`coalesce(${activities.date}, ${activities.createdAt})`, bounds.to),
          ownerCondition(activities.ownerId, owners),
        ),
      )
      .groupBy(activities.ownerId, activities.type),
    db
      .select({ userId: salesTargets.userId, period: salesTargets.period, amount: salesTargets.targetAmount })
      .from(salesTargets)
      .where(and(inArray(salesTargets.period, targetKeys), ownerCondition(salesTargets.userId, owners))),
  ]);

  const key = (id: string | null) => id ?? UNASSIGNED;
  const blank = (ownerId: string, name: string, former: boolean): ScorecardRow => ({
    ownerId,
    name,
    former,
    won: 0,
    wonValue: 0,
    lost: 0,
    winRate: null,
    avgWon: null,
    cycleDays: null,
    open: 0,
    openValue: 0,
    target: null,
    attainment: null,
    coverage: null,
    calls: 0,
    meetings: 0,
    emails: 0,
  });

  const byOwner = new Map<string, ScorecardRow>();
  const memberById = new Map(input.members.map((m) => [m.id, m]));
  const row = (id: string | null): ScorecardRow => {
    const k = key(id);
    let r = byOwner.get(k);
    if (!r) {
      const m = memberById.get(k);
      r = blank(k, m ? (m.name ?? m.email ?? k) : k, m ? Boolean(m.former) : k !== UNASSIGNED);
      byOwner.set(k, r);
    }
    return r;
  };

  // Everyone currently in the workspace has a row, with or without figures — a salesperson
  // with nothing this month is the row the manager most needs to see. Narrowed to the
  // owners asked for, when some were.
  for (const m of input.members) {
    if (m.former) continue;
    if (owners.length > 0 && !owners.includes(m.id)) continue;
    row(m.id);
  }

  let cycleWeighted = 0;
  for (const c of closedRows as {
    ownerId: string | null;
    won: number;
    wonValue: unknown;
    lost: number;
    cycleDays: unknown;
  }[]) {
    const r = row(c.ownerId);
    r.won = Number(c.won);
    r.wonValue = Number(c.wonValue);
    r.lost = Number(c.lost);
    r.cycleDays = c.cycleDays === null ? null : Math.round(Number(c.cycleDays));
    cycleWeighted += c.cycleDays === null ? 0 : Number(c.cycleDays) * Number(c.won);
  }
  for (const o of openRows as { ownerId: string | null; open: number; openValue: unknown }[]) {
    const r = row(o.ownerId);
    r.open = Number(o.open);
    r.openValue = Number(o.openValue);
  }
  for (const a of activityRows as { ownerId: string | null; type: string; n: number }[]) {
    // An activity nobody logged (a customer's email) is not anybody's work.
    if (a.ownerId === null) continue;
    const r = row(a.ownerId);
    if (a.type === "call") r.calls = Number(a.n);
    else if (a.type === "meeting") r.meetings = Number(a.n);
    else r.emails = Number(a.n);
  }
  const targetsByUser = new Map<string, { period: string; amount: number }[]>();
  for (const t of targetRows as { userId: string; period: string; amount: unknown }[]) {
    const list = targetsByUser.get(t.userId) ?? [];
    list.push({ period: t.period, amount: Number(t.amount) });
    targetsByUser.set(t.userId, list);
  }
  for (const [userId, list] of targetsByUser) {
    const target = targetFor(list, input.period);
    if (target !== null) row(userId).target = target;
  }

  const derive = (r: ScorecardRow) => {
    r.winRate = winRatePercent(r.won, r.lost);
    r.avgWon = r.won > 0 ? r.wonValue / r.won : null;
    r.attainment = r.target && r.target > 0 ? Math.round((r.wonValue / r.target) * 100) : null;
    const left = r.target === null ? null : r.target - r.wonValue;
    r.coverage = left !== null && left > 0 ? Math.round((r.openValue / left) * 10) / 10 : null;
  };
  const rows = [...byOwner.values()];
  for (const r of rows) derive(r);

  const totals = blank("total", "", false);
  for (const r of rows) {
    totals.won += r.won;
    totals.wonValue += r.wonValue;
    totals.lost += r.lost;
    totals.open += r.open;
    totals.openValue += r.openValue;
    totals.calls += r.calls;
    totals.meetings += r.meetings;
    totals.emails += r.emails;
    if (r.target !== null) totals.target = (totals.target ?? 0) + r.target;
  }
  derive(totals);
  totals.cycleDays = totals.won > 0 ? Math.round(cycleWeighted / totals.won) : null;
  // ⚠️ Against the target, only the people who have one: everybody's wins over some
  // people's targets would read as the team beating a target nobody set for it.
  if (totals.target !== null && totals.target > 0) {
    const targeted = rows.filter((r) => r.target !== null);
    const won = targeted.reduce((s, r) => s + r.wonValue, 0);
    const open = targeted.reduce((s, r) => s + r.openValue, 0);
    totals.attainment = Math.round((won / totals.target) * 100);
    const left = totals.target - won;
    totals.coverage = left > 0 ? Math.round((open / left) * 10) / 10 : null;
  }

  // Most won first; then who has most in play; nobody's deals last.
  rows.sort(
    (a, b) =>
      Number(a.ownerId === UNASSIGNED) - Number(b.ownerId === UNASSIGNED) ||
      b.wonValue - a.wonValue ||
      b.openValue - a.openValue ||
      a.name.localeCompare(b.name),
  );
  return { period: input.period, rows, totals };
}
