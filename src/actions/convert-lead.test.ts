/**
 * Converting a lead, against a real Postgres (S4, docs/processo-operativo-2026-10.md).
 *
 * ⚠️⚠️ What the lead knew has to reach the customer it becomes. The conversion used to open the
 * deal in the first stage of the first pipeline, leave its source behind (a sale could not be
 * counted by where it came from), leave the appointment booked and the documents collected on
 * a lead page nobody opens again, and — for a person with no company — make no company at all,
 * so no quote could be written for a private customer.
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

const { afterQueue, ruleCalls } = vi.hoisted(() => ({
  afterQueue: [] as (() => unknown)[],
  ruleCalls: [] as { entityType: string; event: string; newData: Record<string, unknown> }[],
}));

vi.mock("@/lib/tenant-context", () => ({ getDb: async () => db, getCurrentTenantId: async () => "t1" }));
vi.mock("@/lib/auth-guard", () => ({
  requireWriteAccess: async () => ({ user: { id: "luca", role: "editor" } }),
  requireCapability: async () => ({ userId: "luca", tenantRole: "editor", isPlatformStaff: false }),
  requirePlanLimit: async () => undefined,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void afterQueue.push(fn) }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (k: string, v?: Record<string, string>) =>
    v ? `${k}:${Object.values(v).join(" ")}` : k,
}));
vi.mock("@/lib/webhook-dispatch", () => ({ dispatchWebhook: async () => undefined }));
vi.mock("@/lib/contact-reach", () => ({ contactReach: async () => ({}) }));
vi.mock("@/components/crm/automation/rule-engine", () => ({
  runAutomations: async (c: (typeof ruleCalls)[number]) => void ruleCalls.push(c),
}));

const { convertLead } = await import("./crm");

beforeAll(async () => {
  await applyTenantMigrations(db as never);
  await db.execute(sql`insert into "user" (id, email) values ('anna', 'a@x.it'), ('luca', 'l@x.it')`);
  await db.execute(sql`insert into user_group (id, name) values ('nord', 'Zona nord')`);
  await db.execute(sql`delete from pipeline_stage`);
  await db.execute(
    sql`insert into pipeline (id, name, "order") values ('impianti', 'Impianti', 2) on conflict do nothing`,
  );
  await db.execute(sql`
    insert into pipeline_stage (id, name, "order", pipeline_id, default_probability, is_won, is_lost) values
      ('v1', 'Appuntamento', 1, 'default', 20, false, false),
      ('vw', 'Vinta', 9, 'default', 100, true, false),
      ('iw', 'Vinta', 0, 'impianti', 100, true, false),
      ('i1', 'Sopralluogo', 1, 'impianti', 40, false, false)`);
}, 120_000);

beforeEach(async () => {
  for (const t of [
    "custom_field_value",
    "custom_field_definition",
    "document",
    "appointment",
    "deal",
    "contact",
    "company",
    "lead",
  ]) {
    await db.execute(sql.raw(`delete from "${t}"`));
  }
  afterQueue.length = 0;
  ruleCalls.length = 0;
  await db.execute(sql`
    insert into lead (id, first_name, last_name, email, owner_id, group_id, source, company_name)
    values ('l1', 'Mario', 'Rossi', 'mario@example.com', 'anna', 'nord', 'ads_meta', null)`);
});

const one = async (q: ReturnType<typeof sql>) => (await db.execute(q)).rows[0] as Record<string, unknown>;

describe("⚠️⚠️ the deal a lead becomes", () => {
  it("opens in the pipeline chosen, in its first open stage, with the stage's probability", async () => {
    const { dealId } = await convertLead("l1", true, { pipelineId: "impianti" });
    expect(await one(sql`select stage_id, probability from deal where id = ${dealId}`)).toEqual({
      stage_id: "i1",
      probability: 40,
    });
  });

  it("keeps where the customer came from, whose it is and their group", async () => {
    const { dealId, contactId } = await convertLead("l1", true);
    expect(await one(sql`select source, owner_id, group_id from deal where id = ${dealId}`)).toEqual({
      source: "ads_meta",
      owner_id: "anna",
      group_id: "nord",
    });
    expect(await one(sql`select owner_id, group_id from contact where id = ${contactId}`)).toEqual({
      owner_id: "anna",
      group_id: "nord",
    });
  });

  it("is the converter's when the lead was nobody's", async () => {
    await db.execute(sql`update lead set owner_id = null where id = 'l1'`);
    const { dealId } = await convertLead("l1", true);
    expect((await one(sql`select owner_id from deal where id = ${dealId}`)).owner_id).toBe("luca");
  });

  it("sets off the rules, as a deal made by hand does", async () => {
    await convertLead("l1", true);
    for (const fn of afterQueue.splice(0)) await fn();
    expect(ruleCalls.map((c) => `${c.entityType}:${c.event}`)).toEqual(["deal:onCreate", "lead:onUpdate"]);
    expect(ruleCalls[1].newData).toMatchObject({ status: "converted" });
  });
});

describe("⚠️⚠️ a private customer", () => {
  it("is filed under a company in their own name, so a quote can be made out to it", async () => {
    const { companyId, contactId, dealId } = await convertLead("l1", true, { privateCustomer: true });
    expect(companyId).toBeTruthy();
    expect(
      await one(
        sql`select name, main_email, source, person_first_name, person_last_name from company where id = ${companyId}`,
      ),
    ).toEqual({
      name: "Mario Rossi",
      main_email: "mario@example.com",
      source: "ads_meta",
      // A person: the e-invoice names them with Nome and Cognome.
      person_first_name: "Mario",
      person_last_name: "Rossi",
    });
    expect((await one(sql`select company_id from contact where id = ${contactId}`)).company_id).toBe(companyId);
    expect((await one(sql`select company_id from deal where id = ${dealId}`)).company_id).toBe(companyId);
  });

  it("gets no company unless the dialog says so", async () => {
    const { companyId } = await convertLead("l1", true);
    expect(companyId).toBeNull();
  });

  it("⚠️ who is a customer already keeps the company they have", async () => {
    await db.execute(sql`insert into company (id, name) values ('co1', 'Mario Rossi')`);
    await db.execute(sql`
      insert into contact (id, first_name, last_name, email, company_id) values ('c1', 'Mario', 'Rossi', 'mario@example.com', 'co1')`);
    const { companyId, contactId } = await convertLead("l1", false, { privateCustomer: true });
    expect({ companyId, contactId }).toEqual({ companyId: "co1", contactId: "c1" });
    expect((await one(sql`select count(*)::int as n from company`)).n).toBe(1);
  });
});

describe("⚠️ what was collected on the lead", () => {
  it("moves with it: the appointment booked and the documents", async () => {
    await db.execute(sql`
      insert into appointment (id, title, start_at, end_at, ical_uid, lead_id)
      values ('ap1', 'Sopralluogo', now(), now() + interval '1 hour', 'uid-1', 'l1')`);
    await db.execute(sql`
      insert into document (id, name, url, entity_type, entity_id) values ('doc1', 'Bolletta.pdf', 'k', 'lead', 'l1')`);

    const { contactId, dealId } = await convertLead("l1", true);

    expect(await one(sql`select lead_id, contact_id, deal_id from appointment where id = 'ap1'`)).toEqual({
      lead_id: null,
      contact_id: contactId,
      deal_id: dealId,
    });
    expect(await one(sql`select entity_type, entity_id from document where id = 'doc1'`)).toEqual({
      entity_type: "deal",
      entity_id: dealId,
    });
  });

  it("carries custom fields to the field of the same name and kind, and to no other", async () => {
    await db.execute(sql`
      insert into custom_field_definition (id, name, slug, entity_type, field_type) values
        ('fl', 'Tipo di intervento', 'tipo_intervento', 'lead', 'text'),
        ('fd', 'Tipo di intervento', 'tipo_intervento', 'deal', 'text'),
        ('fc', 'Tipo di intervento', 'tipo_intervento', 'contact', 'select'),
        ('fl2', 'Campagna', 'campagna', 'lead', 'text')`);
    await db.execute(sql`
      insert into custom_field_value (id, field_id, entity_type, entity_id, value) values
        ('v1', 'fl', 'lead', 'l1', 'Fotovoltaico'), ('v2', 'fl2', 'lead', 'l1', 'Primavera')`);

    const { dealId } = await convertLead("l1", true);

    const rows = (
      await db.execute(sql`select field_id, entity_id, value from custom_field_value where entity_type <> 'lead'`)
    ).rows;
    expect(rows).toEqual([{ field_id: "fd", entity_id: dealId, value: "Fotovoltaico" }]);
  });
});
