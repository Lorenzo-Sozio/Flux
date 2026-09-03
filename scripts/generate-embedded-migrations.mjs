#!/usr/bin/env node

/**
 * Turns the tenant migration folder into a TypeScript module.
 *
 * Drizzle's migrator reads `meta/_journal.json` and the .sql files from disk at
 * the moment it runs. That works from a developer's machine and nowhere else: a
 * deployed Next.js server does not carry files the bundler could not see being
 * imported, and a Cloudflare Worker has no filesystem at all. Running the
 * migration from the admin panel in production therefore failed with
 *
 *     Can't find meta/_journal.json file
 *
 * for every tenant — the folder simply was not there.
 *
 * Embedding the migrations as source removes the question. They travel with the
 * code that needs them, which is also the only way the two can never disagree
 * about which migrations exist.
 *
 * Run after every `npm run generate:tenant-migrations`. `npm test` fails when the
 * generated file and the folder drift apart, so forgetting is caught.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FOLDER = join(process.cwd(), "src", "db", "migrations-tenant");
const OUTPUT = join(process.cwd(), "src", "db", "migrations-tenant.generated.ts");

/**
 * Reads the folder exactly the way `drizzle-orm/migrator` does, so the hashes and
 * the statement splitting stay byte-for-byte identical to what previous runs
 * recorded in `drizzle.__drizzle_migrations`.
 */
export function readMigrations(folder = FOLDER) {
  const journal = JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8"));

  return journal.entries.map((entry) => {
    const query = readFileSync(join(folder, `${entry.tag}.sql`), "utf8");
    return {
      tag: entry.tag,
      folderMillis: entry.when,
      hash: createHash("sha256").update(query).digest("hex"),
      sql: query.split("--> statement-breakpoint"),
    };
  });
}

function render(migrations) {
  const body = migrations
    .map(
      (m) => `  {
    tag: ${JSON.stringify(m.tag)},
    folderMillis: ${m.folderMillis},
    hash: ${JSON.stringify(m.hash)},
    sql: ${JSON.stringify(m.sql, null, 6).replace(/\n/g, "\n    ")},
  },`,
    )
    .join("\n");

  return `// GENERATED FILE — do not edit.
//
// Produced by scripts/generate-embedded-migrations.mjs from src/db/migrations-tenant.
// Regenerate with: npm run generate:migrations
//
// It exists because a deployed server has no access to the migration folder: the
// bundler cannot see files that are only ever read through a runtime path, and on
// Cloudflare Workers there is no filesystem to read from. Applying migrations from
// the admin panel failed with "Can't find meta/_journal.json file" until the SQL
// travelled with the code.
//
// The hash and the statement splitting reproduce drizzle-orm/migrator exactly, so
// the rows already written to drizzle.__drizzle_migrations stay valid.

export interface EmbeddedMigration {
  tag: string;
  /** The journal's \`when\`. Drizzle decides what to apply by comparing this. */
  folderMillis: number;
  hash: string;
  sql: string[];
}

export const tenantMigrations: EmbeddedMigration[] = [
${body}
];
`;
}

const migrations = readMigrations();
writeFileSync(OUTPUT, render(migrations), "utf8");

console.log(`Embedded ${migrations.length} tenant migration(s) into src/db/migrations-tenant.generated.ts`);
for (const m of migrations) {
  console.log(`  ${m.tag}  ${m.sql.length} statement(s)`);
}
