/**
 * The profile page's actions, and what the session trusts from the browser.
 *
 * ⚠️⚠️ Changing one's own password was only reachable from /dashboard/users, an admin page,
 * so an editor or a viewer could not do it at all. And a name lives in two places — the
 * account and each workspace's copy of its members, which is what every "owner" column
 * shows — so changing only the account left the old name beside every deal.
 */
import { readFileSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const platform = drizzle(new PGlite());
const workspaceA = drizzle(new PGlite());
const workspaceB = drizzle(new PGlite());

vi.mock("@/db", () => ({
  platformDb: platform,
  createTenantDb: (id: string) => {
    if (id === "broken") throw new Error("unreachable");
    return id === "a" ? workspaceA : workspaceB;
  },
}));
vi.mock("@/lib/get-tenant", () => ({ getTenantById: async (id: string) => ({ id, dbUrl: "encrypted" }) }));
vi.mock("@/lib/tenant-db", () => ({ decryptDbUrl: (u: string) => u }));
vi.mock("@/lib/auth-guard", () => ({
  requireCapability: async () => ({ userId: "u1", tenantRole: "viewer", isPlatformStaff: false }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { updateOwnNameAction, getOwnProfile } = await import("./profile");

beforeAll(async () => {
  await platform.execute(sql`create table "user" (id text primary key, name text, email text, password text)`);
  await platform.execute(sql`create table tenant_members (id text, tenant_id text, user_id text, role text)`);
  for (const w of [workspaceA, workspaceB]) await w.execute(sql`create table "user" (id text primary key, name text)`);
}, 60_000);

beforeEach(async () => {
  for (const d of [platform, workspaceA, workspaceB]) await d.execute(sql`delete from "user"`);
  await platform.execute(sql`delete from tenant_members`);
  await platform.execute(
    sql`insert into "user" (id, name, email, password) values ('u1', 'Old Name', 'u1@x.it', 'hash')`,
  );
  await platform.execute(
    sql`insert into tenant_members (id, tenant_id, user_id, role) values ('m1', 'a', 'u1', 'viewer'), ('m2', 'b', 'u1', 'editor')`,
  );
  await workspaceA.execute(sql`insert into "user" (id, name) values ('u1', 'Old Name')`);
  await workspaceB.execute(sql`insert into "user" (id, name) values ('u1', 'Old Name')`);
});

const nameIn = async (d: typeof platform) => (await d.execute(sql`select name from "user" where id = 'u1'`)).rows[0];

describe("⚠️⚠️ changing one's own name", () => {
  it("changes it on the account and in every workspace the person belongs to — whatever their role", async () => {
    expect(await updateOwnNameAction("  Anna   Rossi ")).toEqual({ ok: true });

    expect(await nameIn(platform)).toEqual({ name: "Anna Rossi" });
    expect(await nameIn(workspaceA)).toEqual({ name: "Anna Rossi" });
    expect(await nameIn(workspaceB)).toEqual({ name: "Anna Rossi" });
  });

  it("⚠️ a workspace that cannot be reached does not stop the others", async () => {
    await platform.execute(
      sql`insert into tenant_members (id, tenant_id, user_id, role) values ('m3', 'broken', 'u1', 'viewer')`,
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(await updateOwnNameAction("Anna Rossi")).toEqual({ ok: true });
    expect(await nameIn(workspaceA)).toEqual({ name: "Anna Rossi" });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("refuses an empty or absurd name, and changes nothing", async () => {
    expect(await updateOwnNameAction("   ")).toEqual({ ok: false, reason: "empty" });
    expect(await updateOwnNameAction("x".repeat(121))).toEqual({ ok: false, reason: "tooLong" });
    expect(await nameIn(platform)).toEqual({ name: "Old Name" });
  });

  it("tells the page whether there is a password to change", async () => {
    expect(await getOwnProfile()).toEqual({ name: "Old Name", email: "u1@x.it", hasPassword: true });
    await platform.execute(sql`update "user" set password = null`);
    expect((await getOwnProfile()).hasPassword).toBe(false);
  });
});

describe("⚠️ the session", () => {
  it("re-reads the name from the account on request, and never takes it from the browser", () => {
    const src = readFileSync("src/auth.ts", "utf8");
    expect(src).toContain("session?.refreshProfile");
    expect(src).not.toMatch(/token\.name\s*=\s*session/);
  });
});
