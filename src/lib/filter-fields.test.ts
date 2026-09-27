/**
 * The four filter fields a salesperson narrows a list by first, and the views a team
 * shares — against a real Postgres.
 *
 * ⚠️⚠️ The filter had no owner, no tags, no "last activity" and no contact's company; and
 * every saved view was private, with the code to share and pin them called by nothing.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";
import { contacts } from "@/db/schema";

import { buildWhereClause, COMPANY_FIELDS, CONTACT_FIELDS, LEAD_FIELDS } from "./filter-engine";
import type { FilterOperator, FilterTree, FilterValue } from "./filter-types";

const db = drizzle(new PGlite());
let me = "anna";

vi.mock("@/lib/tenant-context", () => ({ getDb: async () => db }));
vi.mock("@/lib/auth-guard", () => ({
  requireCapability: async () => ({ userId: me, tenantRole: "editor", isPlatformStaff: false }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { getSavedViews } = await import("@/actions/filters");

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  me = "anna";
  for (const t of ["custom_filter", "activity", "contact", "company"]) await db.execute(sql.raw(`delete from "${t}"`));
  await db.execute(sql`delete from "user"`);
  await db.execute(
    sql`insert into "user" (id, name, email) values ('anna', 'Anna', 'a@x.it'), ('luca', 'Luca', 'l@x.it')`,
  );
  await db.execute(sql`insert into company (id, name) values ('co1', 'Rossi Srl'), ('co2', 'Bianchi Spa')`);
  await db.execute(sql`
    insert into contact (id, first_name, last_name, owner_id, tags, company_id) values
      ('c1', 'Mario', 'Rossi', 'anna', array['vip', 'fiera'], 'co1'),
      ('c2', 'Giulia', 'Bianchi', 'luca', array['fiera'], 'co2'),
      ('c3', 'Paolo', 'Verdi', null, null, null)`);
  await db.execute(sql`
    insert into activity (id, type, content, contact_id, date) values
      ('a1', 'call', 'x', 'c1', ${ago(2)}),
      ('a2', 'call', 'x', 'c2', ${ago(40)})`);
});

async function matching(field: string, operator: FilterOperator, value: FilterValue): Promise<string[]> {
  const tree: FilterTree = {
    version: 1,
    logic: "AND",
    conditions: [{ id: "1", type: "condition", field, operator, value }],
  };
  const where = buildWhereClause(tree, CONTACT_FIELDS, contacts.id);
  const rows = await db.select({ id: contacts.id }).from(contacts).where(where).orderBy(contacts.id);
  return rows.map((r) => r.id);
}

describe("⚠️⚠️ the four missing fields", () => {
  it("owner: mine", async () => {
    expect(await matching("ownerId", "in", ["anna"])).toEqual(["c1"]);
  });

  it("tags: contains one, and has none", async () => {
    expect(await matching("tags", "contains", "vip")).toEqual(["c1"]);
    expect(await matching("tags", "contains", "fiera")).toEqual(["c1", "c2"]);
    expect(await matching("tags", "is_empty", "")).toEqual(["c3"]);
  });

  it("last activity: recent, and gone quiet", async () => {
    expect(await matching("lastActivity", "last_n_days", 7)).toEqual(["c1"]);
    expect(await matching("lastActivity", "before", ago(30).toISOString())).toEqual(["c2"]);
  });

  it("the contact's company, by name", async () => {
    expect(await matching("companyName", "contains", "bianchi")).toEqual(["c2"]);
  });

  it("are on leads and companies too", () => {
    for (const registry of [LEAD_FIELDS, COMPANY_FIELDS]) {
      expect(Object.keys(registry)).toEqual(expect.arrayContaining(["ownerId", "tags", "lastActivity"]));
    }
  });
});

describe("⚠️ views", () => {
  beforeEach(async () => {
    await db.execute(sql`
      insert into custom_filter (id, name, entity_type, owner_id, criteria, is_public, is_pinned) values
        ('mine', 'I miei', 'contacts', 'anna', '{}', false, true),
        ('shared', 'Di squadra', 'contacts', 'luca', '{}', true, true),
        ('private', 'Di Luca', 'contacts', 'luca', '{}', false, false),
        ('leads', 'Lead', 'leads', 'anna', '{}', true, false)`);
  });

  it("a person sees their own and what colleagues shared — never a colleague's private view", async () => {
    const views = await getSavedViews("contacts");
    expect(views.map((v) => [v.id, v.mine])).toEqual([
      ["shared", false],
      ["mine", true],
    ]);
  });
});
