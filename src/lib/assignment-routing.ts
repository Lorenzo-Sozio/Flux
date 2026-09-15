import { roundRobinScope } from "@/lib/round-robin";
import { covers, fold, type Located, type TerritoryRule } from "@/lib/territory";

/**
 * Which rotation a new record is handed out from, by where it is and where it came from.
 *
 * Used by the automation action `assign_owner`. A rule carries an ordered list of
 * routes — "Lombardia, from the website → Anna and Bruno" — and a general rotation
 * for everything no route takes.
 *
 * ⚠️⚠️ **Routes live inside one action, in order, and not as separate rules.**
 * Automation rules run in parallel. Two rules both assigning the same lead would
 * race: whichever wrote first would win, at random, and the loser would still have
 * used up a turn in its rotation. One ordered list evaluated in one place is the
 * only way "the first match wins" means anything.
 *
 * ⚠️ A route's territories are matched with `covers`, not with the single narrowest
 * territory the report uses. A route for "Lombardia" should take a Milan lead even
 * if a narrower "Milano centro" territory exists for reporting; whoever wants Milan
 * handled differently puts that route first.
 */

export interface AssignmentRoute {
  /** Stable across edits, so the route keeps its own place in its rotation. */
  id: string;
  territoryIds: string[];
  sources: string[];
  userIds: string[];
}

export interface Routable extends Located {
  source?: string | null;
}

/** The sequence a route's rotation advances through. The general rotation keeps the rule's own. */
export function routeScope(ruleId: string, routeId: string | null): string {
  return routeId === null ? roundRobinScope(ruleId) : `${roundRobinScope(ruleId)}:${routeId}`;
}

/** Whether a route takes this record. A route with no criteria takes nothing. */
export function routeTakes(route: AssignmentRoute, record: Routable, territories: readonly TerritoryRule[]): boolean {
  if (route.territoryIds.length === 0 && route.sources.length === 0) return false;

  if (route.territoryIds.length) {
    const listed = territories.filter((t) => route.territoryIds.includes(t.id));
    // A territory deleted since the rule was written covers nothing. It must not
    // turn the route into one that takes every record.
    if (!listed.some((t) => covers(t, record))) return false;
  }

  if (route.sources.length) {
    const source = record.source ? fold(record.source) : "";
    if (!source || !route.sources.some((s) => fold(s) === source)) return false;
  }
  return true;
}

export interface Candidate {
  /** Null for the general rotation. */
  routeId: string | null;
  userIds: string[];
}

/**
 * The rotations that could take this record, in the order they should be tried:
 * every matching route as written, then the general rotation.
 *
 * More than one because a matching route whose people have all left the workspace
 * must not swallow the record: it falls through to the next.
 */
export function candidatesFor(
  record: Routable,
  routes: readonly AssignmentRoute[],
  territories: readonly TerritoryRule[],
  general: readonly string[],
): Candidate[] {
  const out: Candidate[] = routes
    .filter((r) => routeTakes(r, record, territories))
    .map((r) => ({ routeId: r.id, userIds: r.userIds }));
  if (general.length) out.push({ routeId: null, userIds: [...general] });
  return out;
}
