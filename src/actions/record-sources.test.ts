/**
 * The source list against a real Postgres (S1): what settings does to it, and to the records.
 *
 * ⚠️⚠️ A merge is how "Facebook", "facebook" and "FB" become one row in a report, so it must
 * move every table that says where a customer came from, deals and orders included.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";

const pg = drizzle(new PGlite());
// The Neon driver's `batch` is one transaction; statement by statement is enough here.
const db = Object.assign(pg, {
  batch: async (queries: unknown[]) => {
    const out: unknown[] = [];
    for (const q of queries) out.push(await q);
    return out;
  },
});

vi.mock("@/lib/tenant-context", () => ({ getDb: async () => db }));
vi.mock("@/lib/auth-guard", () => ({
  requireCapability: async () => ({ userId: "anna", tenantRole: "admin", isPlatformStaff: false }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const {
  createRecordSourceAction,
  getRecordSources,
  getSourceUsage,
  listSourceValueAction,
  mergeRecordSourceAction,
  renameRecordSourceAction,
  setRecordSourceActiveAction,
} = await import("./record-sources");

beforeAll(async () => {
  await applyTenantMigrations(db as never);
  await db.execute(sql`insert into pipeline_stage (id, name, "order") values ('s1', 'Nuova', 1)`);
}, 120_000);

beforeEach(async () => {
  for (const t of ["order", "deal", "lead", "contact", "company"]) await db.execute(sql.raw(`delete from "${t}"`));
  await db.execute(sql`delete from record_source where name is not null`);
  await db.execute(sql`update record_source set is_active = true`);
});

const sourceOf = async (table: string, id: string) =>
  ((await db.execute(sql.raw(`select source from "${table}" where id = '${id}'`))).rows[0] as { source: string })
    .source;

describe("the list a workspace starts with", () => {
  it("is the built-in one, ADS first, read in the reader's language", async () => {
    const sources = await getRecordSources();
    expect(sources.slice(0, 4).map((s) => s.key)).toEqual(["ads_meta", "ads_google", "website", "agent"]);
    expect(sources.every((s) => s.name === null && s.isActive)).toBe(true);
  });
});

describe("a source added in settings", () => {
  it("gets a key of its own and goes at the end", async () => {
    const result = await createRecordSourceAction("ADS TikTok");
    expect(result).toEqual({ ok: true, key: "ads_tiktok" });
    expect((await getRecordSources()).at(-1)).toMatchObject({ key: "ads_tiktok", name: "ADS TikTok" });
  });

  it("is refused when another already reads that way", async () => {
    await createRecordSourceAction("Passaparola");
    expect(await createRecordSourceAction("passaparola")).toEqual({ ok: false, reason: "taken" });
    expect(await createRecordSourceAction("  ")).toEqual({ ok: false, reason: "empty" });
  });
});

describe("⚠️⚠️ renaming and retiring", () => {
  it("moves no record: the key stays, only the name changes", async () => {
    await db.execute(sql`insert into lead (id, first_name, last_name, source) values ('l1', 'A', 'B', 'website')`);
    await renameRecordSourceAction("website", "Sito aziendale");
    expect(await sourceOf("lead", "l1")).toBe("website");
    expect((await getRecordSources()).find((s) => s.key === "website")?.name).toBe("Sito aziendale");
  });

  it("keeps a retired source in the list, switched off", async () => {
    await setRecordSourceActiveAction("linkedin", false);
    expect((await getRecordSources()).find((s) => s.key === "linkedin")).toMatchObject({ isActive: false });
  });
});

describe("⚠️⚠️ merging", () => {
  it("moves every record carrying it, in every table, and takes it off the list", async () => {
    await createRecordSourceAction("Facebook");
    await db.execute(sql`insert into lead (id, first_name, last_name, source) values ('l1', 'A', 'B', 'facebook')`);
    await db.execute(sql`insert into contact (id, first_name, last_name, source) values ('c1', 'A', 'B', 'facebook')`);
    await db.execute(sql`insert into company (id, name, source) values ('co1', 'Rossi', 'facebook')`);
    await db.execute(sql`insert into deal (id, name, stage_id, source) values ('d1', 'Impianto', 's1', 'facebook')`);
    await db.execute(
      sql`insert into "order" (id, order_number, total_amount, source) values ('o1', 'O-1', '0', 'facebook')`,
    );

    expect(await mergeRecordSourceAction("facebook", "ads_meta")).toEqual({ ok: true, key: "ads_meta" });

    for (const [table, id] of [
      ["lead", "l1"],
      ["contact", "c1"],
      ["company", "co1"],
      ["deal", "d1"],
      ["order", "o1"],
    ]) {
      expect(await sourceOf(table, id), table).toBe("ads_meta");
    }
    expect((await getRecordSources()).some((s) => s.key === "facebook")).toBe(false);
  });

  it("works on a value nobody listed, and refuses to merge a source into itself", async () => {
    await db.execute(sql`insert into lead (id, first_name, last_name, source) values ('l1', 'A', 'B', 'FB')`);
    expect(await getSourceUsage()).toEqual([{ value: "FB", records: 1 }]);
    await mergeRecordSourceAction("FB", "ads_meta");
    expect(await sourceOf("lead", "l1")).toBe("ads_meta");
    expect(await mergeRecordSourceAction("ads_meta", "ads_meta")).toEqual({ ok: false, reason: "same" });
  });

  it("can instead put a value on the list as it is written, moving nothing", async () => {
    await db.execute(sql`insert into lead (id, first_name, last_name, source) values ('l1', 'A', 'B', 'Passaparola')`);
    expect(await listSourceValueAction("Passaparola")).toEqual({ ok: true, key: "Passaparola" });
    expect(await sourceOf("lead", "l1")).toBe("Passaparola");
    expect(await listSourceValueAction("Passaparola")).toEqual({ ok: false, reason: "taken" });
  });
});
