/**
 * «Seguito dall'assistente» through the API (src/lib/assistant-handling.ts), against a real
 * Postgres: the person is marked on every record, by the key's name, and unmarked.
 */
import { readFileSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";

const db = drizzle(new PGlite());

vi.mock("@/db", () => ({ createTenantDb: () => db }));
const caller = vi.hoisted(() => ({
  via: "apikey",
  key: { id: "k1", name: "VoipAI" } as { id: string; name: string } | null,
}));
vi.mock("@/lib/api-import-auth", () => ({
  gateApiRequest: async () => ({
    auth: {
      via: caller.via,
      userId: null,
      role: "admin",
      tenantId: "t1",
      scopes: caller.via === "apikey" ? ["assistant:write"] : null,
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

const { POST } = await import("./route");

const post = (body: unknown) =>
  POST(
    new Request("https://x.test/api/crm/assistant", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      // biome-ignore lint/suspicious/noExplicitAny: NextRequest is a Request at runtime
    }) as any,
  );
const marks = async () =>
  (
    await db.execute(sql`
      select 'lead' as t, id, assistant_name, assistant_since is not null as marked from lead
      union all
      select 'contact', id, assistant_name, assistant_since is not null from contact
      order by 1, 2`)
  ).rows;

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  caller.via = "apikey";
  caller.key = { id: "k1", name: "VoipAI" };
  await db.execute(sql`delete from api_write_log`);
  await db.execute(sql`delete from lead`);
  await db.execute(sql`delete from contact`);
  await db.execute(
    sql`insert into lead (id, first_name, last_name, phone) values ('l1', 'Anna', 'R', '+39 333 111 2223')`,
  );
  await db.execute(
    sql`insert into contact (id, first_name, last_name, mobile) values ('c1', 'Anna', 'R', '+39 3331112223'), ('c2', 'Bruno', 'V', '+39 348 000 0000')`,
  );
});

describe("⚠️⚠️ marking whom the assistant is working with", () => {
  it("marks every record of that person, by the key's name, and nobody else", async () => {
    const res = await post({ contactPoint: "+39 333 111 2223", handling: true });
    expect(res.status).toBe(200);
    expect(await marks()).toEqual([
      { t: "contact", id: "c1", assistant_name: "VoipAI", marked: true },
      { t: "contact", id: "c2", assistant_name: null, marked: false },
      { t: "lead", id: "l1", assistant_name: "VoipAI", marked: true },
    ]);
    const [log] = (await db.execute(sql`select entity, rows from api_write_log`)).rows;
    expect(log).toMatchObject({ entity: "assistant", rows: 2 });
  });

  it("lets go: the marks are cleared", async () => {
    await post({ contactPoint: "+39 333 111 2223", handling: true });
    await post({ contactPoint: "+39 333 111 2223", handling: false });
    expect((await marks()).every((m) => m.marked === false && m.assistant_name === null)).toBe(true);
  });

  it("⚠️⚠️ a mark belongs to the key that set it: another integration cannot clear it", async () => {
    await post({ contactPoint: "+39 333 111 2223", handling: true });
    caller.key = { id: "k2", name: "Zapier" };
    const res = await post({ contactPoint: "+39 333 111 2223", handling: false });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("held_by_another");
    expect((await marks()).filter((m) => m.marked).map((m) => m.id)).toEqual(["c1", "l1"]);
    // Nor take it over by marking in its own name.
    expect((await post({ contactPoint: "+39 333 111 2223", handling: true })).status).toBe(409);
    expect((await marks()).find((m) => m.id === "l1")?.assistant_name).toBe("VoipAI");
  });

  it("an administrator, signed in, may clear any mark", async () => {
    await post({ contactPoint: "+39 333 111 2223", handling: true });
    caller.via = "session";
    caller.key = null;
    expect((await post({ contactPoint: "+39 333 111 2223", handling: false })).status).toBe(200);
    expect((await marks()).every((m) => m.marked === false)).toBe(true);
  });

  it("marking again keeps the day the assistant took them", async () => {
    await post({ contactPoint: "+39 333 111 2223", handling: true });
    await db.execute(sql`update lead set assistant_since = '2026-09-01T10:00:00Z'`);
    await post({ contactPoint: "+39 333 111 2223", handling: true });
    const [row] = (await db.execute(sql`select assistant_since::text as since from lead`)).rows;
    expect(row).toEqual({ since: "2026-09-01 10:00:00" });
  });

  it("nobody at that address is a 404; a body without both fields is a 422 naming them", async () => {
    expect((await post({ contactPoint: "nobody@x.it", handling: true })).status).toBe(404);
    const bad = await post({ contactPoint: "", handling: "yes" });
    expect(bad.status).toBe(422);
    expect((await bad.json()).errors.map((e: { field: string }) => e.field).sort()).toEqual([
      "contactPoint",
      "handling",
    ]);
  });
});

describe("⚠️⚠️ every automatic audience leaves them out", () => {
  const read = (p: string) => readFileSync(p, "utf8").split("\r\n").join("\n");

  it("a campaign's recipients, its segment and its count", () => {
    // Both branches of both recipient types in the send; both types in the segment and the count.
    expect(read("src/lib/campaign-send.ts").match(/notWithAssistant\.(leads|contacts)/g)).toHaveLength(4);
    expect(read("src/lib/campaign-segment.ts").match(/notWithAssistant\.(leads|contacts)/g)).toHaveLength(2);
    expect(read("src/actions/marketing.ts").match(/notWithAssistant\.(leads|contacts)/g)).toHaveLength(2);
  });
});
