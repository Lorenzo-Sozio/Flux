/**
 * schema-ready.ts — surviving the gap between deploying and migrating.
 *
 * A tenant database is migrated by hand from the admin panel, so there is always
 * a window in which the deployed code knows about a column the database has not
 * got yet. It can be days: the button applies whatever is in the *deployed*
 * bundle, so pressing it before the deploy does nothing, which is easy to do and
 * easy to believe worked.
 *
 * In that window Postgres answers `column "x" does not exist`, and whatever was
 * reading it fails. That has already cost this product twice: the settings page
 * for opening hours, and — far worse — creating a ticket, because resolving an
 * SLA policy reads the whole row.
 *
 * This narrows the blast radius to the feature that is not ready yet. It catches
 * exactly one thing, the message Postgres gives for a column or table that is not
 * there, and rethrows everything else. A real failure still fails.
 */

/** Postgres for "you are ahead of your own database". */
function isMissingSchema(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /column .* does not exist|relation .* does not exist|undefined_table|undefined_column/i.test(message);
}

const warned = new Set<string>();

/**
 * Runs a read that depends on a migration, and falls back when it is not applied.
 *
 * `what` names the feature, not the column: it is what gets logged, once, and
 * whoever reads that log needs to know which button to press and what is degraded
 * until they do.
 */
export async function tolerateUnmigrated<T>(what: string, run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (!isMissingSchema(err)) throw err;

    if (!warned.has(what)) {
      warned.add(what);
      console.error(
        `[schema] ${what} is not available on this workspace yet: the database is behind the deployed code. ` +
          "Run Migrate DB from the platform admin panel. Everything else keeps working.",
      );
    }
    return fallback;
  }
}

export { isMissingSchema };
