/**
 * pipeline-filters.ts — what every Pipeline page can be narrowed by, read from the URL.
 *
 * The board, the forecast, the funnel, win/loss, targets, territories and the
 * report each answered "for whom" and "since when" differently or not at all: two
 * had a period, with different options and different parameter names, and none
 * could be looked at for one agent. A sales manager reviewing one person's month
 * had no way to do it. Now there is one set of parameters, parsed here, applied in
 * SQL by `ownerCondition`, and drawn by one bar (src/components/crm/pipeline-filter-bar.tsx):
 *
 *   owners=a,b,none   agents; `none` means deals nobody owns. Absent, or `all`, means everyone.
 *   period=90         days back, from PERIOD_OPTIONS.
 *   status=open       board only: open, won, lost. Absent means all.
 *   q=text            board only: deal name.
 *
 * Pure: imported by server actions and by the client bar alike.
 */

import { type AnyColumn, inArray, isNull, or, type SQL } from "drizzle-orm";

/** The owner token for "nobody". Not a valid user id, so it cannot collide with one. */
export const UNASSIGNED = "none";
/** Every agent ticked. Filters nothing, but the bar shows every box checked rather than none. */
export const ALL_OWNERS = "all";

export const PERIOD_OPTIONS = [30, 90, 180, 365] as const;
export type PeriodDays = (typeof PERIOD_OPTIONS)[number];

export const DEAL_STATUS_FILTERS = ["open", "won", "lost"] as const;
export type DealStatusFilter = (typeof DEAL_STATUS_FILTERS)[number];

/** Which controls a page shows. Territory, funnel and win/loss have a period; the board has status and search. */
export type PipelineFilterControl = "owners" | "period" | "status" | "q";

export interface PipelineFilters {
  owners: string[];
  period: PeriodDays;
  status: DealStatusFilter | null;
  q: string;
}

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

const MAX_OWNERS = 100;
const ID = /^[\w-]{1,64}$/;

function first(params: Params, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const v = params[key];
  return Array.isArray(v) ? v[0] : v;
}

/** The agents in the URL, deduplicated; anything that could not be an id is dropped. */
export function parseOwners(raw: string | undefined | null): string[] {
  if (!raw || raw === ALL_OWNERS) return [];
  const out = new Set<string>();
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (ID.test(id)) out.add(id);
    if (out.size >= MAX_OWNERS) break;
  }
  return [...out];
}

export function parsePipelineFilters(params: Params, defaults: { period?: PeriodDays } = {}): PipelineFilters {
  const period = Number(first(params, "period"));
  const status = first(params, "status");
  return {
    owners: parseOwners(first(params, "owners")),
    period: (PERIOD_OPTIONS as readonly number[]).includes(period) ? (period as PeriodDays) : (defaults.period ?? 90),
    status: (DEAL_STATUS_FILTERS as readonly string[]).includes(status ?? "") ? (status as DealStatusFilter) : null,
    q: (first(params, "q") ?? "").trim().slice(0, 100),
  };
}

/**
 * The owners as a URL value. Nothing ticked is no parameter; everything ticked is
 * `all` rather than every id, which keeps the URL short and — like no parameter —
 * filters nothing, so a deal whose owner is missing from the list is not hidden.
 */
export function ownersParam(selected: readonly string[], everyone: readonly string[]): string | null {
  if (selected.length === 0) return null;
  const chosen = new Set(selected);
  if (everyone.length > 0 && everyone.every((id) => chosen.has(id))) return ALL_OWNERS;
  return selected.join(",");
}

/**
 * The owner filter as a WHERE fragment, or undefined for everyone.
 *
 * ⚠️ `none` is `IS NULL`, not `IN (NULL)`: `owner_id IN (NULL)` is never true, so
 * deals nobody owns would silently vanish from a filter that asked for them.
 */
export function ownerCondition(column: AnyColumn, owners: readonly string[]): SQL | undefined {
  if (owners.length === 0) return undefined;
  const ids = owners.filter((o) => o !== UNASSIGNED);
  const unassigned = owners.includes(UNASSIGNED);
  if (ids.length > 0 && unassigned) return or(inArray(column, ids), isNull(column));
  if (unassigned) return isNull(column);
  return inArray(column, ids);
}

/** The start of the period. */
export function periodStart(days: number, now = Date.now()): Date {
  return new Date(now - days * 86_400_000);
}

export interface PipelineView {
  key: "board" | "forecast" | "funnel" | "winLoss" | "targets" | "territories" | "report";
  path: string;
  controls: readonly PipelineFilterControl[];
  /** The period shown when the URL names none. */
  defaultPeriod?: PeriodDays;
}

/**
 * The Pipeline pages, in the order the tabs show them, and what each can be
 * narrowed by. The period is on the date things happened: created for the funnel,
 * closed for win/loss and the report; the forecast looks forward and has none.
 */
export const PIPELINE_VIEWS: readonly PipelineView[] = [
  { key: "board", path: "/dashboard/pipeline", controls: ["owners", "status", "q"] },
  { key: "forecast", path: "/dashboard/pipeline/forecast", controls: ["owners"] },
  { key: "funnel", path: "/dashboard/pipeline/funnel", controls: ["owners", "period"], defaultPeriod: 90 },
  { key: "winLoss", path: "/dashboard/pipeline/win-loss", controls: ["owners", "period"], defaultPeriod: 365 },
  { key: "targets", path: "/dashboard/pipeline/targets", controls: ["owners"] },
  { key: "territories", path: "/dashboard/pipeline/territories", controls: ["owners", "period"], defaultPeriod: 90 },
  { key: "report", path: "/dashboard/pipeline/report", controls: ["owners", "period"], defaultPeriod: 365 },
];

export function pipelineView(key: PipelineView["key"]): PipelineView {
  return PIPELINE_VIEWS.find((v) => v.key === key) as PipelineView;
}

/** The view a path belongs to; a deal's own page belongs to none. */
export function pipelineViewAt(pathname: string): PipelineView | null {
  return PIPELINE_VIEWS.find((v) => v.path === pathname.replace(/\/$/, "")) ?? null;
}
