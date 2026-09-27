/**
 * Settings → General and Settings → Lists, against a real Postgres.
 *
 * ⚠️⚠️ The workspace's clock could only be set from Support → SLA, behind the support
 * module; a quote started with no expiry and no conditions whatever the business always
 * wrote; and "Prospect" beside "prospect" split every report grouped by company type.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";
import * as schema from "@/db/schema";
import {
  cleanQuoteDefaults,
  defaultExpiry,
  logoTypeOf,
  readLogoRef,
  readQuoteDefaults,
  writeLogoRef,
} from "@/lib/workspace-preferences";

const pg = drizzle(new PGlite(), { schema });
// The Neon driver's `batch` is one transaction; statement by statement is enough here.
const db = Object.assign(pg, {
  batch: async (queries: unknown[]) => {
    const out: unknown[] = [];
    for (const q of queries) out.push(await q);
    return out;
  },
});

vi.mock("@/lib/tenant-context", () => ({ getDb: async () => db, getCurrentTenantId: async () => "t1" }));
vi.mock("@/lib/auth-guard", () => ({
  requireCapability: async () => ({ userId: "u1", tenantRole: "admin", isPlatformStaff: false }),
  requireWriteAccess: async () => ({ user: { id: "u1", role: "admin" } }),
  requirePlanModule: async () => undefined,
  requirePlanLimit: async () => undefined,
}));
vi.mock("@/lib/exchange-rates", () => ({ getExchangeRates: async () => ({ rates: {} }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("@/lib/webhook-dispatch", () => ({ dispatchWebhook: async () => undefined }));
vi.mock("@/lib/notify", () => ({ notify: async () => undefined, notifyMany: async () => undefined }));

const { saveWorkspaceTimeZoneAction, saveQuoteDefaultsAction } = await import("./workspace-settings");
const { saveBusinessCalendarAction } = await import("./support");
const { renameListEntryAction, mergeListEntryAction, deleteListEntryAction } = await import("./lists");
const { createCompanyType } = await import("./crm");
const { createQuoteAction } = await import("./quotes");

beforeAll(async () => {
  await applyTenantMigrations(pg as never);
}, 120_000);

beforeEach(async () => {
  for (const t of [
    "quote_item",
    "quote",
    "deal",
    "company",
    "company_type",
    "company_category",
    "business_calendar",
    "workspace_setting",
  ]) {
    await pg.execute(sql.raw(`delete from "${t}"`));
  }
  await pg.execute(sql`delete from "user"`);
  await pg.execute(sql`insert into "user" (id, name, email) values ('u1', 'Anna', 'a@x.it')`);
});

describe("⚠️⚠️ the workspace's time zone", () => {
  it("is set from General, without the support module, keeping the opening hours", async () => {
    await pg.execute(
      sql`insert into business_calendar (id, time_zone, week) values ('b1', 'Europe/Rome', '["custom"]')`,
    );

    expect(await saveWorkspaceTimeZoneAction("America/New_York")).toEqual({ ok: true });

    const rows = (await pg.execute(sql`select time_zone, week from business_calendar`)).rows;
    expect(rows).toEqual([{ time_zone: "America/New_York", week: ["custom"] }]);
  });

  it("creates the row the first time, with the default week", async () => {
    await saveWorkspaceTimeZoneAction("Europe/London");
    const [row] = (await pg.execute(sql`select time_zone, week from business_calendar`)).rows as {
      time_zone: string;
      week: unknown[];
    }[];
    expect(row.time_zone).toBe("Europe/London");
    expect(row.week).toHaveLength(7);
  });

  it("refuses a name no runtime knows, and changes nothing", async () => {
    expect(await saveWorkspaceTimeZoneAction("Mars/Olympus")).toEqual({ ok: false });
    expect((await pg.execute(sql`select * from business_calendar`)).rows).toEqual([]);
  });

  it("⚠️ is no longer changed by saving the opening hours", async () => {
    await saveWorkspaceTimeZoneAction("Asia/Tokyo");
    await saveBusinessCalendarAction({ week: [null, null, null, null, null, null, null] });

    const [row] = (await pg.execute(sql`select time_zone from business_calendar`)).rows;
    expect(row).toEqual({ time_zone: "Asia/Tokyo" });
  });
});

describe("what a new quote starts with", () => {
  it("cleans what was typed", () => {
    expect(cleanQuoteDefaults({ validityDays: "30", terms: "  Pagamento a 30 giorni  " })).toEqual({
      validityDays: 30,
      terms: "Pagamento a 30 giorni",
    });
    expect(cleanQuoteDefaults({ validityDays: -5 }).validityDays).toBe(0);
    expect(cleanQuoteDefaults({ validityDays: 9999 }).validityDays).toBe(365);
    expect(cleanQuoteDefaults({ validityDays: "abc" }).validityDays).toBe(0);
    expect(defaultExpiry(new Date("2026-09-01T10:00:00Z"), 0)).toBeNull();
    expect(defaultExpiry(new Date("2026-09-01T10:00:00Z"), 30)?.toISOString()).toBe("2026-10-01T10:00:00.000Z");
  });

  async function newQuote(extra: { expiresAt?: string; notes?: string }) {
    await pg.execute(sql`insert into company (id, name) values ('c1', 'Rossi Srl') on conflict do nothing`);
    await pg.execute(
      sql`insert into deal (id, name, company_id) values ('d1', 'Rinnovo', 'c1') on conflict do nothing`,
    );
    const { quoteId } = await createQuoteAction({
      dealId: "d1",
      companyId: "c1",
      currency: "EUR",
      items: [{ description: "Canone", quantity: 1, unitPrice: 100, discountPercent: 0, taxPercent: 22 }],
      discountPercent: 0,
      taxPercent: 0,
      ...extra,
    });
    const [row] = (await pg.execute(sql`select expires_at, issued_at, notes from quote where id = ${quoteId}`))
      .rows as { expires_at: string | null; issued_at: string; notes: string | null }[];
    return row;
  }

  it("⚠️ a quote left empty takes the workspace's validity and conditions", async () => {
    await saveQuoteDefaultsAction({ validityDays: 30, terms: "Pagamento a 30 giorni" });

    const row = await newQuote({ expiresAt: "", notes: "" });

    expect(row.notes).toBe("Pagamento a 30 giorni");
    const days = (new Date(`${row.expires_at}Z`).getTime() - new Date(`${row.issued_at}Z`).getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(30);
  });

  it("what was typed on the quote wins", async () => {
    await saveQuoteDefaultsAction({ validityDays: 30, terms: "Pagamento a 30 giorni" });

    const row = await newQuote({ expiresAt: "2027-01-15", notes: "Prezzo bloccato" });

    expect(row.notes).toBe("Prezzo bloccato");
    expect(String(row.expires_at).startsWith("2027-01-15")).toBe(true);
  });

  it("without defaults, as before: no expiry, no conditions", async () => {
    const row = await newQuote({ expiresAt: "", notes: "" });
    expect(row).toMatchObject({ expires_at: null });
    expect(row.notes || null).toBeNull();
  });

  it("is read back as it was saved", async () => {
    await saveQuoteDefaultsAction({ validityDays: 15, terms: "Consegna in 10 giorni" });
    expect(await readQuoteDefaults(pg as never)).toEqual({ validityDays: 15, terms: "Consegna in 10 giorni" });
  });
});

describe("the logo", () => {
  it("is judged by its bytes, not by its name", () => {
    expect(logoTypeOf(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(logoTypeOf(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(logoTypeOf(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
  });

  it("⚠️ removing it leaves no row: the column holds no null", async () => {
    await writeLogoRef(pg as never, { key: "documents/202609/x.png", contentType: "image/png" });
    expect(await readLogoRef(pg as never)).toEqual({ key: "documents/202609/x.png", contentType: "image/png" });

    await writeLogoRef(pg as never, null);
    expect(await readLogoRef(pg as never)).toBeNull();
  });
});

describe("⚠️⚠️ lists", () => {
  it("a type typed with other capitals is the one that exists", async () => {
    const first = await createCompanyType("Prospect");
    const again = await createCompanyType("  prospect ");
    expect(again.id).toBe(first.id);
    expect((await pg.execute(sql`select count(*)::int as n from company_type`)).rows[0]).toEqual({ n: 1 });
  });

  it("merging moves every company and removes the old entry", async () => {
    await pg.execute(sql`insert into company_type (id, name) values ('t1', 'Prospect'), ('t2', 'prospect')`);
    await pg.execute(
      sql`insert into company (id, name, company_type_id) values ('c1', 'A', 't1'), ('c2', 'B', 't2'), ('c3', 'C', 't2')`,
    );

    expect(await mergeListEntryAction("type", "t2", "t1")).toEqual({ ok: true });

    const rows = (await pg.execute(sql`select company_type_id from company order by id`)).rows;
    expect(rows).toEqual([{ company_type_id: "t1" }, { company_type_id: "t1" }, { company_type_id: "t1" }]);
    expect((await pg.execute(sql`select id from company_type`)).rows).toEqual([{ id: "t1" }]);
  });

  it("refuses to merge an entry into itself", async () => {
    expect(await mergeListEntryAction("category", "x", "x")).toEqual({ ok: false, reason: "same" });
  });

  it("⚠️ refuses a rename onto another entry's name, whatever its capitals", async () => {
    await pg.execute(sql`insert into company_category (id, name) values ('k1', 'Retail'), ('k2', 'Ingrosso')`);

    expect(await renameListEntryAction("category", "k2", "RETAIL")).toEqual({ ok: false, reason: "taken" });
    expect(await renameListEntryAction("category", "k2", "  ")).toEqual({ ok: false, reason: "empty" });
    expect(await renameListEntryAction("category", "k1", "retail")).toEqual({ ok: true });
  });

  it("deleting leaves its companies without one, rather than deleting them", async () => {
    await pg.execute(sql`insert into company_category (id, name) values ('k1', 'Retail')`);
    await pg.execute(sql`insert into company (id, name, company_category_id) values ('c1', 'A', 'k1')`);

    await deleteListEntryAction("category", "k1");

    expect((await pg.execute(sql`select company_category_id from company`)).rows).toEqual([
      { company_category_id: null },
    ]);
  });
});
