/**
 * A draft quote proposed through the API (src/lib/quote-draft.ts), against a real Postgres:
 * the prices are Flux's, the quote stays a draft, the owner hears of it, a retry is one draft.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";

const db = drizzle(new PGlite());
const notified: { userId: string; type: string; params?: Record<string, unknown> }[] = [];

vi.mock("@/db", () => ({ createTenantDb: () => db }));
vi.mock("@/lib/api-import-auth", () => ({
  gateApiRequest: async () => ({
    auth: {
      via: "apikey",
      userId: null,
      role: "editor",
      tenantId: "t1",
      scopes: ["quotes:write"],
      key: { id: "k1", name: "VoipAI" },
    },
  }),
}));
vi.mock("@/lib/get-tenant", () => ({ getTenantById: async () => ({ id: "t1", dbUrl: "x" }) }));
vi.mock("@/lib/tenant-db", () => ({ decryptDbUrl: () => "postgres://finto" }));
vi.mock("@/lib/billing/usage", () => ({
  checkAndTrackApiCall: async () => undefined,
  EntitlementError: class extends Error {},
}));
vi.mock("@/lib/tenant-context", () => ({ runWithTenant: (_: string, fn: () => Promise<unknown>) => fn() }));
vi.mock("@/lib/notify", () => ({
  notify: async (n: { userId: string; type: string; params?: Record<string, unknown> }) => {
    notified.push(n);
  },
}));

const { POST } = await import("./route");

const post = (body: unknown, key?: string) =>
  POST(
    new Request("https://x.test/api/crm/quotes", {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
      body: JSON.stringify(body),
      // biome-ignore lint/suspicious/noExplicitAny: NextRequest is a Request at runtime
    }) as any,
  );
const rows = async (q: ReturnType<typeof sql>) => (await db.execute(q)).rows as Record<string, unknown>[];

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  notified.length = 0;
  for (const t of [
    "quote_activity",
    "quote_item",
    "quote",
    "api_idempotency",
    "api_write_log",
    "deal",
    "price_list_item",
    "contact",
    "company",
    "price_list",
    "product",
  ]) {
    await db.execute(sql.raw(`delete from "${t}"`));
  }
  await db.execute(sql`delete from "user"`);
  await db.execute(sql`insert into "user" (id, name, email) values ('anna', 'Anna', 'anna@firm.it')`);
  await db.execute(sql`insert into product (id, name, price, tax_percent, is_active) values
    ('p1', 'Margherita', '7.00', '10', true), ('p2', 'Diavola', '8.00', '10', true), ('old', 'Vecchia', '5.00', '10', false)`);
  await db.execute(
    sql`insert into price_list (id, name, adjustment_percent, is_active) values ('pl1', 'Bar', '-10', true)`,
  );
  await db.execute(
    sql`insert into price_list_item (id, price_list_id, product_id, unit_price) values ('i1', 'pl1', 'p2', '6.00')`,
  );
  await db.execute(sql`insert into company (id, name, price_list_id) values ('co1', 'Bar Roma', 'pl1')`);
  await db.execute(
    sql`insert into deal (id, name, amount, company_id, owner_id) values ('d1', 'Fornitura', '0', 'co1', 'anna'), ('d2', 'Senza azienda', '0', null, 'anna')`,
  );
});

describe("⚠️⚠️ a draft quote from the assistant", () => {
  it("prices every line from the customer's list, stays a draft, and tells the deal's owner", async () => {
    const res = await post({
      dealId: "d1",
      lines: [
        { productId: "p1", quantity: 2, note: "senza cipolla" },
        { productId: "p2", quantity: 1 },
      ],
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.lines).toEqual([
      { productId: "p1", description: "Margherita — senza cipolla", quantity: 2, unitPrice: 6.3, taxPercent: 10 },
      { productId: "p2", description: "Diavola", quantity: 1, unitPrice: 6, taxPercent: 10 },
    ]);
    // 12.60 + 6.00 net, plus 10% tax.
    expect(body.total).toBe(20.46);
    const [quote] = await rows(sql`select status, owner_id, company_id, total_amount from quote`);
    expect(quote).toMatchObject({ status: "draft", owner_id: "anna", company_id: "co1", total_amount: "20.46" });
    expect(await rows(sql`select type from quote_activity`)).toEqual([{ type: "proposed" }]);
    expect(notified).toEqual([
      expect.objectContaining({
        userId: "anna",
        type: "quote_proposed",
        params: { number: body.quoteNumber, who: "VoipAI" },
      }),
    ]);
  });

  it("⚠️⚠️ refuses a line without a product — that price would be made up — and an inactive or unknown one", async () => {
    const res = await post({ dealId: "d1", lines: [{ quantity: 1, unitPrice: 999 }] });
    expect(res.status).toBe(422);
    // The reason, not only the field: it is the rule the integrator has to learn.
    expect((await res.json()).errors[0]).toEqual({
      field: "lines[0].productId",
      message: "Every line names a product: prices come from the catalogue",
    });
    const inactive = await post({
      dealId: "d1",
      lines: [
        { productId: "old", quantity: 1 },
        { productId: "nope", quantity: 1 },
      ],
    });
    expect(inactive.status).toBe(422);
    expect((await inactive.json()).errors.map((e: { field: string }) => e.field)).toEqual([
      "lines[0].productId",
      "lines[1].productId",
    ]);
    expect(await rows(sql`select id from quote`)).toEqual([]);
  });

  it("⚠️ a quantity in fractions of a unit is a 422, not a 500 after the key was claimed", async () => {
    const res = await post({ dealId: "d1", lines: [{ productId: "p1", quantity: 1.5 }] });
    expect(res.status).toBe(422);
  });

  it("⚠️ a contact that does not exist, or works elsewhere, is refused: nobody else is sent these prices", async () => {
    await db.execute(sql`insert into company (id, name) values ('co2', 'Altra')`);
    await db.execute(sql`insert into contact (id, first_name, last_name, company_id) values
      ('mine', 'Mario', 'Rossi', 'co1'), ('theirs', 'Luigi', 'Verdi', 'co2')`);
    const line = [{ productId: "p1", quantity: 1 }];
    expect((await post({ dealId: "d1", contactId: "nope", lines: line })).status).toBe(422);
    expect((await post({ dealId: "d1", contactId: "theirs", lines: line })).status).toBe(422);
    expect((await post({ dealId: "d1", contactId: "mine", lines: line })).status).toBe(201);
  });

  it("a deal that does not exist is a 404; one with no company to quote is a 422", async () => {
    expect((await post({ dealId: "nope", lines: [{ productId: "p1", quantity: 1 }] })).status).toBe(404);
    expect((await post({ dealId: "d2", lines: [{ productId: "p1", quantity: 1 }] })).status).toBe(422);
  });

  it("⚠️ asked twice with the same key, it is one draft", async () => {
    const body = { dealId: "d1", lines: [{ productId: "p1", quantity: 1 }] };
    const first = await (await post(body, "k-1")).json();
    const again = await post(body, "k-1");
    expect(again.headers.get("Idempotent-Replay")).toBe("true");
    // The same answer, status included: the draft was created, and a repeat says so.
    expect(again.status).toBe(201);
    expect((await again.json()).id).toBe(first.id);
    expect(await rows(sql`select id from quote`)).toHaveLength(1);
  });
});
