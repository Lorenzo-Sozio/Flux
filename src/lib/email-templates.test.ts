/**
 * One-to-one email templates, against a real Postgres: who sees which, who may change them, and
 * the order the email dialog offers them in.
 *
 * ⚠️⚠️ A personal template is someone's own text until they share it. A list that showed a
 * colleague's private drafts, or let anybody rewrite a template the whole team sends, would be
 * the kind of mistake nobody notices until it has been sent to a customer.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";

import { canEditTemplate, canSeeTemplate } from "./email-template-rules";
import { listComposerTemplates, listPersonalTemplates, recordTemplateUse } from "./email-templates";

const db = drizzle(new PGlite());

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  await db.execute(sql`delete from email_template`);
  await db.execute(sql`delete from "user"`);
  await db.execute(
    sql`insert into "user" (id, name, email) values ('anna', 'Anna', 'a@x.it'), ('luca', 'Luca', 'l@x.it')`,
  );
  await db.execute(sql`
    insert into email_template (id, name, subject, body, kind, category, owner_id, is_public, use_count) values
    ('camp', 'Newsletter', 'Novità', '<p>n</p>', 'campaign', 'general', 'luca', false, 100),
    ('anna-private', 'Mio follow-up', 'Follow-up', '<p>a</p>', 'personal', 'followup', 'anna', false, 1),
    ('anna-shared', 'Offerta standard', 'Offerta', '<p>o</p>', 'personal', 'quote', 'anna', true, 9),
    ('luca-private', 'Bozza di Luca', 'Segreto', '<p>l</p>', 'personal', 'other', 'luca', false, 50)`);
});

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe("⚠️⚠️ who sees a template", () => {
  it("offers Luca his own, the team's shared ones and the campaign ones — never Anna's private one", async () => {
    const rows = await listComposerTemplates(db, "luca");
    expect(ids(rows)).toContain("anna-shared");
    expect(ids(rows)).toContain("camp");
    expect(ids(rows)).toContain("luca-private");
    expect(ids(rows)).not.toContain("anna-private");
  });

  it("puts one-to-one templates before campaign ones — even a campaign one used more — the most used first", async () => {
    expect(ids(await listComposerTemplates(db, "anna"))).toEqual(["anna-shared", "anna-private", "camp"]);
  });

  it("says which are mine, for the dialog's groups", async () => {
    const rows = await listComposerTemplates(db, "anna");
    expect(rows.find((r) => r.id === "anna-private")?.mine).toBe(true);
    expect(rows.find((r) => r.id === "camp")?.mine).toBe(false);
  });

  it("lists on the management page only one-to-one templates the person may see", async () => {
    const rows = await listPersonalTemplates(db, "luca");
    expect(ids(rows).sort()).toEqual(["anna-shared", "luca-private"]);
    expect(rows.find((r) => r.id === "anna-shared")?.ownerName).toBe("Anna");
  });
});

describe("the rules, one by one", () => {
  const personal = (ownerId: string, isPublic: boolean) => ({ kind: "personal", ownerId, isPublic });

  it("lets a person see their own and shared templates, and every campaign one", () => {
    expect(canSeeTemplate(personal("anna", false), "anna")).toBe(true);
    expect(canSeeTemplate(personal("anna", false), "luca")).toBe(false);
    expect(canSeeTemplate(personal("anna", true), "luca")).toBe(true);
    expect(canSeeTemplate({ kind: "campaign", ownerId: "anna", isPublic: false }, "luca")).toBe(true);
  });

  it("⚠️ lets the owner change a template, and an administrator only a shared one", () => {
    expect(canEditTemplate(personal("anna", false), { userId: "anna", manageAny: false })).toBe(true);
    expect(canEditTemplate(personal("anna", true), { userId: "luca", manageAny: false })).toBe(false);
    expect(canEditTemplate(personal("anna", true), { userId: "luca", manageAny: true })).toBe(true);
    expect(canEditTemplate(personal("anna", false), { userId: "luca", manageAny: true })).toBe(false);
  });

  it("leaves campaign templates to Marketing", () => {
    expect(
      canEditTemplate({ kind: "campaign", ownerId: "anna", isPublic: true }, { userId: "anna", manageAny: true }),
    ).toBe(false);
  });
});

describe("recordTemplateUse", () => {
  it("counts a send and dates it", async () => {
    await recordTemplateUse(db, "anna-private");
    await recordTemplateUse(db, "anna-private");
    const res = await db.execute(sql`select use_count, last_used_at from email_template where id = 'anna-private'`);
    const row = res.rows[0] as { use_count: number; last_used_at: Date | null };
    expect(row.use_count).toBe(3);
    expect(row.last_used_at).not.toBeNull();
  });
});
