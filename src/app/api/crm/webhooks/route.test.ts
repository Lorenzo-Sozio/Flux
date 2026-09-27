/**
 * REST hooks — the subscribe and unsubscribe Zapier and Make call — against a real Postgres.
 *
 * ⚠️⚠️ A key removes only what a key made: a webhook an administrator set up on screen is
 * not a key's to switch off, and nothing on screen would say why the integration went quiet.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";

const db = drizzle(new PGlite());

vi.mock("@/db", () => ({ createTenantDb: () => db }));
const caller = vi.hoisted(() => ({
  key: { id: "k1", name: "Zapier" } as { id: string; name: string } | null,
  via: "apikey",
}));
vi.mock("@/lib/api-import-auth", () => ({
  gateApiRequest: async () => ({
    auth: {
      via: caller.via,
      userId: null,
      role: "admin",
      tenantId: "t1",
      scopes: caller.via === "apikey" ? ["webhooks:write"] : null,
      key: caller.key,
    },
  }),
}));
vi.mock("@/lib/get-tenant", () => ({ getTenantById: async () => ({ id: "t1", dbUrl: "x" }) }));
vi.mock("@/lib/tenant-db", () => ({ decryptDbUrl: () => "postgres://finto" }));
vi.mock("@/lib/billing/usage", () => ({
  checkAndTrackApiCall: async () => undefined,
  EntitlementError: class extends Error {},
}));
vi.mock("@/lib/webhook-validator", () => ({
  validateWebhookUrl: (u: string) => (u.startsWith("https://") ? null : "must be https"),
}));

const { POST } = await import("./route");
const { DELETE } = await import("./[id]/route");

const subscribe = (body: Record<string, unknown>) =>
  POST(
    new Request("https://x.test/api/crm/webhooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      // biome-ignore lint/suspicious/noExplicitAny: NextRequest is a Request at runtime
    }) as any,
  );
const unsubscribe = (id: string) =>
  // biome-ignore lint/suspicious/noExplicitAny: NextRequest is a Request at runtime
  DELETE(new Request(`https://x.test/api/crm/webhooks/${id}`, { method: "DELETE" }) as any, {
    params: Promise.resolve({ id }),
  });
const rows = async () =>
  (await db.execute(sql`select id, url, events, owner_id, secret from webhook order by created_at`)).rows as {
    id: string;
    url: string;
    events: string[];
    owner_id: string | null;
    secret: string;
  }[];

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  await db.execute(sql`delete from webhook`);
  await db.execute(sql`delete from api_write_log`);
  await db.execute(sql`delete from "user"`);
  await db.execute(sql`insert into "user" (id, name, email) values ('anna', 'Anna', 'anna@firm.it')`);
});

describe("⚠️⚠️ subscribing", () => {
  it("stores the URL and the events, with no owner, and hands the signing secret back once", async () => {
    const res = await subscribe({
      url: "https://hooks.zapier.com/1",
      events: ["contact.created", "bogus"],
      name: "Zapier",
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    const [row] = await rows();
    expect(row).toMatchObject({ url: "https://hooks.zapier.com/1", events: ["contact.created"], owner_id: null });
    expect(body).toEqual({ id: row.id, url: row.url, events: ["contact.created"], secret: row.secret });
    expect(row.secret).toMatch(/^[0-9a-f]{64}$/);
    // It is something an integration did.
    const [log] = (await db.execute(sql`select entity, record_id from api_write_log`)).rows;
    expect(log).toMatchObject({ entity: "webhook", record_id: row.id });
  });

  it("refuses an address that is not a public https URL, or no event at all", async () => {
    const res = await subscribe({ url: "http://10.0.0.1/hook", events: ["nonsense"] });
    expect(res.status).toBe(422);
    expect((await res.json()).errors.map((e: { field: string }) => e.field).sort()).toEqual(["events", "url"]);
    expect(await rows()).toEqual([]);
  });

  it("⚠️ stops at fifty: each one is a delivery on every event", async () => {
    for (let i = 0; i < 50; i++) {
      await db.execute(
        sql`insert into webhook (id, name, url, events, secret) values (${`w${i}`}, 'x', 'https://a.test', ARRAY['*'], 's')`,
      );
    }
    expect((await subscribe({ url: "https://hooks.zapier.com/2", events: ["deal.won"] })).status).toBe(422);
  });
});

describe("⚠️⚠️ unsubscribing", () => {
  it("removes what a key made", async () => {
    const { id } = await (await subscribe({ url: "https://hooks.zapier.com/1", events: ["*"] })).json();
    expect((await unsubscribe(id)).status).toBe(200);
    expect(await rows()).toEqual([]);
  });

  it("⚠️⚠️ but not what another integration's key made", async () => {
    const { id } = await (await subscribe({ url: "https://hooks.zapier.com/1", events: ["*"] })).json();
    caller.key = { id: "k2", name: "Make" };
    try {
      expect((await unsubscribe(id)).status).toBe(404);
      expect(await rows()).toHaveLength(1);
    } finally {
      caller.key = { id: "k1", name: "Zapier" };
    }
  });

  it("⚠️⚠️ never what an administrator set up on screen", async () => {
    await db.execute(
      sql`insert into webhook (id, name, url, events, secret, owner_id) values ('admin-made', 'ERP', 'https://erp.test', ARRAY['invoice.issued'], 's', 'anna')`,
    );
    expect((await unsubscribe("admin-made")).status).toBe(404);
    expect(await rows()).toHaveLength(1);
    // Not through the API with a session either: what was set up on screen is removed on screen.
    caller.via = "session";
    caller.key = null;
    try {
      expect((await unsubscribe("admin-made")).status).toBe(404);
    } finally {
      caller.via = "apikey";
      caller.key = { id: "k1", name: "Zapier" };
    }
    expect(await rows()).toHaveLength(1);
  });
});
