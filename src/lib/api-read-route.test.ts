/**
 * What an integration reads to work the way this business does (V3.1 F4): the stages it
 * uses, and the price a given customer pays — against a real Postgres.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";

const db = drizzle(new PGlite());

// Who is signed in, for a request made with a session.
const signedIn = vi.hoisted(() => ({
  actor: null as null | {
    userId: string;
    tenantRole: "owner" | "admin" | "editor" | "viewer";
    isPlatformStaff: boolean;
  },
}));
vi.mock("@/lib/auth-guard", () => ({ getActor: async () => signedIn.actor }));

vi.mock("@/db", () => ({ createTenantDb: () => db }));
vi.mock("@/lib/get-tenant", () => ({ getTenantById: async () => ({ id: "t1", dbUrl: "x" }) }));
vi.mock("@/lib/tenant-db", () => ({ decryptDbUrl: () => "postgres://finto" }));
vi.mock("@/lib/billing/usage", () => ({
  checkAndTrackApiCall: async () => undefined,
  EntitlementError: class extends Error {},
}));

const { listResponse } = await import("./api-read-route");
const { listPipelineStages } = await import("./api-read");

const WHO = { via: "apikey", userId: null, role: "editor", tenantId: "t1", scopes: null, key: null } as const;
const products = async (query = "") => {
  const res = await listResponse(new Request(`https://x.test/api/crm/products${query}`), WHO, "products");
  return { status: res.status, body: await res.json() };
};

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  for (const t of ["price_list_item", "company", "price_list", "product", "deal", "pipeline_stage"]) {
    await db.execute(sql.raw(`delete from "${t}"`));
  }
  await db.execute(sql`delete from pipeline where id <> 'default'`);
  await db.execute(sql`insert into product (id, name, price, tax_percent) values
    ('p1', 'Margherita', '7.00', '10'), ('p2', 'Diavola', '8.00', '10'), ('p3', 'Bibita', '2.50', '22')`);
  await db.execute(
    sql`insert into price_list (id, name, adjustment_percent, is_active) values ('pl1', 'Rivenditori', '-10', true)`,
  );
  await db.execute(
    sql`insert into price_list_item (id, price_list_id, product_id, unit_price) values ('i1', 'pl1', 'p2', '6.00')`,
  );
  await db.execute(
    sql`insert into company (id, name, price_list_id) values ('co1', 'Bar Roma', 'pl1'), ('co2', 'Privato', null)`,
  );
});

describe("⚠️⚠️ the price a customer pays", () => {
  it("is the salesperson's price: the list's percentage, a price written for the product, or the catalogue", async () => {
    const { body } = await products("?companyId=co1");
    const byId = Object.fromEntries(body.data.map((p: Record<string, unknown>) => [p.id, p]));
    expect(byId.p1).toMatchObject({ price: 7, customerPrice: 6.3, priceSource: "percent", priceListId: "pl1" });
    expect(byId.p2).toMatchObject({ price: 8, customerPrice: 6, priceSource: "override" });
    expect(byId.p3).toMatchObject({ customerPrice: 2.25, priceSource: "percent" });
  });

  it("⚠️ a customer on no list, or on a list switched off, pays the catalogue", async () => {
    const own = await products("?companyId=co2");
    expect(
      own.body.data.every((p: Record<string, unknown>) => p.priceSource === "base" && p.customerPrice === p.price),
    ).toBe(true);
    await db.execute(sql`update price_list set is_active = false`);
    const retired = await products("?companyId=co1");
    expect(retired.body.data.every((p: Record<string, unknown>) => p.priceSource === "base")).toBe(true);
  });

  it("without a customer, the catalogue as it is; with an unknown one, a 400 naming it", async () => {
    const plain = await products();
    expect(plain.body.data[0]).not.toHaveProperty("customerPrice");
    expect(plain.body.data[0]).toMatchObject({ taxPercent: 10 });
    const unknown = await products("?companyId=nope");
    expect(unknown).toMatchObject({ status: 400, body: { field: "companyId" } });
  });
});

describe("the stages this business uses", () => {
  it("each pipeline with its stages in board order, each saying whether it is open, won or lost", async () => {
    await db.execute(sql`insert into pipeline (id, name, "order") values ('renew', 'Rinnovi', 1)`);
    await db.execute(sql`insert into pipeline_stage (id, name, "order", default_probability, is_won, is_lost, pipeline_id, stale_after_days) values
      ('s2', 'Proposta', 2, 50, false, false, 'default', 14),
      ('s1', 'Qualificato', 1, 20, false, false, 'default', null),
      ('w', 'Vinta', 3, 100, true, false, 'default', null),
      ('r1', 'Da rinnovare', 1, 60, false, true, 'renew', null)`);
    const data = await listPipelineStages(db as never);
    expect(data.map((p) => p.id)).toEqual(["default", "renew"]);
    expect(data[0].stages).toEqual([
      { id: "s1", name: "Qualificato", order: 1, probability: 20, staleAfterDays: null, kind: "open" },
      { id: "s2", name: "Proposta", order: 2, probability: 50, staleAfterDays: 14, kind: "open" },
      { id: "w", name: "Vinta", order: 3, probability: 100, staleAfterDays: null, kind: "won" },
    ]);
    expect(data[1].stages.map((st) => st.kind)).toEqual(["lost"]);
  });
});

describe("⚠️⚠️ a signed-in person reads what they see on the screens", () => {
  beforeAll(async () => {
    await db.execute(sql`insert into "user" (id, email, name) values ('anna', 'anna@x.it', 'Anna'), ('bruno', 'bruno@x.it', 'Bruno')
      on conflict do nothing`);
    await db.execute(sql`insert into lead (id, first_name, last_name, owner_id) values
      ('l-anna', 'A', 'A', 'anna'), ('l-bruno', 'B', 'B', 'bruno'), ('l-pool', 'P', 'P', null)`);
  });

  const leadIds = async (who: Parameters<typeof listResponse>[1]) => {
    const res = await listResponse(new Request("https://x.test/api/crm/leads"), who, "leads");
    return ((await res.json()).data as { id: string }[]).map((l) => l.id).sort();
  };
  const session = (userId: string, role: "admin" | "editor") => {
    signedIn.actor = { userId, tenantRole: role, isPlatformStaff: false };
    return { via: "session", userId, role, tenantId: "t1", scopes: null, key: null } as const;
  };

  it("a salesperson pages through their own and the unassigned, never a colleague's", async () => {
    expect(await leadIds(session("anna", "editor"))).toEqual(["l-anna", "l-pool"]);
  });

  it("an administrator reads them all; so does a key, which is a machine", async () => {
    expect(await leadIds(session("anna", "admin"))).toEqual(["l-anna", "l-bruno", "l-pool"]);
    signedIn.actor = null;
    expect(await leadIds(WHO)).toEqual(["l-anna", "l-bruno", "l-pool"]);
  });
});
