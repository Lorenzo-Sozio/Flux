/**
 * Tenant migrations.
 *
 * This belongs on the tested boundary because the failure mode is the expensive
 * kind: it does not look like a bug in the browser, it looks like a customer's
 * database quietly being a version behind the code that reads it.
 *
 * Two things are checked. That the embedded copy still matches the folder — the
 * generated file is what production applies, and a forgotten regeneration means
 * shipping code whose columns were never created. And that the runtime migrator
 * makes the same decisions drizzle's own does, so a tenant already at 0001
 * receives 0002 and not 0000 all over again.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { applyTenantMigrations, hasExecutableSql, listTenantMigrations } from "./migrate-tenant";
import { tenantMigrations } from "./migrations-tenant.generated";

const FOLDER = join(process.cwd(), "src", "db", "migrations-tenant");

interface Journal {
  entries: { idx: number; when: number; tag: string }[];
}

function readJournal(): Journal {
  return JSON.parse(readFileSync(join(FOLDER, "meta", "_journal.json"), "utf8"));
}

describe("embedded migrations stay in step with the folder", () => {
  const journal = readJournal();

  it("embeds every migration the journal lists, in order", () => {
    expect(tenantMigrations.map((m) => m.tag)).toEqual(journal.entries.map((e) => e.tag));
  });

  it("keeps the journal timestamp, which is what decides what gets applied", () => {
    for (const entry of journal.entries) {
      const embedded = tenantMigrations.find((m) => m.tag === entry.tag);
      expect(embedded?.folderMillis).toBe(entry.when);
    }
  });

  it("embeds the SQL that is actually on disk", () => {
    // Regenerating is one command; forgetting it ships a build that believes it
    // has migrated a database it has not touched.
    for (const entry of journal.entries) {
      const onDisk = readFileSync(join(FOLDER, `${entry.tag}.sql`), "utf8");
      const embedded = tenantMigrations.find((m) => m.tag === entry.tag);

      expect(embedded, `${entry.tag} is missing — run: npm run generate:migrations`).toBeDefined();
      expect(embedded?.sql.join("--> statement-breakpoint")).toBe(onDisk);
      expect(embedded?.hash).toBe(createHash("sha256").update(onDisk).digest("hex"));
    }
  });

  it("splits on the statement breakpoint exactly as drizzle does", () => {
    // Drizzle records one row per migration but executes one request per
    // statement; a different split is a different sequence of writes.
    for (const entry of journal.entries) {
      const onDisk = readFileSync(join(FOLDER, `${entry.tag}.sql`), "utf8");
      const embedded = tenantMigrations.find((m) => m.tag === entry.tag);
      expect(embedded?.sql).toEqual(onDisk.split("--> statement-breakpoint"));
    }
  });
});

describe("hasExecutableSql", () => {
  it("rejects fragments that are only comments or blank lines", () => {
    expect(hasExecutableSql("\n-- just a note\n")).toBe(false);
    expect(hasExecutableSql("   \n\n")).toBe(false);
  });

  it("accepts a statement that carries a comment above it", () => {
    expect(hasExecutableSql("-- why\nALTER TABLE t ADD COLUMN c text;")).toBe(true);
  });
});

// ─── The decision rule ────────────────────────────────────────────────────────

/** A database that records what it was asked to run, and nothing else. */
/**
 * How a driver hands rows back.
 *
 * ⚠️⚠️ Both of these are real, and this double used to imitate only the first.
 * The raw `neon()` client resolves to an array of rows; drizzle's `db.execute()`
 * on the same driver resolves to the driver's full result, `{ fields, rows, … }`.
 * The admin panel uses the second. With only the first modelled here, every test
 * passed while the migrator in production read `undefined`, concluded no
 * migration had ever been applied, and tried to run 0000 against a live database
 * — so nothing was applied at all, for days.
 */
type DriverShape = "array" | "result";

function wrap(rows: unknown[], shape: DriverShape) {
  return shape === "array" ? rows : { fields: [], rows, rowCount: rows.length };
}

function fakeDb(alreadyAppliedUpTo: number | null, shape: DriverShape = "array") {
  const statements: string[] = [];
  const inserts: { hash: string; when: number }[] = [];

  return {
    statements,
    inserts,
    execute(query: unknown) {
      const q = query as { queryChunks?: unknown[] };
      const text = renderForTest(q);

      if (text.startsWith("select id, hash, created_at")) {
        const rows = alreadyAppliedUpTo === null ? [] : [{ created_at: alreadyAppliedUpTo }];
        return Promise.resolve(wrap(rows, shape));
      }
      if (text.startsWith("insert into")) {
        const params = collectParams(q);
        inserts.push({ hash: String(params[0]), when: Number(params[1]) });
        return Promise.resolve(wrap([], shape));
      }

      statements.push(text);
      return Promise.resolve(wrap([], shape));
    },
  };
}

/** Flattens a drizzle SQL object down to something a test can match on. */
function renderForTest(query: { queryChunks?: unknown[] }): string {
  const chunks = query.queryChunks ?? [];
  return chunks
    .map((c) => {
      // Literal fragments arrive as StringChunk (value: string[]), identifiers as
      // Name (value: string), and bound parameters as bare primitives.
      const chunk = c as { value?: unknown };
      if (Array.isArray(chunk?.value)) return chunk.value.join("");
      if (typeof chunk?.value === "string") return chunk.value;
      return "";
    })
    .join("")
    .trim();
}

/**
 * The bound parameters, and only those.
 *
 * Drizzle puts literal fragments and identifiers into the chunk list as objects
 * (StringChunk, Name) and interpolated values as bare primitives, so the
 * primitives are exactly the parameters.
 */
function collectParams(query: { queryChunks?: unknown[] }): unknown[] {
  const chunks = query.queryChunks ?? [];
  return chunks.filter((c) => typeof c === "string" || typeof c === "number");
}

const MIGRATIONS = [
  { tag: "0000_first", folderMillis: 1000, hash: "h0", sql: ["CREATE TABLE a();"] },
  { tag: "0001_second", folderMillis: 2000, hash: "h1", sql: ["ALTER TABLE a ADD COLUMN b text;"] },
  { tag: "0002_third", folderMillis: 3000, hash: "h2", sql: ["-- note only\n", "ALTER TABLE a ADD COLUMN c text;"] },
];

describe("applyTenantMigrations", () => {
  it("keeps drizzle's own bookkeeping table", async () => {
    // The table name is the whole memory of what has been applied. Point it
    // somewhere else and every tenant looks unmigrated: 0000 runs again and dies
    // on tables that already exist. Nothing in the other assertions notices,
    // because a fresh fake database has no history either way.
    const db = fakeDb(null);
    await applyTenantMigrations(db, MIGRATIONS);

    const ddl = db.statements.join(" ");
    expect(ddl).toContain("drizzle");
    expect(ddl).toContain("__drizzle_migrations");
  });

  it("applies everything on a database that has never been migrated", async () => {
    const db = fakeDb(null);
    const result = await applyTenantMigrations(db, MIGRATIONS);

    expect(result.applied).toEqual(["0000_first", "0001_second", "0002_third"]);
    expect(result.skipped).toEqual([]);
    expect(db.inserts.map((i) => i.when)).toEqual([1000, 2000, 3000]);
  });

  it("applies only what is newer than the last recorded migration", async () => {
    // The case that matters in production: tenants sitting at 0001 must receive
    // 0002 alone. Re-running 0000 would fail on tables that already exist.
    const db = fakeDb(2000);
    const result = await applyTenantMigrations(db, MIGRATIONS);

    expect(result.applied).toEqual(["0002_third"]);
    expect(result.skipped).toEqual(["0000_first", "0001_second"]);
  });

  it("does nothing on a database that is already up to date", async () => {
    const db = fakeDb(3000);
    const result = await applyTenantMigrations(db, MIGRATIONS);

    expect(result.applied).toEqual([]);
    expect(db.inserts).toEqual([]);
  });

  it("records the hash and the journal timestamp drizzle would have recorded", async () => {
    const db = fakeDb(null);
    await applyTenantMigrations(db, MIGRATIONS);

    expect(db.inserts).toEqual([
      { hash: "h0", when: 1000 },
      { hash: "h1", when: 2000 },
      { hash: "h2", when: 3000 },
    ]);
  });

  it("does not send comment-only fragments to the driver", async () => {
    const db = fakeDb(2000);
    await applyTenantMigrations(db, MIGRATIONS);

    expect(db.statements).not.toContain("-- note only");
    expect(db.statements.some((s) => s.includes("ADD COLUMN c"))).toBe(true);
  });

  it("applies in journal order even when handed them shuffled", async () => {
    const db = fakeDb(null);
    const result = await applyTenantMigrations(db, [MIGRATIONS[2], MIGRATIONS[0], MIGRATIONS[1]]);
    expect(result.applied).toEqual(["0000_first", "0001_second", "0002_third"]);
  });
});

describe("listTenantMigrations", () => {
  it("returns the real migrations, newest last", () => {
    const list = listTenantMigrations();
    expect(list.length).toBeGreaterThan(0);
    for (let i = 1; i < list.length; i++) {
      expect(list[i].folderMillis).toBeGreaterThan(list[i - 1].folderMillis);
    }
  });
});

/**
 * The same decisions, against the shape drizzle's wrapper actually returns.
 *
 * This is the production path — the admin panel calls `applyTenantMigrations`
 * with a drizzle instance, not with the raw client — and it was the only one not
 * covered.
 */
describe("applyTenantMigrations, against a driver that returns a result object", () => {
  it("reads the last applied migration out of the result", async () => {
    const db = fakeDb(2000, "result");
    const result = await applyTenantMigrations(db, MIGRATIONS);

    expect(result.applied).toEqual(["0002_third"]);
    expect(result.skipped).toEqual(["0000_first", "0001_second"]);
  });

  it("does not mistake a migrated database for an empty one", async () => {
    // The failure exactly as it happened: reading the history as `undefined`
    // makes a live database look untouched, and 0000 runs again.
    const db = fakeDb(3000, "result");
    const result = await applyTenantMigrations(db, MIGRATIONS);

    expect(result.applied).toEqual([]);
    expect(db.inserts).toEqual([]);
  });

  it("still applies everything to a database that really is empty", async () => {
    const db = fakeDb(null, "result");
    const result = await applyTenantMigrations(db, MIGRATIONS);

    expect(result.applied).toEqual(["0000_first", "0001_second", "0002_third"]);
  });
});
