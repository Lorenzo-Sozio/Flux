/**
 * Bringing a workspace up to date on its own.
 *
 * On the tested surface because this writes to a customer's database from a
 * request path. Two properties have to hold whatever else changes: it must never
 * build a database from nothing, because that is provisioning and belongs to the
 * admin panel; and it must never fail the request that triggered it, because a
 * schema that is behind is a degraded feature and not a broken product.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ensureTenantMigrated, forgetMigrationAttempt } from "./auto-migrate";
import { tenantMigrations } from "./migrations-tenant.generated";

const NEWEST = tenantMigrations.reduce((max, m) => Math.max(max, m.folderMillis), 0);
const OLDEST = tenantMigrations.reduce((min, m) => Math.min(min, m.folderMillis), NEWEST);

/**
 * The SQL a query would send, near enough to tell one statement from another.
 *
 * Literal fragments arrive as a chunk holding an array of strings, identifiers as
 * one holding a string, and bound parameters as bare values.
 */
function render(query: { queryChunks?: unknown[] }): string {
  return (query.queryChunks ?? [])
    .map((c) => {
      const chunk = c as { value?: unknown };
      if (Array.isArray(chunk?.value)) return chunk.value.join("");
      if (typeof chunk?.value === "string") return chunk.value;
      return "";
    })
    .join("");
}

/**
 * A database that answers the bookkeeping query with `recorded` and counts every
 * statement it is asked to run.
 */
function fakeDb(recorded: number | null) {
  const statements: string[] = [];
  return {
    statements,
    execute(query: unknown) {
      const text = render(query as { queryChunks?: unknown[] });
      statements.push(text);
      // Only the history read returns rows; everything else is a write.
      if (text.includes("created_at")) {
        return Promise.resolve(recorded === null ? [] : [{ created_at: recorded }]);
      }
      return Promise.resolve([]);
    },
  };
}

/** Counts the statements that are not the bookkeeping read or its CREATE guards. */
const writes = (db: ReturnType<typeof fakeDb>) =>
  db.statements.filter((s) => !s.includes("created_at") && !s.includes("CREATE SCHEMA")).length;

beforeEach(() => {
  for (const id of ["t1", "t2", "t3", "t4"]) forgetMigrationAttempt(id);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("ensureTenantMigrated", () => {
  it("does nothing to a database with no history", async () => {
    // ⚠️⚠️ Provisioning is the admin panel's job. Building a hundred and sixty-nine
    // statements' worth of schema on whichever page request arrived first is not a
    // decision a request gets to make.
    const db = fakeDb(null);
    // biome-ignore lint/suspicious/noExplicitAny: a stand-in for the driver
    await ensureTenantMigrated("t1", db as any);
    expect(writes(db)).toBe(0);
  });

  it("does nothing when the database is already current", async () => {
    const db = fakeDb(NEWEST);
    // biome-ignore lint/suspicious/noExplicitAny: a stand-in for the driver
    await ensureTenantMigrated("t2", db as any);
    expect(writes(db)).toBe(0);
  });

  it("applies what is pending when the database is behind", async () => {
    const db = fakeDb(OLDEST);
    // biome-ignore lint/suspicious/noExplicitAny: a stand-in for the driver
    await ensureTenantMigrated("t3", db as any);
    expect(writes(db)).toBeGreaterThan(0);
  });

  it("never throws, whatever the database says", async () => {
    const exploding = {
      execute: () => Promise.reject(new Error("connection reset")),
    };
    // biome-ignore lint/suspicious/noExplicitAny: a stand-in for the driver
    await expect(ensureTenantMigrated("t4", exploding as any)).resolves.toBeUndefined();
  });

  it("asks once per workspace, however many requests arrive", async () => {
    const db = fakeDb(NEWEST);
    await Promise.all(
      // biome-ignore lint/suspicious/noExplicitAny: a stand-in for the driver
      Array.from({ length: 5 }, () => ensureTenantMigrated("t2", db as any)),
    );
    // One history read, not five.
    expect(db.statements.filter((s) => s.includes("created_at")).length).toBe(1);
  });
});
