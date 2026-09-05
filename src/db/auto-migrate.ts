import type { NeonHttpDatabase } from "drizzle-orm/neon-http";

import { applyTenantMigrations, readLastApplied } from "@/db/migrate-tenant";
import { tenantMigrations } from "@/db/migrations-tenant.generated";

/**
 * auto-migrate.ts — closing the window between deploying and migrating.
 *
 * Every customer has their own database, so a schema change has to be applied
 * once per customer, and that is why the admin panel has a button. The button
 * applies whatever is in the *deployed* bundle, which means the order is deploy
 * first, migrate second — and in between, the code knows about columns the
 * database has not got.
 *
 * That window has broken production three times: the opening-hours page, the SLA
 * job, and creating a ticket. Every time the cause was the same and the symptom
 * was somewhere else, because a relational read names every column the schema
 * declares, so one missing column takes down a whole screen.
 *
 * The fix is not to be more careful. It is for a workspace to bring itself up to
 * date the first time it is used, so the window closes on its own.
 *
 * ## What this will and will not do
 *
 * It applies **pending** migrations only, to a database that has been migrated
 * before. A database with no history at all is a new workspace being provisioned,
 * and that belongs to the admin panel, which does it deliberately and reports
 * what happened — not to whichever page request happened to arrive first.
 *
 * It never fails a request. A migration that will not apply is logged and the
 * request carries on; the tolerant reads in `schema-ready.ts` are still there for
 * exactly that case, and the button is still there to be pressed.
 *
 * ## Two of them at once
 *
 * Nothing stops two isolates deciding to migrate at the same moment. There is no
 * lock to take: the Neon HTTP driver has no session, so a session-level advisory
 * lock cannot be held across statements. It is survivable because every tenant
 * migration is required to be re-runnable — `ADD COLUMN IF NOT EXISTS`,
 * `CREATE TABLE IF NOT EXISTS`, guarded `UPDATE` — which is already the rule
 * CLAUDE.md sets for a different reason: the same driver cannot hold a
 * transaction either, so a migration that fails halfway is re-applied anyway.
 * The worst a race produces is a duplicate bookkeeping row, and the rule for
 * deciding what to apply is "newer than the newest recorded", which does not
 * care how many rows say the same thing.
 */

// biome-ignore lint/suspicious/noExplicitAny: the schema generic is irrelevant to the migrator
type AnyDb = NeonHttpDatabase<any>;

/** One attempt per workspace per process, whatever the outcome. */
const attempts = new Map<string, Promise<void>>();

/** The newest migration this build carries. */
function newestEmbedded(): number {
  return tenantMigrations.reduce((max, m) => Math.max(max, m.folderMillis), 0);
}

/**
 * The escape hatch.
 *
 * Set `SKIP_AUTO_MIGRATE=1` to go back to migrating only from the panel. It
 * exists because a write on a request path is the kind of thing an operator must
 * be able to switch off at three in the morning without a deploy.
 */
function disabled(): boolean {
  return process.env.SKIP_AUTO_MIGRATE === "1" || process.env.SKIP_AUTO_MIGRATE === "true";
}

async function bringUpToDate(tenantId: string, db: AnyDb): Promise<void> {
  const target = newestEmbedded();

  // Asked before anything is applied, and it creates nothing. The ordinary case
  // ends here: one SELECT, up to date, nothing to do.
  const lastApplied = await readLastApplied(db);

  if (lastApplied === null) {
    // No history at all — a workspace that has never been provisioned. Building
    // it from scratch on whichever page request arrived first is not a decision a
    // request should make: it is a hundred and sixty-nine statements, and the
    // admin panel does it deliberately and reports what happened.
    console.warn(
      `[auto-migrate] ${tenantId} has no migration history, so nothing was applied. ` +
        "Provision it from the platform admin panel.",
    );
    return;
  }

  if (lastApplied >= target) return;

  const { applied } = await applyTenantMigrations(db);
  if (applied.length > 0) {
    console.log(`[auto-migrate] ${tenantId} brought up to ${target}: applied ${applied.join(", ")}`);
  }
}

/**
 * Brings one workspace up to the schema this build expects, once per process.
 *
 * Awaiting this before the first query is what makes the deploy-then-migrate
 * window disappear. It costs one SELECT per workspace per process when there is
 * nothing to do.
 */
export function ensureTenantMigrated(tenantId: string, db: AnyDb): Promise<void> {
  if (disabled()) return Promise.resolve();

  let attempt = attempts.get(tenantId);
  if (!attempt) {
    attempt = bringUpToDate(tenantId, db).catch((err) => {
      // Never fail the request. Whatever is not migrated stays not migrated, the
      // tolerant reads cover the features that need it, and the panel still works.
      console.error(`[auto-migrate] ${tenantId} could not be brought up to date:`, err);
    });
    attempts.set(tenantId, attempt);
  }
  return attempt;
}

/** Forgets the attempt for one workspace, so the next request tries again. */
export function forgetMigrationAttempt(tenantId: string): void {
  attempts.delete(tenantId);
}
