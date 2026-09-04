/**
 * The merge lists, checked against the schema they are supposed to describe.
 *
 * On the tested boundary because the failure is silent and permanent. A table
 * that points at a company or a contact and is missing from the list is either
 * orphaned or deleted when two of them are merged, depending on which `onDelete`
 * its foreign key carries, and the merge reports success either way. There is no
 * screen on which the loss appears; the history is simply shorter than it was.
 *
 * This test needs no database. It reads the foreign keys straight out of the
 * Drizzle schema, which is the same declaration the migrations are generated
 * from, and compares them with what `merge-children.ts` says it will carry.
 */
import { getTableName, is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import * as schema from "@/db/schema";

import { childColumn, MERGE_PARENTS, type MergeChild } from "./merge-children";

/** Every table in the schema, by the name the database knows it under. */
function allTables(): PgTable[] {
  // The schema module also exports relations and enums; only the tables have keys.
  return (Object.values(schema) as unknown[]).filter((v): v is PgTable => is(v, PgTable));
}

/**
 * Every (table, column) in the schema whose foreign key points at `parent`.
 *
 * Read from the declaration rather than listed here, which is the whole point:
 * a list written twice is a list that drifts.
 */
function foreignKeysInto(parentName: string): { table: string; field: string }[] {
  const found: { table: string; field: string }[] = [];
  for (const table of allTables()) {
    const config = getTableConfig(table);
    for (const fk of config.foreignKeys) {
      const ref = fk.reference();
      if (getTableName(ref.foreignTable) !== parentName) continue;
      for (const col of ref.columns) {
        // `col.name` is the SQL name; the merge list is written in TypeScript,
        // so compare on the property the update statement will actually use.
        const field = Object.keys(table).find(
          (k) => (table as unknown as Record<string, { name?: string }>)[k]?.name === col.name,
        );
        found.push({ table: getTableName(table), field: field ?? col.name });
      }
    }
  }
  return found;
}

function declared(children: MergeChild[]): Set<string> {
  return new Set(children.map((c) => `${getTableName(c.table)}.${c.field}`));
}

describe.each(MERGE_PARENTS)("merging $parent", ({ parent, children }) => {
  const parentName = getTableName(parent);

  it("carries every row in the schema that points at the merged record", () => {
    const have = declared(children);
    const missing = foreignKeysInto(parentName)
      .map((fk) => `${fk.table}.${fk.field}`)
      .filter((key) => !have.has(key));

    // Naming them is the point: the fix is one line, once you know which line.
    expect(missing, `not carried across a ${parentName} merge: ${missing.join(", ")}`).toEqual([]);
  });

  it("lists nothing that is not a real column", () => {
    for (const child of children) {
      expect(childColumn(child), `${getTableName(child.table)}.${child.field} is not a column`).toBeDefined();
    }
  });

  it("lists nothing twice", () => {
    expect(declared(children).size).toBe(children.length);
  });
});
