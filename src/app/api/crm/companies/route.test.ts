/**
 * The company import route, against a real Postgres.
 *
 * ⚠️⚠️ The duplicate was found with `ilike(name, <the caller's name>)`, and the update
 * used that same condition to choose what to overwrite. In `ilike` the caller's text is
 * a pattern: `%` matches every row. A company called "%" sent with
 * `onDuplicate: "update"` rewrote every company in the workspace with its own data —
 * industry, website, owner, VAT number — and answered 200 "updated".
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";

const db = drizzle(new PGlite());

vi.mock("@/db", () => ({ createTenantDb: () => db }));
vi.mock("@/lib/api-import-auth", () => ({
  gateApiRequest: async () => ({
    auth: { via: "apikey", userId: null, role: "editor", tenantId: "t1", scopes: null },
  }),
}));
vi.mock("@/lib/get-tenant", () => ({ getTenantById: async () => ({ id: "t1", dbUrl: "x" }) }));
vi.mock("@/lib/tenant-db", () => ({ decryptDbUrl: () => "postgres://finto" }));
vi.mock("@/lib/billing/usage", () => ({
  checkAndTrackApiCall: async () => undefined,
  EntitlementError: class extends Error {},
}));
vi.mock("@/lib/webhook-dispatch", () => ({ dispatchWebhook: () => undefined }));
vi.mock("@/lib/api-automations", () => ({ runRulesAfterApiWrite: () => undefined }));

const { POST } = await import("./route");

function richiesta(body: Record<string, unknown>) {
  return new Request("https://x.test/api/crm/companies", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    // biome-ignore lint/suspicious/noExplicitAny: NextRequest is a Request at runtime
  }) as any;
}

async function industries(): Promise<Record<string, string | null>> {
  const rows = await db.execute<{ name: string; industry: string | null }>(sql`select name, industry from company`);
  return Object.fromEntries(rows.rows.map((r) => [r.name, r.industry]));
}

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  await db.execute(sql`delete from company`);
  await db.execute(sql`insert into company (id, name, industry) values ('a', 'Alfa Srl', 'Edilizia')`);
  await db.execute(sql`insert into company (id, name, industry) values ('b', 'Beta Spa', 'Moda')`);
});

describe("⚠️⚠️ a company name is a name, not a pattern", () => {
  it("a company called «%» updates nobody: it is a new company", async () => {
    const r = await POST(richiesta({ name: "%", industry: "Sovrascritto", onDuplicate: "update" }));

    expect(r.status).toBe(201);
    expect(await industries()).toEqual({ "Alfa Srl": "Edilizia", "Beta Spa": "Moda", "%": "Sovrascritto" });
  });

  it("an underscore does not stand for any letter either", async () => {
    await POST(richiesta({ name: "Alfa_Srl", industry: "Sovrascritto", onDuplicate: "update" }));

    expect((await industries())["Alfa Srl"]).toBe("Edilizia");
  });

  it("the same name in other capitals is the same company, and only that one changes", async () => {
    const r = await POST(richiesta({ name: "ALFA SRL", industry: "Impianti", onDuplicate: "update" }));
    const body = await r.json();

    expect(body).toMatchObject({ status: "updated", id: "a" });
    expect(await industries()).toEqual({ "ALFA SRL": "Impianti", "Beta Spa": "Moda" });
  });

  it("updates the one row it found, even where the name matches two", async () => {
    // Duplicates that predate this route exist in real workspaces. The answer names one
    // id; overwriting a second row the caller was never told about is the same failure
    // as the wildcard, only smaller.
    await db.execute(sql`insert into company (id, name, industry) values ('a2', 'alfa srl', 'Edilizia')`);

    const r = await POST(richiesta({ name: "Alfa Srl", industry: "Impianti", onDuplicate: "update" }));
    const { id } = await r.json();

    const rows = await db.execute<{ id: string; industry: string }>(
      sql`select id, industry from company where lower(name) = 'alfa srl' order by id`,
    );
    const changed = rows.rows.filter((row) => row.industry === "Impianti").map((row) => row.id);
    expect(changed).toEqual([id]);
  });
});
