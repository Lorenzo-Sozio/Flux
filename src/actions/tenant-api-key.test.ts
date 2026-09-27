/**
 * Making, listing and revoking scoped keys from the settings screen: the workspace comes from
 * the session, the scopes are cleaned, and the key is shown once and stored as a hash.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";
import { hashKey, workspaceOfKey } from "@/lib/api-keys";

const db = drizzle(new PGlite());
const WS = "4f6c2a3e-1b2c-4d5e-8f90-123456789abc";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/db", () => ({ platformDb: {} }));
vi.mock("@/lib/tenant-context", () => ({ getDb: async () => db, getCurrentTenantId: async () => WS }));
vi.mock("@/lib/auth-guard", () => ({
  requireCapability: async () => ({ userId: "anna", tenantRole: "admin" }),
  requireAdminAccess: async () => ({ user: { id: "anna", role: "admin" } }),
}));

const { createApiKeyAction, listApiKeys, revokeApiKeyAction } = await import("./tenant-api-key");

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  await db.execute(sql`delete from api_key`);
  await db.execute(sql`delete from "user"`);
  await db.execute(sql`insert into "user" (id, name, email) values ('anna', 'Anna', 'anna@firm.it')`);
});

describe("⚠️⚠️ a key made from the screen", () => {
  it("belongs to the session's workspace, keeps only real scopes, and is stored as its hash", async () => {
    const made = await createApiKeyAction({ name: " Sito ", scopes: ["leads:write", "*", "contacts:read"] });
    if (!made.ok) throw new Error("refused");
    expect(workspaceOfKey(made.key)).toBe(WS);
    const [row] = (await db.execute(sql`select name, hash, scopes, created_by from api_key`)).rows as {
      name: string;
      hash: string;
      scopes: string[];
      created_by: string;
    }[];
    expect(row).toMatchObject({ name: "Sito", hash: hashKey(made.key), created_by: "anna" });
    expect(row.scopes).toEqual(["contacts:read", "leads:write"]);
    expect(JSON.stringify(await listApiKeys())).not.toContain(made.key);
  });

  it("⚠️ refuses a key without a name, or one that may do nothing", async () => {
    expect(await createApiKeyAction({ name: " ", scopes: ["leads:write"] })).toMatchObject({ ok: false });
    expect(await createApiKeyAction({ name: "Vuota", scopes: ["*"] })).toMatchObject({ ok: false });
    expect(await listApiKeys()).toEqual([]);
  });

  it("revoked, it leaves the list at once", async () => {
    await createApiKeyAction({ name: "Zapier", scopes: ["contacts:read"] });
    const [key] = await listApiKeys();
    expect(key).toMatchObject({ name: "Zapier", createdBy: "Anna" });
    await revokeApiKeyAction(key.id);
    expect(await listApiKeys()).toEqual([]);
  });

  it("⚠️⚠️ revoked, what it subscribed stops too — and only what it subscribed", async () => {
    await createApiKeyAction({ name: "Zapier", scopes: ["webhooks:write"] });
    const [key] = await listApiKeys();
    await db.execute(sql`insert into webhook (id, name, url, events, secret, api_key_id) values
      ('mine', 'Zap', 'https://hooks.zapier.com/1', ARRAY['*'], 's', ${key.id}),
      ('other', 'Make', 'https://hook.make.com/1', ARRAY['*'], 's', 'another-key')`);
    await revokeApiKeyAction(key.id);
    const rows = (await db.execute(sql`select id, is_active from webhook order by id`)).rows;
    expect(rows).toEqual([
      { id: "mine", is_active: false },
      { id: "other", is_active: true },
    ]);
  });
});
