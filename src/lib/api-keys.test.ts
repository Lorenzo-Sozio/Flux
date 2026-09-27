/**
 * Scoped keys (src/lib/api-keys.ts, src/lib/api-scopes.ts): made, recognised, looked up —
 * against a real Postgres, because "revoked means refused" is a WHERE clause.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";

import { findScopedKey, hashKey, newScopedKey, workspaceOfKey } from "./api-keys";
import { ALL_SCOPES, cleanScopes, grants, WRITE_ALL } from "./api-scopes";

const db = drizzle(new PGlite());
const WS = "4f6c2a3e-1b2c-4d5e-8f90-123456789abc";

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  await db.execute(sql`delete from api_key`);
});

async function store(key: string, scopes: string[], over: { revoked?: boolean; lastUsed?: string } = {}) {
  await db.execute(sql`insert into api_key (id, name, hash, hint, scopes, revoked_at, last_used_at)
    values ('k1', 'Sito', ${hashKey(key)}, ${key.slice(-4)}, ${sql.raw(`ARRAY[${scopes.map((s) => `'${s}'`).join(",")}]::text[]`)},
      ${over.revoked ? sql`now()` : null}, ${over.lastUsed ? sql.raw(`'${over.lastUsed}'::timestamp`) : null})`);
}

describe("a key", () => {
  it("names its workspace and nothing else can be read from it", () => {
    const { key, hash, hint } = newScopedKey(WS);
    expect(key.startsWith(`flx2.${WS}.`)).toBe(true);
    expect(workspaceOfKey(key)).toBe(WS);
    expect(hash).toBe(hashKey(key));
    expect(hash).not.toContain(key.split(".").at(-1));
    expect(hint).toBe(key.slice(-4));
    // Two keys for the same workspace share nothing but the id.
    expect(newScopedKey(WS).key).not.toBe(key);
  });

  it("⚠️ anything that is not one is not read as one: old keys, junk, a missing secret", () => {
    expect(workspaceOfKey(`flx_${"a".repeat(64)}`)).toBeNull();
    expect(workspaceOfKey(`flx2.${WS}.short`)).toBeNull();
    expect(workspaceOfKey(`flx2..${"a".repeat(43)}`)).toBeNull();
    expect(workspaceOfKey(`flx2.a b.${"a".repeat(43)}`)).toBeNull();
    expect(() => newScopedKey("not.a.workspace")).toThrow();
  });
});

describe("⚠️⚠️ looking it up", () => {
  it("finds a live key by its exact value and returns what it may do", async () => {
    const { key } = newScopedKey(WS);
    await store(key, ["contacts:read", "leads:write"]);
    expect(await findScopedKey(db as never, key)).toEqual({
      id: "k1",
      name: "Sito",
      scopes: ["contacts:read", "leads:write"],
    });
    // One character different is another key.
    expect(await findScopedKey(db as never, `${key.slice(0, -1)}${key.endsWith("A") ? "B" : "A"}`)).toBeNull();
  });

  it("⚠️⚠️ a revoked key opens nothing", async () => {
    const { key } = newScopedKey(WS);
    await store(key, WRITE_ALL as string[], { revoked: true });
    expect(await findScopedKey(db as never, key)).toBeNull();
  });

  it("writes when it was last used, at most once an hour", async () => {
    const { key } = newScopedKey(WS);
    await store(key, ["contacts:read"], { lastUsed: "2026-09-20 11:30:00" });
    const lastUsed = async () =>
      ((await db.execute(sql`select last_used_at::text as t from api_key`)).rows[0] as { t: string }).t;
    await findScopedKey(db as never, key, new Date("2026-09-20T12:00:00Z"));
    expect(await lastUsed()).toBe("2026-09-20 11:30:00");
    await findScopedKey(db as never, key, new Date("2026-09-20T13:00:00Z"));
    expect(await lastUsed()).toBe("2026-09-20 13:00:00");
  });
});

describe("scopes", () => {
  it("⚠️⚠️ only real ones are kept: no wildcard, no invented entity, no read of what cannot be read", () => {
    expect(cleanScopes(["*", "contacts:read", "everything:write", "activities:read", "contacts:read"])).toEqual([
      "contacts:read",
    ]);
    expect(cleanScopes("contacts:read")).toEqual([]);
    expect(ALL_SCOPES).not.toContain("activities:read");
  });

  it("⚠️⚠️ the keys from before scopes keep exactly the eight writes they had, and gain nothing later", () => {
    // Subscribing to events is a way to read everything; marking people is new power. Neither
    // existed when those keys were made, so neither reaches them.
    expect([...WRITE_ALL].sort()).toEqual(
      [
        "activities:write",
        "companies:write",
        "contacts:write",
        "custom_fields:write",
        "deals:write",
        "leads:write",
        "orders:write",
        "privacy:write",
      ].sort(),
    );
    expect(ALL_SCOPES).toContain("products:read");
    expect(ALL_SCOPES).not.toContain("products:write");
  });

  it("⚠️⚠️ write does not imply read", () => {
    expect(grants(WRITE_ALL, { entity: "contacts", access: "write" })).toBe(true);
    expect(grants(WRITE_ALL, { entity: "contacts", access: "read" })).toBe(false);
  });
});
