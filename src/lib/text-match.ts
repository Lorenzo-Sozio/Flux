import { type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

/**
 * Letters with an accent, and the plain letter each one is searched as — both cases,
 * because `lower()` under a "C" collation only lowers ASCII and leaves "È" as it is.
 */
const FOLDS: [string, string][] = [
  ["àáâãäåāăą", "a"],
  ["ÀÁÂÃÄÅĀĂĄ", "a"],
  ["èéêëēėęě", "e"],
  ["ÈÉÊËĒĖĘĚ", "e"],
  ["ìíîïīį", "i"],
  ["ÌÍÎÏĪĮ", "i"],
  ["òóôõöøō", "o"],
  ["ÒÓÔÕÖØŌ", "o"],
  ["ùúûüūůű", "u"],
  ["ÙÚÛÜŪŮŰ", "u"],
  ["çćč", "c"],
  ["ÇĆČ", "c"],
  ["ñń", "n"],
  ["ÑŃ", "n"],
  ["šś", "s"],
  ["ŠŚ", "s"],
  ["žźż", "z"],
  ["ŽŹŻ", "z"],
  ["ýÿ", "y"],
  ["ÝŸ", "y"],
];
const FOLD_FROM = FOLDS.map(([from]) => from).join("");
const FOLD_TO = FOLDS.map(([from, to]) => to.repeat([...from].length)).join("");

/**
 * A text as it is compared: lower case, accents off — "Nicolò" and "nicolo" are one name.
 *
 * ⚠️⚠️ `translate()` rather than the `unaccent` extension. An extension has to be created,
 * and a managed Postgres may refuse to: a tenant migration that fails leaves the workspace
 * behind every later one. `translate` is in every Postgres, and costs what `ILIKE` cost —
 * a scan either way, since a pattern with a leading `%` uses no index.
 */
export const fold = (value: unknown): SQL => sql`translate(lower(${value}), ${FOLD_FROM}, ${FOLD_TO})`;

/** `ILIKE`, with accents folded on both sides (§4.4). `pattern` keeps its `%`. */
export const matchesText = (col: AnyPgColumn | SQL, pattern: string): SQL => sql`${fold(col)} LIKE ${fold(pattern)}`;
