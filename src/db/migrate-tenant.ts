/**
 * migrate-tenant.ts — applies tenant migrations without touching a filesystem.
 *
 * `drizzle-orm/neon-http/migrator` reads `meta/_journal.json` and the `.sql` files
 * from disk when it runs. That is fine from a developer's machine and nowhere
 * else: a deployed Next.js server does not carry files the bundler never saw
 * imported, and a Cloudflare Worker has no filesystem at all. Running the
 * migration from the admin panel in production failed on every tenant with
 *
 *     Can't find meta/_journal.json file
 *
 * because the folder was not there to read.
 *
 * This is the same algorithm against migrations embedded as source
 * (`migrations-tenant.generated.ts`), so it behaves identically and, crucially,
 * remains compatible with the rows previous runs already wrote:
 *
 *  - same bookkeeping table, `drizzle.__drizzle_migrations`
 *  - same decision rule — apply everything whose journal timestamp is newer than
 *    the newest one recorded, rather than comparing hashes
 *  - same statement splitting, so a migration is applied in the same pieces
 *
 * A tenant already at 0001 therefore receives only 0002, exactly as before.
 */
import { type SQL, sql } from "drizzle-orm";

import { type EmbeddedMigration, tenantMigrations } from "./migrations-tenant.generated";

const MIGRATIONS_SCHEMA = "drizzle";
const MIGRATIONS_TABLE = "__drizzle_migrations";

export interface MigrationOutcome {
  /** Migrations applied by this call, oldest first. */
  applied: string[];
  /** Migrations that were already recorded. */
  skipped: string[];
}

/**
 * Anything that can run raw SQL.
 *
 * Structural on purpose: the real caller is a Neon HTTP database, but this
 * function needs nothing from it beyond "run this and give me back the rows", and
 * a narrower type would make the migrator impossible to test without a database.
 */
type Runner = { execute(query: SQL): Promise<unknown> };

/**
 * The rows out of whatever `execute` handed back.
 *
 * ⚠️⚠️ This is the whole reason migrations stopped being applied in production.
 * Drizzle's `db.execute()` on the Neon HTTP driver resolves to the driver's full
 * result — `{ fields, rows, rowCount, … }` — not to an array of rows. Indexing it
 * as an array gave `undefined`, so the migrator concluded that nothing had ever
 * been applied and set out to run migration 0000 against a populated database.
 * The first `CREATE TABLE` failed, the call threw, and **not one** migration was
 * applied. Three of them sat unapplied for days while the panel reported an error
 * that pointed nowhere near the cause.
 *
 * Both shapes are accepted because both are real: the raw `neon()` client returns
 * an array, drizzle's wrapper returns the result object, and this module is
 * called with each of them from different places.
 */
function toRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

/**
 * The newest migration this database records having applied, or null when it has
 * none at all.
 *
 * Exported because "has this database ever been migrated" is a different question
 * from "bring it up to date", and the auto-migrator has to ask the first before
 * deciding whether it is allowed to do the second: a database with no history is
 * a workspace being provisioned, which belongs to the admin panel.
 *
 * Reads without creating anything, so asking is never itself a change.
 */
export async function readLastApplied(db: Runner): Promise<number | null> {
  const rows = toRows<{ created_at: string | number | null }>(
    await db.execute(
      sql`select created_at from ${sql.identifier(MIGRATIONS_SCHEMA)}.${sql.identifier(MIGRATIONS_TABLE)} order by created_at desc limit 1`,
    ),
  );
  return rows[0] ? Number(rows[0].created_at) : null;
}

/**
 * Brings one tenant database up to date.
 *
 * Safe to call repeatedly: nothing is applied twice.
 *
 * ⚠️ Not wrapped in a transaction, because the Neon HTTP driver has no session to
 * hold one open across statements — the same limitation drizzle's own neon-http
 * migrator lives with. A migration that fails halfway leaves the statements
 * before it applied and no row recorded, so re-running repeats them. Every
 * statement generated here is therefore additive and idempotent-friendly
 * (`ADD COLUMN`, `CREATE TABLE IF NOT EXISTS`), and a hand-written one must be
 * too.
 */
export async function applyTenantMigrations(
  db: Runner,
  migrations: EmbeddedMigration[] = tenantMigrations,
): Promise<MigrationOutcome> {
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS ${sql.identifier(MIGRATIONS_SCHEMA)}`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ${sql.identifier(MIGRATIONS_SCHEMA)}.${sql.identifier(MIGRATIONS_TABLE)} (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  const rows = toRows<{ created_at: string | number | null }>(
    await db.execute(
      sql`select id, hash, created_at from ${sql.identifier(MIGRATIONS_SCHEMA)}.${sql.identifier(MIGRATIONS_TABLE)} order by created_at desc limit 1`,
    ),
  );

  const lastApplied = rows[0] ? Number(rows[0].created_at) : null;

  const applied: string[] = [];
  const skipped: string[] = [];

  // The journal is already in order; sorting again makes that a property of this
  // function rather than an assumption about the file.
  for (const migration of [...migrations].sort((a, b) => a.folderMillis - b.folderMillis)) {
    if (lastApplied !== null && lastApplied >= migration.folderMillis) {
      skipped.push(migration.tag);
      continue;
    }

    for (const statement of migration.sql) {
      // A fragment that is only whitespace or comments is not a statement, and
      // sending it to the driver is an error rather than a no-op.
      if (!hasExecutableSql(statement)) continue;
      await db.execute(sql.raw(statement));
    }

    await db.execute(
      sql`insert into ${sql.identifier(MIGRATIONS_SCHEMA)}.${sql.identifier(MIGRATIONS_TABLE)} ("hash", "created_at") values(${migration.hash}, ${migration.folderMillis})`,
    );

    applied.push(migration.tag);
  }

  return { applied, skipped };
}

/** True when the fragment contains something other than blank lines and `--` comments. */
export function hasExecutableSql(statement: string): boolean {
  return statement.split("\n").some((line) => line.trim() !== "" && !line.trimStart().startsWith("--"));
}

/** The migrations this build carries, newest last. */
export function listTenantMigrations(): EmbeddedMigration[] {
  return [...tenantMigrations].sort((a, b) => a.folderMillis - b.folderMillis);
}
