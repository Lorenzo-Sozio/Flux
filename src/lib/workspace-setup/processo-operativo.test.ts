/**
 * Configuring a workspace for the operating process, against a real Postgres.
 *
 * ⚠️⚠️ It runs against a customer's live workspace. What it must never do is take away a choice
 * somebody made: a stage renamed by hand, a probability changed, a rule already written. And a
 * preview that wrote anything would be a lie told by the one command meant to be safe to run.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vitest";

import { AutomationRuleFormSchema } from "@/components/crm/automation/types";
import { applyTenantMigrations } from "@/db/migrate-tenant";
import { seedWorkspace } from "@/db/seed-workspace";

import { setupProcessoOperativo } from "./processo-operativo";

let db: ReturnType<typeof drizzle>;

beforeEach(async () => {
  db = drizzle(new PGlite());
  await applyTenantMigrations(db as never);
  await seedWorkspace(db as never);
  await db.execute(sql`insert into "user" (id, email) values ('anna', 'anna@x.it'), ('marco', 'marco@x.it')`);
}, 120_000);

const rows = async (q: ReturnType<typeof sql>) => (await db.execute(q)).rows as Record<string, unknown>[];
const count = async (table: string) => Number((await rows(sql.raw(`select count(*)::int as n from "${table}"`)))[0].n);

describe("⚠️⚠️ the preview", () => {
  it("writes nothing", async () => {
    const before = await Promise.all(
      ["pipeline_stage", "automation_rule", "custom_field_definition", "product"].map(count),
    );
    const lines = await setupProcessoOperativo(db, { apply: false });
    expect(lines.some((l) => l.status === "create")).toBe(true);
    const after = await Promise.all(
      ["pipeline_stage", "automation_rule", "custom_field_definition", "product"].map(count),
    );
    expect(after).toEqual(before);
    expect((await rows(sql`select name from pipeline_stage order by "order"`)).map((r) => r.name)).toContain(
      "Qualification",
    );
  });
});

describe("applied to a new workspace", () => {
  it("turns the seeded stages into the process's, keeping their ids", async () => {
    const [before] = await rows(sql`select id from pipeline_stage where name = 'Proposal'`);
    await setupProcessoOperativo(db, { apply: true });
    expect(await rows(sql`select name, default_probability from pipeline_stage order by "order"`)).toEqual([
      { name: "Appuntamento fissato", default_probability: 20 },
      { name: "Sopralluogo fatto", default_probability: 40 },
      { name: "Preventivo inviato", default_probability: 60 },
      { name: "In negoziazione", default_probability: 75 },
      { name: "Vinta", default_probability: 100 },
      { name: "Persa", default_probability: 0 },
    ]);
    const [after] = await rows(sql`select id from pipeline_stage where name = 'Preventivo inviato'`);
    expect(after.id).toBe(before.id);
    expect((await rows(sql`select name from pipeline`))[0].name).toBe("Vendite");
  });

  it("creates the fields that carry over on conversion with the same slug and kind on lead and deal", async () => {
    await setupProcessoOperativo(db, { apply: true });
    const kinds = await rows(
      sql`select entity_type, field_type from custom_field_definition where slug = 'tipo_intervento' order by entity_type`,
    );
    expect(kinds).toEqual([
      { entity_type: "deal", field_type: "select" },
      { entity_type: "lead", field_type: "select" },
    ]);
  });

  it("⚠️⚠️ creates every rule switched off, and every rule is one the builder accepts", async () => {
    await setupProcessoOperativo(db, {
      apply: true,
      rotation: ["anna@x.it"],
      administration: "anna@x.it",
      supportLead: "marco@x.it",
    });
    const rules = await rows(
      sql`select name, is_active, target_entity, trigger_on, conditions, actions from automation_rule`,
    );
    expect(rules.length).toBe(8);
    for (const r of rules) {
      expect(r.is_active, String(r.name)).toBe(false);
      const parsed = AutomationRuleFormSchema.safeParse({
        name: r.name,
        targetEntity: r.target_entity,
        triggerOn: r.trigger_on,
        conditions: JSON.parse(String(r.conditions)),
        actions: JSON.parse(String(r.actions)),
      });
      expect(parsed.success, `${r.name}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    }
  });

  it("puts catalogue lines with no price out of reach of a quote", async () => {
    await setupProcessoOperativo(db, { apply: true });
    const lines = await rows(
      sql`select price, is_active from product where category in ('Manutenzione', 'Assistenza')`,
    );
    expect(lines.length).toBe(5);
    expect(lines.every((l) => l.is_active === false)).toBe(true);
  });

  it("leaves out the rules that need a person nobody named", async () => {
    const lines = await setupProcessoOperativo(db, { apply: true });
    expect(lines.filter((l) => l.status === "skip").map((l) => l.item)).toEqual(
      expect.arrayContaining(["Assegna i lead senza titolare a rotazione", "Regole dei ticket urgenti e oltre lo SLA"]),
    );
    expect(await count("automation_rule")).toBe(5);
  });

  it("does not switch on the satisfaction email unless asked", async () => {
    await setupProcessoOperativo(db, { apply: true });
    expect(await rows(sql`select key from workspace_setting where key = 'support.csat'`)).toEqual([]);
    await setupProcessoOperativo(db, { apply: true, csat: true });
    expect((await rows(sql`select value from workspace_setting where key = 'support.csat'`))[0].value).toEqual({
      enabled: true,
    });
  });
});

describe("⚠️⚠️ what somebody already chose", () => {
  it("is left alone: a stage whose probability was changed keeps its name", async () => {
    await db.execute(sql`update pipeline_stage set default_probability = 30 where name = 'Discovery'`);
    const lines = await setupProcessoOperativo(db, { apply: true });
    expect((await rows(sql`select name from pipeline_stage where default_probability = 30`))[0].name).toBe("Discovery");
    expect(lines).toContainEqual(expect.objectContaining({ item: "Discovery", status: "skip" }));
  });

  it("a second run changes nothing", async () => {
    const opts = { apply: true, rotation: ["anna@x.it"], supportLead: "marco@x.it" };
    await setupProcessoOperativo(db, opts);
    const tables = [
      "pipeline_stage",
      "deal_loss_reason",
      "custom_field_definition",
      "user_group",
      "email_template",
      "ticket_macro",
      "product",
      "email_sequence",
      "email_sequence_step",
      "automation_rule",
    ];
    const first = await Promise.all(tables.map(count));
    const again = await setupProcessoOperativo(db, opts);
    expect(await Promise.all(tables.map(count))).toEqual(first);
    expect(again.filter((l) => l.status === "create" || l.status === "update")).toEqual([]);
  });
});
