/**
 * The read API's pages (src/lib/api-read.ts), against a real Postgres: every record once,
 * in order, whatever the timestamps look like — and nothing the list does not name.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";

import { decodeCursor, encodeCursor, listEntity, parseListQuery } from "./api-read";

const db = drizzle(new PGlite());

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  for (const t of ["deal", "contact", "company", "pipeline_stage"]) await db.execute(sql.raw(`delete from "${t}"`));
});

async function contact(id: string, updatedAt: string, over = "") {
  await db.execute(
    sql.raw(
      `insert into contact (id, first_name, last_name, email, updated_at${over ? ", notes" : ""}) values ('${id}', 'N${id}', 'C', '${id}@x.it', '${updatedAt}'${over ? `, '${over}'` : ""})`,
    ),
  );
}

const q = (params: Record<string, string> = {}) => {
  const p = parseListQuery(new URLSearchParams(params));
  if (!p.ok) throw new Error(p.error);
  return p.query;
};

async function all(params: Record<string, string>) {
  const seen: string[] = [];
  let cursor: string | null = null;
  for (let pages = 0; pages < 50; pages++) {
    const page = await listEntity(db as never, "contacts", q({ ...params, ...(cursor ? { cursor } : {}) }));
    seen.push(...page.data.map((r) => String(r.id)));
    cursor = page.nextCursor;
    if (!cursor) return { seen, pages: pages + 1 };
  }
  throw new Error("never ended");
}

describe("⚠️⚠️ paging", () => {
  it("serves every record exactly once, oldest change first", async () => {
    await contact("c", "2026-09-20 10:00:03");
    await contact("a", "2026-09-20 10:00:01");
    await contact("b", "2026-09-20 10:00:02");
    const { seen, pages } = await all({ limit: "1" });
    expect(seen).toEqual(["a", "b", "c"]);
    expect(pages).toBe(3);
  });

  it("⚠️⚠️ many records in one microsecond, and some a microsecond apart: none repeated, none lost", async () => {
    for (const id of ["r1", "r2", "r3", "r4", "r5"]) await contact(id, "2026-09-20 10:00:00.123456");
    await contact("s1", "2026-09-20 10:00:00.123457");
    await contact("s0", "2026-09-20 10:00:00.1234");
    const { seen } = await all({ limit: "2" });
    expect(seen).toEqual(["s0", "r1", "r2", "r3", "r4", "r5", "s1"]);
  });

  it("starts from updatedSince, for the reconciling that follows the first full read", async () => {
    await contact("old", "2026-08-01 00:00:00");
    await contact("new", "2026-09-15 00:00:00");
    const page = await listEntity(db as never, "contacts", q({ updatedSince: "2026-09-01T00:00:00Z" }));
    expect(page.data.map((r) => r.id)).toEqual(["new"]);
    expect(page.nextCursor).toBeNull();
  });

  it("⚠️ shows the fields it names and nothing else", async () => {
    await contact("c1", "2026-09-20 10:00:00", "chiamare dopo le 18, è permaloso");
    const [row] = (await listEntity(db as never, "contacts", q())).data;
    expect(row).toMatchObject({ id: "c1", email: "c1@x.it", updatedAt: "2026-09-20T10:00:00.000Z" });
    // Internal notes are not in the list of what a contact shows.
    expect(row).not.toHaveProperty("notes");
    expect(row).not.toHaveProperty("groupId");
    expect(row).not.toHaveProperty("_at");
  });

  it("a deal carries its stage's name, and its amount as a number", async () => {
    await db.execute(sql`insert into pipeline_stage (id, name, "order") values ('s2', 'Proposta', 2)`);
    await db.execute(sql`insert into deal (id, name, amount, stage_id) values ('d1', 'Rinnovo', '1200.50', 's2')`);
    const [deal] = (await listEntity(db as never, "deals", q())).data;
    expect(deal).toMatchObject({ id: "d1", stageName: "Proposta", amount: 1200.5 });
  });
});

describe("the query", () => {
  it("refuses what it cannot honour, naming the parameter", () => {
    expect(parseListQuery(new URLSearchParams({ limit: "0" }))).toMatchObject({ ok: false, field: "limit" });
    expect(parseListQuery(new URLSearchParams({ limit: "201" }))).toMatchObject({ ok: false, field: "limit" });
    expect(parseListQuery(new URLSearchParams({ limit: "5.5" }))).toMatchObject({ ok: false, field: "limit" });
    expect(parseListQuery(new URLSearchParams({ cursor: "nonsense" }))).toMatchObject({ ok: false, field: "cursor" });
    expect(parseListQuery(new URLSearchParams({ updatedSince: "ieri" }))).toMatchObject({
      ok: false,
      field: "updatedSince",
    });
    expect(parseListQuery(new URLSearchParams())).toEqual({
      ok: true,
      query: { limit: 50, after: null, updatedSince: null },
    });
  });

  it("⚠️ a cursor is only ever one this API wrote: a timestamp and an id", () => {
    expect(decodeCursor(encodeCursor("2026-09-20 10:00:00.123456", "c1"))).toEqual({
      at: "2026-09-20 10:00:00.123456",
      id: "c1",
    });
    const forged = Buffer.from(JSON.stringify(["now(); drop table contact", "x"])).toString("base64url");
    expect(decodeCursor(forged)).toBeNull();
  });
});
