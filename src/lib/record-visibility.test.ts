/**
 * Who sees which customer. Two salespeople in one workspace must not read each other's leads,
 * contacts, companies and deals; an administrator sees them all; what is assigned to nobody is
 * the pool everybody sees; and a customer is seen through the records one works on.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";
import * as schema from "@/db/schema";
import type { Actor } from "@/lib/permissions";

import {
  canSeeRecord,
  groupsOf,
  inVisible,
  ownerOnCreate,
  type RecordKind,
  type RecordScope,
  readVisibilityMode,
  SEE_ALL,
  scopeFor,
  visibleIds,
  visibleWhere,
  writeVisibilityMode,
} from "./record-visibility";

const db = drizzle(new PGlite(), { schema });

const actor = (userId: string, tenantRole: Actor["tenantRole"]): Actor => ({
  userId,
  tenantRole,
  isPlatformStaff: false,
});

const anna: RecordScope = { all: false, userId: "anna", groupIds: [] };
const bruno: RecordScope = { all: false, userId: "bruno", groupIds: ["nord"] };
const carla: RecordScope = { all: false, userId: "carla", groupIds: [] };

async function ids(kind: RecordKind, scope: RecordScope): Promise<string[]> {
  const table = { lead: "lead", contact: "contact", company: "company", deal: "deal" }[kind];
  const where = visibleWhere(kind, scope);
  const result = await db.execute(
    sql`SELECT "id" FROM ${sql.raw(`"${table}"`)}${where ? sql` WHERE ${where}` : sql``} ORDER BY "id"`,
  );
  return (result.rows as { id: string }[]).map((r) => r.id);
}

beforeAll(async () => {
  await applyTenantMigrations(db as never);
  for (const id of ["anna", "bruno", "carla", "boss"]) {
    await db.execute(sql`insert into "user" (id, email, name) values (${id}, ${`${id}@x.it`}, ${id})`);
  }
  await db.execute(sql`insert into user_group (id, name) values ('nord', 'Nord')`);
  await db.execute(sql`insert into user_group_member (group_id, user_id) values ('nord', 'bruno')`);

  await db.execute(sql`insert into lead (id, first_name, last_name, owner_id, group_id) values
    ('l-anna', 'A', 'A', 'anna', null),
    ('l-bruno', 'B', 'B', 'bruno', null),
    ('l-nord', 'N', 'N', null, 'nord'),
    ('l-pool', 'P', 'P', null, null)`);

  // Acme is Anna's account; Bruno sells to one of its people through a deal of his own.
  // Globex is unassigned, with a contact of Carla's under it.
  await db.execute(sql`insert into company (id, name, owner_id, group_id) values
    ('c-acme', 'Acme', 'anna', null),
    ('c-globex', 'Globex', null, null),
    ('c-initech', 'Initech', 'carla', null)`);
  await db.execute(sql`insert into contact (id, first_name, last_name, company_id, owner_id) values
    ('p-acme-anna', 'A', 'A', 'c-acme', 'anna'),
    ('p-acme-free', 'F', 'F', 'c-acme', null),
    ('p-globex-carla', 'C', 'C', 'c-globex', 'carla'),
    ('p-initech-carla', 'I', 'I', 'c-initech', 'carla')`);
  await db.execute(sql`insert into deal (id, name, company_id, contact_id, owner_id) values
    ('d-acme-bruno', 'Acme rinnovo', 'c-acme', 'p-acme-anna', 'bruno'),
    ('d-initech-carla', 'Initech', 'c-initech', 'p-initech-carla', 'carla')`);
});

describe("⚠️⚠️ scopeFor", () => {
  it("an administrator and the owner see everything; an editor and a viewer do not", () => {
    expect(scopeFor(actor("x", "owner"), "team", [])).toEqual(SEE_ALL);
    expect(scopeFor(actor("x", "admin"), "team", [])).toEqual(SEE_ALL);
    expect(scopeFor(actor("x", "editor"), "team", ["g"])).toEqual({ all: false, userId: "x", groupIds: ["g"] });
    expect(scopeFor(actor("x", "viewer"), "team", [])).toEqual({ all: false, userId: "x", groupIds: [] });
  });

  it("the workspace may choose that everybody sees everything", () => {
    expect(scopeFor(actor("x", "editor"), "all", [])).toEqual(SEE_ALL);
  });

  it("Flux staff, and a request with nobody behind it (a job, a key), see everything", () => {
    expect(scopeFor({ ...actor("x", "viewer"), isPlatformStaff: true }, "team", [])).toEqual(SEE_ALL);
    expect(scopeFor(null, "team", [])).toEqual(SEE_ALL);
  });
});

describe("⚠️⚠️ leads", () => {
  it("a salesperson sees their own, their group's and the unassigned — not a colleague's", async () => {
    expect(await ids("lead", anna)).toEqual(["l-anna", "l-pool"]);
    expect(await ids("lead", bruno)).toEqual(["l-bruno", "l-nord", "l-pool"]);
  });

  it("everything, for a scope that sees everything", async () => {
    expect(await ids("lead", SEE_ALL)).toEqual(["l-anna", "l-bruno", "l-nord", "l-pool"]);
  });
});

describe("⚠️⚠️ customers are seen through what one works on", () => {
  it("the owner of a company sees its contacts and deals, even a colleague's", async () => {
    expect(await ids("contact", anna)).toEqual(["p-acme-anna", "p-acme-free"]);
    expect(await ids("deal", anna)).toEqual(["d-acme-bruno"]);
  });

  it("whoever owns a deal sees its company and its contact", async () => {
    expect(await ids("company", bruno)).toEqual(["c-acme", "c-globex"]);
    // p-acme-free is assigned to nobody: in the pool everybody sees.
    expect(await ids("contact", bruno)).toEqual(["p-acme-anna", "p-acme-free"]);
  });

  it("⚠️⚠️ an unassigned company opens none of the contacts filed under it", async () => {
    expect(await ids("contact", bruno)).not.toContain("p-globex-carla");
    expect(await ids("company", anna)).toContain("c-globex");
  });

  it("a colleague's account stays closed to everybody else", async () => {
    expect(await ids("company", anna)).not.toContain("c-initech");
    expect(await ids("contact", anna)).not.toContain("p-initech-carla");
    expect(await ids("deal", bruno)).not.toContain("d-initech-carla");
    expect(await ids("company", carla)).toEqual(["c-globex", "c-initech"]);
  });

  it("a contact of yours under an unassigned company opens the company, which is open anyway", async () => {
    expect(await ids("company", carla)).toContain("c-globex");
  });
});

describe("⚠️⚠️ what hangs off a customer is seen with the customer", () => {
  beforeAll(async () => {
    await db.execute(sql`insert into quote (id, quote_number, deal_id, company_id, owner_id, subtotal, total_amount) values
      ('q-acme', 'Q1', 'd-acme-bruno', 'c-acme', 'bruno', 1, 1),
      ('q-initech', 'Q2', 'd-initech-carla', 'c-initech', 'carla', 1, 1)`);
    await db.execute(sql`insert into task (id, title, owner_id, assignee_id, contact_id) values
      ('t-carla', 'Chiama Initech', 'carla', null, 'p-initech-carla'),
      ('t-for-anna', 'Aiuta Carla', 'carla', 'anna', 'p-initech-carla'),
      ('t-internal', 'Riunione interna', null, null, null)`);
    await db.execute(sql`insert into activity (id, type, owner_id, company_id) values
      ('a-initech', 'call', 'carla', 'c-initech'),
      ('a-acme', 'call', 'bruno', 'c-acme')`);
    // Carla sells to Acme too, on a deal of her own: Bruno sees Acme through his deal, not hers.
    await db.execute(
      sql`insert into deal (id, name, company_id, owner_id) values ('d-acme-carla', 'Acme bis', 'c-acme', 'carla')`,
    );
    await db.execute(sql`insert into activity (id, type, owner_id, company_id, deal_id) values
      ('a-acme-carla', 'call', 'carla', 'c-acme', 'd-acme-carla')`);
    await db.execute(sql`insert into quote (id, quote_number, deal_id, company_id, owner_id, subtotal, total_amount) values
      ('q-acme-carla', 'Q3', 'd-acme-carla', 'c-acme', 'carla', 1, 1)`);
    await db.execute(sql`insert into document (id, name, url, entity_type, entity_id) values
      ('f-initech', 'offerta.pdf', 'k1', 'company', 'c-initech'),
      ('f-quote', 'q.pdf', 'k2', 'quote', 'q-acme'),
      ('f-loose', 'manuale.pdf', 'k3', null, null)`);
  });

  async function rows(table: string, kind: Parameters<typeof visibleWhere>[0], scope: RecordScope) {
    const where = visibleWhere(kind, scope);
    const result = await db.execute(
      sql`SELECT "id" FROM ${sql.raw(`"${table}"`)}${where ? sql` WHERE ${where}` : sql``} ORDER BY "id"`,
    );
    return (result.rows as { id: string }[]).map((r) => r.id);
  }

  it("a quote is seen by whoever sees its deal, and not by a colleague", async () => {
    expect(await rows("quote", "quote", anna)).toEqual(["q-acme", "q-acme-carla"]);
    expect(await rows("quote", "quote", carla)).toEqual(["q-acme-carla", "q-initech"]);
  });

  it("a task is seen by its owner, its assignee and whoever sees its customer; an internal one by all", async () => {
    expect(await rows("task", "task", anna)).toEqual(["t-for-anna", "t-internal"]);
    expect(await rows("task", "task", carla)).toEqual(["t-carla", "t-for-anna", "t-internal"]);
  });

  it("⚠️⚠️ through the most specific link: a colleague's call on their deal stays theirs, though the company is seen", async () => {
    expect(await rows("activity", "activity", bruno)).toEqual(["a-acme"]);
    expect(await rows("deal", "deal", bruno)).not.toContain("d-acme-carla");
    expect(await rows("quote", "quote", bruno)).toEqual(["q-acme"]);
    // Anna owns Acme: every deal there, and what was logged on it, is hers to see.
    expect(await rows("activity", "activity", anna)).toEqual(["a-acme", "a-acme-carla"]);
  });

  it("activities and attached files follow their record", async () => {
    expect(await rows("document", "document", anna)).toEqual(["f-loose", "f-quote"]);
    expect(await rows("document", "document", carla)).toEqual(["f-initech", "f-loose"]);
  });
});

describe("one record at a time", () => {
  it("canSeeRecord answers for one id, and false for one that does not exist", async () => {
    expect(await canSeeRecord(db, "contact", "p-acme-anna", anna)).toBe(true);
    expect(await canSeeRecord(db, "contact", "p-initech-carla", anna)).toBe(false);
    expect(await canSeeRecord(db, "contact", "nope", SEE_ALL)).toBe(false);
    expect(await canSeeRecord(db, "contact", "p-initech-carla", SEE_ALL)).toBe(true);
  });

  it("visibleIds keeps only the visible ones", async () => {
    expect([...(await visibleIds(db, "lead", ["l-anna", "l-bruno", "l-pool"], anna))].sort()).toEqual([
      "l-anna",
      "l-pool",
    ]);
  });

  it("inVisible narrows a foreign key to the visible records", async () => {
    const cond = inVisible("company", sql`"deal"."company_id"`, carla);
    const result = await db.execute(sql`SELECT "id" FROM "deal" WHERE ${cond} ORDER BY "id"`);
    // Carla sees Initech, and Acme through her own deal there.
    expect((result.rows as { id: string }[]).map((r) => r.id)).toEqual([
      "d-acme-bruno",
      "d-acme-carla",
      "d-initech-carla",
    ]);
    expect(inVisible("company", sql`"deal"."company_id"`, SEE_ALL)).toBeUndefined();
  });
});

describe("⚠️⚠️ ownerOnCreate", () => {
  it("what a salesperson creates for nobody is theirs", () => {
    expect(ownerOnCreate(anna, { ownerId: null, groupId: null, name: "x" })).toEqual({
      ownerId: "anna",
      groupId: null,
      name: "x",
    });
  });

  it("an owner or a group they chose stays, and an administrator may leave it to nobody", () => {
    expect(ownerOnCreate(anna, { ownerId: "bruno", groupId: null }).ownerId).toBe("bruno");
    expect(ownerOnCreate(anna, { ownerId: null, groupId: "nord" }).ownerId).toBeNull();
    expect(ownerOnCreate(SEE_ALL, { ownerId: null, groupId: null }).ownerId).toBeNull();
  });
});

describe("the workspace's mode, and the groups", () => {
  it("⚠️⚠️ a read that fails is team, never everybody everything", async () => {
    const broken = {
      select: () => {
        throw new Error("connection lost");
      },
    };
    expect(await readVisibilityMode(broken)).toBe("team");
  });

  it("no row means team; the switch is stored", async () => {
    expect(await readVisibilityMode(db)).toBe("team");
    await writeVisibilityMode(db, "all");
    expect(await readVisibilityMode(db)).toBe("all");
    await writeVisibilityMode(db, "team");
    expect(await readVisibilityMode(db)).toBe("team");
  });

  it("groupsOf reads a person's groups", async () => {
    expect(await groupsOf(db, "bruno")).toEqual(["nord"]);
    expect(await groupsOf(db, "anna")).toEqual([]);
  });
});
