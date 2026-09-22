/**
 * The price list actions, against a real Postgres.
 *
 * ⚠️ What is checked here is the SQL, not the arithmetic — `price-list.test.ts` owns
 * the arithmetic. These are the four things only a database can answer, and each of
 * them fails as a plausible screen rather than as an error:
 *
 *  1. the two counts on the list page are subqueries, so a wrong join would multiply
 *     "how many customers are on this list" by the number of prices it names;
 *  2. setting a price twice must leave one row, because the unique index is the only
 *     thing standing between two writers and a product with two prices;
 *  3. deleting a list must take its prices with it and leave its customers alone, on
 *     catalogue prices — the foreign keys say so, and a migration that forgot one
 *     would only show up when somebody deleted a list;
 *  4. the rules a form prices against have to come back with the overrides keyed by
 *     product, or every line quietly takes the percentage.
 *
 * The guards are mocked away: `permissions.test.ts` owns who may do this, and
 * `price-lists.test.ts` in the same folder as the action would otherwise need a session.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";
import { parseListParams } from "@/lib/pagination";

const db = drizzle(new PGlite());

vi.mock("@/lib/tenant-context", () => ({ getDb: async () => db, getCurrentTenantId: async () => "t1" }));
vi.mock("@/lib/auth-guard", () => ({
  requireCapability: async () => ({ userId: "u1", tenantRole: "admin" }),
  requirePlanModule: async () => undefined,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const {
  assignPriceList,
  createPriceList,
  deletePriceList,
  getCompanyPriceRules,
  getPriceList,
  getPriceListsForSelect,
  getPriceRules,
  listPriceLists,
  removePriceListItem,
  setPriceListItem,
  updatePriceList,
} = await import("./price-lists");

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  await db.execute(sql`delete from price_list_item`);
  await db.execute(sql`delete from company`);
  await db.execute(sql`delete from price_list`);
  await db.execute(sql`delete from product`);
});

async function product(id: string, name: string, price: string) {
  await db.execute(sql`insert into product (id, name, price) values (${id}, ${name}, ${price})`);
}
async function company(id: string, name: string, priceListId: string | null = null) {
  await db.execute(sql`insert into company (id, name, price_list_id) values (${id}, ${name}, ${priceListId})`);
}
const params = (over: Partial<ReturnType<typeof parseListParams>> = {}) => ({ ...parseListParams({}), ...over });

describe("a list and what it names", () => {
  it("is created, read back and changed", async () => {
    const created = await createPriceList({ name: "Rivenditori", adjustmentPercent: -10, isActive: true });
    expect(created?.id).toBeTruthy();
    expect(Number(created?.adjustmentPercent)).toBe(-10);

    await updatePriceList(created.id, { adjustmentPercent: 5, description: "Canale indiretto" });
    const read = await getPriceList(created.id);
    expect(Number(read?.list.adjustmentPercent)).toBe(5);
    expect(read?.list.description).toBe("Canale indiretto");
  });

  it("refuses a percentage outside the bounds, before writing anything", async () => {
    await expect(createPriceList({ name: "Assurdo", adjustmentPercent: -150, isActive: true })).rejects.toThrow();
    expect(await listPriceLists(params())).toMatchObject({ total: 0 });
  });

  it("⚠️ counts prices and customers per list, not one multiplied by the other", async () => {
    const a = await createPriceList({ name: "A", adjustmentPercent: -10, isActive: true });
    const b = await createPriceList({ name: "B", adjustmentPercent: 0, isActive: true });
    await product("p1", "Uno", "100.00");
    await product("p2", "Due", "50.00");
    await setPriceListItem(a.id, "p1", 80);
    await setPriceListItem(a.id, "p2", 40);
    await company("c1", "Alfa", a.id);
    await company("c2", "Beta", a.id);
    await company("c3", "Gamma", b.id);

    const page = await listPriceLists(params());
    const rows = Object.fromEntries(page.rows.map((r) => [r.name, r]));
    expect(Number(rows.A.priceCount)).toBe(2);
    expect(Number(rows.A.companyCount)).toBe(2);
    expect(Number(rows.B.priceCount)).toBe(0);
    expect(Number(rows.B.companyCount)).toBe(1);
    expect(page.total).toBe(2);
  });

  it("searches by name and description, and filters by active", async () => {
    await createPriceList({
      name: "Rivenditori",
      description: "canale indiretto",
      adjustmentPercent: -10,
      isActive: true,
    });
    await createPriceList({ name: "Dismesso", adjustmentPercent: 0, isActive: false });

    expect((await listPriceLists(params({ search: "rivend" }))).total).toBe(1);
    expect((await listPriceLists(params({ search: "indiretto" }))).total).toBe(1);
    expect((await listPriceLists(params(), "inactive")).rows.map((r) => r.name)).toEqual(["Dismesso"]);
    // The picker offers only lists still in use.
    expect((await getPriceListsForSelect()).map((r) => r.name)).toEqual(["Rivenditori"]);
  });
});

describe("the price of one product in one list", () => {
  it("⚠️⚠️ set twice leaves one row with the second price, not a duplicate", async () => {
    const list = await createPriceList({ name: "A", adjustmentPercent: -10, isActive: true });
    await product("p1", "Uno", "100.00");
    await setPriceListItem(list.id, "p1", 80);
    await setPriceListItem(list.id, "p1", 75);

    const read = await getPriceList(list.id);
    expect(read?.items).toHaveLength(1);
    expect(Number(read?.items[0].unitPrice)).toBe(75);
  });

  it("refuses a negative price without writing it", async () => {
    const list = await createPriceList({ name: "A", adjustmentPercent: 0, isActive: true });
    await product("p1", "Uno", "100.00");
    await expect(setPriceListItem(list.id, "p1", -1)).rejects.toThrow();
    expect((await getPriceList(list.id))?.items).toHaveLength(0);
  });

  it("is removed on its own, leaving the rest of the list", async () => {
    const list = await createPriceList({ name: "A", adjustmentPercent: 0, isActive: true });
    await product("p1", "Uno", "100.00");
    await product("p2", "Due", "50.00");
    await setPriceListItem(list.id, "p1", 80);
    await setPriceListItem(list.id, "p2", 40);
    await removePriceListItem(list.id, "p1");

    const read = await getPriceList(list.id);
    expect(read?.items.map((i) => i.productId)).toEqual(["p2"]);
  });

  it("⚠️ goes away with the product it prices, rather than leaving a price for nothing", async () => {
    const list = await createPriceList({ name: "A", adjustmentPercent: 0, isActive: true });
    await product("p1", "Uno", "100.00");
    await setPriceListItem(list.id, "p1", 80);
    await db.execute(sql`delete from product where id = 'p1'`);
    expect((await getPriceList(list.id))?.items).toHaveLength(0);
  });
});

describe("what a form prices against", () => {
  it("⚠️ comes back keyed by product, with the percentage beside it", async () => {
    const list = await createPriceList({ name: "Rivenditori", adjustmentPercent: -10, isActive: true });
    await product("p1", "Uno", "100.00");
    await product("p2", "Due", "50.00");
    await setPriceListItem(list.id, "p1", 80);

    const rules = await getPriceRules(list.id);
    expect(rules).toEqual({ id: list.id, name: "Rivenditori", adjustmentPercent: -10, overrides: { p1: 80 } });
  });

  it("follows the customer, and is nothing for a customer on no list", async () => {
    const list = await createPriceList({ name: "Rivenditori", adjustmentPercent: -10, isActive: true });
    await company("c1", "Alfa", list.id);
    await company("c2", "Beta", null);

    expect((await getCompanyPriceRules("c1"))?.id).toBe(list.id);
    expect(await getCompanyPriceRules("c2")).toBeNull();
    expect(await getCompanyPriceRules("ghost")).toBeNull();
    expect(await getPriceRules("ghost")).toBeNull();
  });
});

describe("a list that has been turned off", () => {
  it("⚠️⚠️ stops pricing the customers already on it, not just new ones", async () => {
    const list = await createPriceList({ name: "Vecchio", adjustmentPercent: -30, isActive: true });
    await product("p1", "Uno", "100.00");
    await setPriceListItem(list.id, "p1", 50);
    await company("c1", "Alfa", list.id);
    expect((await getCompanyPriceRules("c1"))?.overrides).toEqual({ p1: 50 });

    await updatePriceList(list.id, { isActive: false });

    // Turning a list off is how a workspace says "nobody is to be quoted from this
    // any more". Leaving it pricing the customers already on it would have made the
    // switch mean "nobody new", silently.
    expect(await getCompanyPriceRules("c1")).toBeNull();
    expect(await getPriceRules(list.id)).toBeNull();
  });

  it("⚠️ is still offered to the customer it is assigned to, and to nobody else", async () => {
    const live = await createPriceList({ name: "Attivo", adjustmentPercent: -10, isActive: true });
    const retired = await createPriceList({ name: "Vecchio", adjustmentPercent: -30, isActive: false });

    expect((await getPriceListsForSelect()).map((r) => r.name)).toEqual(["Attivo"]);
    const offered = await getPriceListsForSelect(retired.id);
    expect(offered.map((r) => r.name)).toEqual(["Attivo", "Vecchio"]);
    expect(offered.find((r) => r.id === retired.id)?.isActive).toBe(false);
    expect(offered.find((r) => r.id === live.id)?.isActive).toBe(true);
  });

  it("is still readable on its own page, so it can be turned back on", async () => {
    const list = await createPriceList({ name: "Vecchio", adjustmentPercent: -30, isActive: false });
    expect((await getPriceList(list.id))?.list.name).toBe("Vecchio");
    expect((await listPriceLists(params(), "inactive")).total).toBe(1);
  });
});

describe("customers on a list", () => {
  it("are put on it and taken off it", async () => {
    const list = await createPriceList({ name: "A", adjustmentPercent: -10, isActive: true });
    await company("c1", "Alfa");
    await company("c2", "Beta");

    await assignPriceList(["c1", "c2"], list.id);
    expect((await getPriceList(list.id))?.companyCount).toBe(2);

    await assignPriceList(["c2"], null);
    expect((await getPriceList(list.id))?.companyCount).toBe(1);
    expect(await getCompanyPriceRules("c2")).toBeNull();
  });

  it("⚠️⚠️ survive the list being deleted, on catalogue prices", async () => {
    const list = await createPriceList({ name: "A", adjustmentPercent: -10, isActive: true });
    await product("p1", "Uno", "100.00");
    await setPriceListItem(list.id, "p1", 80);
    await company("c1", "Alfa", list.id);

    await deletePriceList(list.id);

    const survivors = (await db.execute(sql`select id, price_list_id from company`)) as {
      rows: Record<string, unknown>[];
    };
    expect(survivors.rows).toEqual([{ id: "c1", price_list_id: null }]);
    // The prices it named go with it; nothing is left pointing at a list that is gone.
    const orphans = (await db.execute(sql`select count(*)::int as n from price_list_item`)) as {
      rows: { n: number }[];
    };
    expect(orphans.rows[0].n).toBe(0);
    expect(await getPriceList(list.id)).toBeNull();
  });
});
