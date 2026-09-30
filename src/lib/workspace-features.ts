import { inArray, sql } from "drizzle-orm";

import { workspaceSettings } from "@/db/schema";
import type { getDb } from "@/lib/tenant-context";
import { WORKSPACE_FEATURES, type WorkspaceFeature, type WorkspaceFeatures } from "@/lib/workspace-feature-list";

export { WORKSPACE_FEATURES, type WorkspaceFeature, type WorkspaceFeatures };

type Db = Awaited<ReturnType<typeof getDb>>;

const keyOf = (feature: WorkspaceFeature) => `feature.${feature}`;

/**
 * What a new workspace starts with: the core of a CRM, and nothing to step over.
 * `seedWorkspace` writes these; an existing workspace, which has no row, keeps everything on.
 */
export const NEW_WORKSPACE_FEATURES: WorkspaceFeatures = { projects: false, chat: false, ai: true };

/** Everything on: what a workspace has when nobody has decided otherwise. */
export const ALL_FEATURES_ON: WorkspaceFeatures = { projects: true, chat: true, ai: true };

/**
 * The workspace's switches. A missing row is on — every workspace had these before they
 * could be turned off, and switching them off for people who use them would be a surprise.
 *
 * Never throws: a database still waiting for the migration that creates the table answers
 * "all on", which is how it behaved yesterday.
 */
export async function readWorkspaceFeatures(db: Db): Promise<WorkspaceFeatures> {
  try {
    const rows = await db
      .select({ key: workspaceSettings.key, value: workspaceSettings.value })
      .from(workspaceSettings)
      .where(inArray(workspaceSettings.key, WORKSPACE_FEATURES.map(keyOf)));
    const out = { ...ALL_FEATURES_ON };
    for (const f of WORKSPACE_FEATURES) {
      const row = rows.find((r) => r.key === keyOf(f));
      if (row && row.value === false) out[f] = false;
    }
    return out;
  } catch {
    return { ...ALL_FEATURES_ON };
  }
}

/** Switches one feature on or off for the workspace. */
export async function writeWorkspaceFeature(db: Db, feature: WorkspaceFeature, on: boolean): Promise<void> {
  await db
    .insert(workspaceSettings)
    .values({ key: keyOf(feature), value: on })
    .onConflictDoUpdate({ target: workspaceSettings.key, set: { value: on, updatedAt: sql`now()` } });
}
