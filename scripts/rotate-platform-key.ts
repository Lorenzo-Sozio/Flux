#!/usr/bin/env npx tsx
/**
 * Rotates PLATFORM_ENCRYPTION_KEY: re-encrypts every value it protects under a new key.
 *
 * Usage:
 *   npx tsx scripts/rotate-platform-key.ts                     # dry run: plans and checks, writes nothing
 *   npx tsx scripts/rotate-platform-key.ts --apply             # rewrites every value
 *   npx tsx scripts/rotate-platform-key.ts --rollback <file>   # puts back what a backup recorded
 *
 * Required env vars (loaded from .env automatically, and never passed as arguments,
 * which end up in shell history and process lists):
 *   DATABASE_URL                  platform database
 *   OLD_PLATFORM_ENCRYPTION_KEY   the key in use now
 *   NEW_PLATFORM_ENCRYPTION_KEY   the key to move to
 *
 * ## ⚠️⚠️ The order, which is what keeps every workspace reachable
 *
 *   1. Deploy a build that includes commit cb8ffe3, so decryption accepts a previous key.
 *   2. On the Worker, set PLATFORM_ENCRYPTION_KEY to the NEW key and
 *      PLATFORM_ENCRYPTION_KEY_PREVIOUS to the OLD one. The app now reads both.
 *   3. Run this in dry run. It must report no unreadable value and no unreachable workspace.
 *   4. Run it with --apply.
 *   5. Remove PLATFORM_ENCRYPTION_KEY_PREVIOUS from the Worker.
 *
 * Skipping step 2 is the outage this procedure exists to prevent: rows rewritten
 * under a key the running app does not hold.
 *
 * ## What it guarantees
 *
 * - **Nothing is written unless every value can be read.** One value neither key
 *   opens means the old key given is wrong, or the value is damaged. Rewriting the
 *   rest would leave a database no single key reads.
 * - **A run that stopped halfway can be run again.** Values the new key already
 *   opens are recognised and left alone.
 * - **A backup of the old ciphertexts is written before the first change.** It holds
 *   ciphertexts only — useless without the old key — and `--rollback` restores them.
 * - **Every write is conditional on the value it replaces.** A value that changed
 *   since it was read is reported and not overwritten.
 * - **Every written value is read back and decrypted with the new key** before the
 *   run calls itself finished.
 * - **No key and no decrypted value is ever printed.** Only where a value lives.
 */
import "dotenv/config";

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { neon } from "@neondatabase/serverless";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";

import { emailSettings, tenants } from "../src/db/schema";
import { describe, type EncryptedField, type FieldPlan, planRotation } from "../src/lib/key-rotation";
import { conditionalWrite } from "../src/lib/key-rotation-db";
import { decryptWithKey, parseEncryptionKey } from "../src/lib/tenant-db";

type Db = ReturnType<typeof drizzle>;
type Column = "db_url" | "resend_api_key" | "smtp_password";

interface BackupEntry {
  database: string;
  table: "tenants" | "email_settings";
  column: Column;
  id: string;
  previous: string;
  next: string;
}

const BACKUP_DIR = ".key-rotation";
const CONNECT_TIMEOUT_MS = 10_000;

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const rollbackFile = args.includes("--rollback") ? args[args.indexOf("--rollback") + 1] : null;

function fail(message: string): never {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

function platformDb(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) fail("DATABASE_URL is not set.");
  return drizzle(neon(url));
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${ms / 1000}s`)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Reads every value the platform key protects. Tenant fields need each workspace opened. */
async function gather(db: Db, oldKey: Buffer, newKey: Buffer) {
  const fields: EncryptedField[] = [];

  const tenantRows = await db.select({ id: tenants.id, dbUrl: tenants.dbUrl }).from(tenants);
  for (const t of tenantRows) {
    fields.push({ database: "platform", table: "tenants", column: "db_url", id: t.id, stored: t.dbUrl });
  }

  const platformEmail = await db
    .select({ id: emailSettings.id, resend: emailSettings.resendApiKey, smtp: emailSettings.smtpPassword })
    .from(emailSettings);
  for (const row of platformEmail) {
    fields.push({
      database: "platform",
      table: "email_settings",
      column: "resend_api_key",
      id: row.id,
      stored: row.resend,
    });
    fields.push({
      database: "platform",
      table: "email_settings",
      column: "smtp_password",
      id: row.id,
      stored: row.smtp,
    });
  }

  // Each workspace's own email settings live in its own database. Opening one
  // needs its connection string, which either key may currently open.
  const unreachable: { id: string; reason: string }[] = [];
  const tenantDbs = new Map<string, Db>();
  for (const t of tenantRows) {
    const url = openWith(t.dbUrl, newKey) ?? openWith(t.dbUrl, oldKey);
    if (!url) continue; // reported as unreadable by the planner
    try {
      const tdb = drizzle(neon(url));
      const rows = await withTimeout(
        tdb
          .select({ id: emailSettings.id, resend: emailSettings.resendApiKey, smtp: emailSettings.smtpPassword })
          .from(emailSettings),
        CONNECT_TIMEOUT_MS,
      );
      tenantDbs.set(t.id, tdb);
      for (const row of rows) {
        fields.push({
          database: t.id,
          table: "email_settings",
          column: "resend_api_key",
          id: row.id,
          stored: row.resend,
        });
        fields.push({ database: t.id, table: "email_settings", column: "smtp_password", id: row.id, stored: row.smtp });
      }
    } catch (e) {
      unreachable.push({ id: t.id, reason: e instanceof Error ? e.message.split("\n")[0] : "unknown error" });
    }
  }

  return { fields, unreachable, tenantDbs };
}

function openWith(stored: string | null, key: Buffer): string | null {
  if (!stored) return null;
  try {
    return decryptWithKey(stored, key);
  } catch {
    return null;
  }
}

/** One conditional write: replaces the value only if it is still the one that was read. */
async function writeIfUnchanged(db: Db, entry: BackupEntry, from: string, to: string): Promise<boolean> {
  const done = await conditionalWrite(db, entry, from, to);
  return done.length === 1;
}

async function readBack(db: Db, entry: BackupEntry): Promise<string | null> {
  if (entry.table === "tenants") {
    const [row] = await db.select({ v: tenants.dbUrl }).from(tenants).where(eq(tenants.id, entry.id));
    return row?.v ?? null;
  }
  const [row] = await db
    .select({ resend: emailSettings.resendApiKey, smtp: emailSettings.smtpPassword })
    .from(emailSettings)
    .where(eq(emailSettings.id, entry.id));
  if (!row) return null;
  return entry.column === "resend_api_key" ? row.resend : row.smtp;
}

function printSummary(counts: Record<FieldPlan["action"], number>) {
  console.log(`  to rotate         ${counts.rotate}`);
  console.log(`  already rotated   ${counts["already-rotated"]}`);
  console.log(`  empty             ${counts.empty}`);
  console.log(`  not encrypted     ${counts.plaintext}   (left as they are)`);
  console.log(`  unreadable        ${counts.unreadable}`);
}

async function rotate() {
  const oldKey = parseEncryptionKey(process.env.OLD_PLATFORM_ENCRYPTION_KEY, "OLD_PLATFORM_ENCRYPTION_KEY");
  const newKey = parseEncryptionKey(process.env.NEW_PLATFORM_ENCRYPTION_KEY, "NEW_PLATFORM_ENCRYPTION_KEY");
  // Checked before any database is opened: the planner refuses this too, but only
  // after every workspace has been connected to for nothing.
  if (oldKey.equals(newKey)) fail("OLD and NEW are the same key. Nothing to rotate.");

  const db = platformDb();
  console.log(apply ? "Rotating the platform key." : "Dry run — nothing will be written.");

  const { fields, unreachable, tenantDbs } = await gather(db, oldKey, newKey);
  const plan = planRotation(fields, oldKey, newKey);

  console.log(`\n${fields.length} values found:`);
  printSummary(plan.counts);

  for (const f of plan.fields.filter((p) => p.action === "plaintext")) {
    console.log(`  · not encrypted: ${describe(f.field)}`);
  }
  if (unreachable.length > 0) {
    console.log(`\n${unreachable.length} workspace(s) could not be opened, so their email settings were not read:`);
    for (const u of unreachable) console.log(`  · ${u.id}: ${u.reason}`);
  }
  if (plan.unreadable.length > 0) {
    console.log("\nUnreadable with either key:");
    for (const f of plan.unreadable) console.log(`  · ${describe(f)}`);
    fail("Nothing written. Check that OLD_PLATFORM_ENCRYPTION_KEY is the key in use now.");
  }
  if (unreachable.length > 0) {
    // A workspace we could not open may hold values under the old key. Rotating the
    // rest and then removing the previous key would lock those out.
    fail("Nothing written. Every workspace must be reachable so none of its values is left behind.");
  }

  if (!apply) {
    console.log("\n✔ Dry run clean. Run again with --apply once the Worker holds both keys.");
    return;
  }

  const changes = plan.fields.filter((p): p is Extract<FieldPlan, { action: "rotate" }> => p.action === "rotate");
  if (changes.length === 0) {
    console.log("\n✔ Nothing to rotate: every value already opens with the new key.");
    return;
  }

  const entries: BackupEntry[] = changes.map((c) => ({
    database: c.field.database,
    table: c.field.table as BackupEntry["table"],
    column: c.field.column as Column,
    id: c.field.id,
    previous: c.field.stored as string,
    next: c.next,
  }));

  mkdirSync(BACKUP_DIR, { recursive: true });
  const backup = join(BACKUP_DIR, `backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(backup, `${JSON.stringify(entries, null, 2)}\n`, { mode: 0o600 });
  console.log(`\nBackup of the old ciphertexts: ${backup}`);

  const conflicts: string[] = [];
  for (const entry of entries) {
    const target = entry.database === "platform" ? db : tenantDbs.get(entry.database);
    if (!target) {
      conflicts.push(`${entry.database}/${entry.table}.${entry.column}#${entry.id}: workspace not open`);
      continue;
    }
    const ok = await writeIfUnchanged(target, entry, entry.previous, entry.next);
    if (!ok) conflicts.push(`${entry.database}/${entry.table}.${entry.column}#${entry.id}: changed since it was read`);
  }

  // Read every written value back, and open it with the new key.
  const byLocation = new Map(
    changes.map((c) => [`${c.field.database}|${c.field.table}|${c.field.column}|${c.field.id}`, c]),
  );
  const broken: string[] = [];
  for (const entry of entries) {
    const target = entry.database === "platform" ? db : tenantDbs.get(entry.database);
    if (!target) continue;
    const stored = await readBack(target, entry);
    const expected = byLocation.get(`${entry.database}|${entry.table}|${entry.column}|${entry.id}`)?.plaintext;
    if (stored === null || openWith(stored, newKey) !== expected) {
      broken.push(`${entry.database}/${entry.table}.${entry.column}#${entry.id}`);
    }
  }

  console.log(`\n${entries.length - conflicts.length} of ${entries.length} values rewritten.`);
  for (const c of conflicts) console.log(`  · skipped — ${c}`);
  if (broken.length > 0) {
    for (const b of broken) console.log(`  · does not open with the new key: ${b}`);
    fail(`Verification failed. Restore with: npx tsx scripts/rotate-platform-key.ts --rollback ${backup}`);
  }
  if (conflicts.length > 0) {
    fail("Some values changed during the run and were not rewritten. Run again: finished values are recognised.");
  }

  console.log("\n✔ Every value opens with the new key. Remove PLATFORM_ENCRYPTION_KEY_PREVIOUS from the Worker.");
}

async function rollback(file: string) {
  const entries = JSON.parse(readFileSync(file, "utf8")) as BackupEntry[];
  const db = platformDb();
  const oldKey = parseEncryptionKey(process.env.OLD_PLATFORM_ENCRYPTION_KEY, "OLD_PLATFORM_ENCRYPTION_KEY");
  const newKey = parseEncryptionKey(process.env.NEW_PLATFORM_ENCRYPTION_KEY, "NEW_PLATFORM_ENCRYPTION_KEY");

  console.log(`Restoring ${entries.length} values from ${file}.`);
  const failures: string[] = [];
  for (const entry of entries) {
    let target: Db | undefined = db;
    if (entry.database !== "platform") {
      // A workspace is opened through its own row, which at this moment may hold
      // either ciphertext: restored a line ago, or not restored because that write
      // was refused. So both keys are tried.
      const [row] = await db.select({ dbUrl: tenants.dbUrl }).from(tenants).where(eq(tenants.id, entry.database));
      const url = openWith(row?.dbUrl ?? null, oldKey) ?? openWith(row?.dbUrl ?? null, newKey);
      target = url ? drizzle(neon(url)) : undefined;
    }
    if (!target) {
      failures.push(`${entry.database}: workspace not open`);
      continue;
    }
    const ok = await writeIfUnchanged(target, entry, entry.next, entry.previous);
    if (!ok) failures.push(`${entry.database}/${entry.table}.${entry.column}#${entry.id}: not the rotated value`);
  }

  for (const f of failures) console.log(`  · ${f}`);
  if (failures.length > 0) fail("Some values were not restored.");
  console.log("\n✔ Restored. Put the OLD key back as PLATFORM_ENCRYPTION_KEY on the Worker.");
}

const run = rollbackFile ? rollback(rollbackFile) : rotate();
run.catch((e) => fail(e instanceof Error ? e.message : String(e)));
