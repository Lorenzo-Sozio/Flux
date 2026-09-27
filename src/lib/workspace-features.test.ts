/**
 * The optional parts of the product, switched per workspace — against a real Postgres.
 *
 * A new workspace starts without project planning and internal chat; one that already had
 * them keeps them until somebody decides otherwise. Switching them off hides them from the
 * menu, closes their pages and stops the chat widget polling.
 */
import { readFileSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";
import { seedWorkspace } from "@/db/seed-workspace";
import { computeNavAccess } from "@/navigation/sidebar/filter-nav";
import { sidebarItems } from "@/navigation/sidebar/sidebar-items";

import { readWorkspaceFeatures, writeWorkspaceFeature } from "./workspace-features";

const db = drizzle(new PGlite());

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  await db.execute(sql`delete from workspace_setting`);
});

describe("⚠️⚠️ workspace features", () => {
  it("are all on for a workspace nobody has decided for — what every workspace had before", async () => {
    expect(await readWorkspaceFeatures(db as never)).toEqual({ projects: true, chat: true });
  });

  it("start off for a workspace being born", async () => {
    await db.execute(sql`delete from pipeline_stage`);
    await seedWorkspace(db as never);
    expect(await readWorkspaceFeatures(db as never)).toEqual({ projects: false, chat: false });
  });

  it("are not touched when an existing workspace is seeded again", async () => {
    // The admin panel's Migrate button seeds every workspace; one with a pipeline is not new.
    await seedWorkspace(db as never);
    expect(await readWorkspaceFeatures(db as never)).toEqual({ projects: true, chat: true });
  });

  it("switch one at a time, and back", async () => {
    await writeWorkspaceFeature(db as never, "chat", false);
    expect(await readWorkspaceFeatures(db as never)).toEqual({ projects: true, chat: false });
    await writeWorkspaceFeature(db as never, "chat", true);
    expect((await readWorkspaceFeatures(db as never)).chat).toBe(true);
  });
});

describe("⚠️⚠️ what switching them off does", () => {
  const actor = { userId: "u1", tenantRole: "owner" as const, isPlatformStaff: false };

  it("hides their entries from the menu", () => {
    const off = computeNavAccess(sidebarItems, { actor, features: { projects: false, chat: false } });
    expect(off.hidden).toEqual(
      expect.arrayContaining(["/dashboard/tasks/gantt", "/dashboard/tasks/workload", "/dashboard/chat"]),
    );
    const on = computeNavAccess(sidebarItems, { actor, features: { projects: true, chat: true } });
    expect(on.hidden).not.toContain("/dashboard/chat");
    expect(on.hidden).not.toContain("/dashboard/tasks/gantt");
  });

  it("closes their pages", () => {
    for (const [page, feature] of [
      ["chat", "chat"],
      ["tasks/gantt", "projects"],
      ["tasks/workload", "projects"],
    ]) {
      const src = readFileSync(`src/app/(main)/dashboard/${page}/page.tsx`, "utf8");
      expect(src, page).toContain(`requirePageFeature("${feature}"`);
    }
  });

  it("does not mount the chat widget, which polls from every open tab", () => {
    const layout = readFileSync("src/app/(main)/dashboard/layout.tsx", "utf8");
    expect(layout).toMatch(/features\.chat && <ChatWidget/);
  });

  it("is an administrator's decision", () => {
    const action = readFileSync("src/actions/workspace-settings.ts", "utf8");
    // The switch's own guard: the file holds other admin actions, and a check for the
    // string anywhere in it would pass whatever this one asked for.
    expect(action).toMatch(
      /export async function setWorkspaceFeatureAction\([^)]*\)[^{]*\{\s*await requireCapability\("settings:manage"\);/,
    );
  });
});
