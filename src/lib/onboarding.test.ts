/**
 * The first run: steps ticked by the data, and sample data that comes out as cleanly as it
 * went in — against a real Postgres.
 *
 * ⚠️⚠️ A new workspace opened on empty screens with no word about what to do first, and the
 * demo data existed only as a script for developers.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";
import { seedWorkspace } from "@/db/seed-workspace";

import { ONBOARDING_KEYS, readOnboarding, setOnboardingFlag, showOnboarding } from "./onboarding";
import { loadSampleData, removeSampleData, SAMPLE_PREFIX, sampleDependents } from "./sample-data";

const db = drizzle(new PGlite());
const solo = { members: 1, pendingInvitations: 0 };

const TABLES = ["task", "activity", "deal", "lead", "contact", "company"];

beforeAll(async () => {
  await applyTenantMigrations(db as never);
  await seedWorkspace(db as never);
}, 120_000);

beforeEach(async () => {
  for (const t of [...TABLES, "invoice_issuer", "email_settings", "workspace_setting"]) {
    await db.execute(sql.raw(`delete from "${t}"`));
  }
  await db.execute(sql`delete from "user"`);
  await db.execute(sql`insert into "user" (id, name, email) values ('anna', 'Anna', 'anna@firm.it')`);
  await db.execute(sql`update pipeline_stage set updated_at = created_at`);
});

async function count(table: string, where = "true") {
  const [row] = (await db.execute(sql.raw(`select count(*)::int as n from "${table}" where ${where}`))).rows as {
    n: number;
  }[];
  return row.n;
}

describe("⚠️⚠️ sample data", () => {
  it("fills every screen, reaches nobody real, and is owned by whoever loaded it", async () => {
    expect(await loadSampleData(db, { ownerId: "anna", locale: "it" })).toEqual({ ok: true });
    expect(await count("company")).toBe(3);
    expect(await count("contact")).toBe(5);
    expect(await count("lead")).toBe(3);
    expect(await count("deal")).toBe(6);
    expect(await count("deal", "status = 'won' and closed_at is not null")).toBe(1);
    expect(await count("activity")).toBe(4);
    expect(await count("task")).toBe(3);
    // RFC 2606 domains only, and nobody consented to marketing.
    expect(await count("contact", "email !~ '@example\\.(com|org|net)$' or marketing_consent")).toBe(0);
    expect(await count("lead", "email !~ '@example\\.(com|org|net)$' or marketing_consent")).toBe(0);
    expect(await count("deal", "owner_id <> 'anna'")).toBe(0);
    for (const t of TABLES) expect(await count(t, `id not like '${SAMPLE_PREFIX}%'`)).toBe(0);
  });

  it("⚠️ is never mixed into a workspace that has records of its own", async () => {
    await db.execute(sql`insert into contact (id, first_name, last_name) values ('real', 'Vero', 'Cliente')`);
    expect(await loadSampleData(db, { ownerId: "anna", locale: "it" })).toEqual({ ok: false, reason: "notEmpty" });
    expect(await count("deal")).toBe(0);
  });

  it("is loaded once", async () => {
    await loadSampleData(db, { ownerId: "anna", locale: "en" });
    expect(await loadSampleData(db, { ownerId: "anna", locale: "en" })).toEqual({
      ok: false,
      reason: "alreadyLoaded",
    });
  });

  it("⚠️⚠️ comes out entirely, with what was added to it, and nothing else", async () => {
    await loadSampleData(db, { ownerId: "anna", locale: "it" });
    // A note somebody logged on a sample contact, and a real contact created afterwards.
    await db.execute(
      sql`insert into activity (id, type, content, contact_id) values ('mine', 'note', 'Nota', ${`${SAMPLE_PREFIX}contact-1`})`,
    );
    await db.execute(sql`insert into contact (id, first_name, last_name) values ('real', 'Vero', 'Cliente')`);
    expect(await sampleDependents(db)).toBe(1);

    await removeSampleData(db);
    for (const t of TABLES) expect(await count(t, `id like '${SAMPLE_PREFIX}%'`)).toBe(0);
    expect(await count("activity", "id = 'mine'")).toBe(0);
    expect(await count("contact", "id = 'real'")).toBe(1);
  });
});

describe("⚠️⚠️ the steps are ticked by the data", () => {
  it("a new workspace has everything to do, and the card shows", async () => {
    const state = await readOnboarding(db, solo);
    expect(state.steps).toEqual({ company: false, team: false, contacts: false, stages: false, email: false });
    expect(showOnboarding(state)).toBe(true);
  });

  it("company: the legal details, or a logo", async () => {
    await db.execute(sql`insert into invoice_issuer (id, legal_name) values ('workspace', '')`);
    expect((await readOnboarding(db, solo)).steps.company).toBe(false);
    await db.execute(sql`update invoice_issuer set vat_number = 'IT01234567890'`);
    expect((await readOnboarding(db, solo)).steps.company).toBe(true);
  });

  it("team: somebody else in the workspace, or invited", async () => {
    expect((await readOnboarding(db, { members: 2, pendingInvitations: 0 })).steps.team).toBe(true);
    expect((await readOnboarding(db, { members: 1, pendingInvitations: 1 })).steps.team).toBe(true);
  });

  it("⚠️ contacts: sample data does not count as having imported anything", async () => {
    await loadSampleData(db, { ownerId: "anna", locale: "it" });
    const withSample = await readOnboarding(db, solo);
    expect(withSample.steps.contacts).toBe(false);
    expect(withSample.sample).toBe(true);
    await db.execute(sql`insert into company (id, name) values ('real', 'Vera Srl')`);
    expect((await readOnboarding(db, solo)).steps.contacts).toBe(true);
  });

  it("stages: edited since they were created, or declared fine", async () => {
    await db.execute(sql`update pipeline_stage set updated_at = created_at + interval '1 hour' where "order" = 1`);
    expect((await readOnboarding(db, solo)).steps.stages).toBe(true);
    await db.execute(sql`update pipeline_stage set updated_at = created_at`);
    await setOnboardingFlag(db, ONBOARDING_KEYS.stagesReviewed, true);
    expect((await readOnboarding(db, solo)).steps.stages).toBe(true);
  });

  it("⚠️ email: a configured account — not the placeholder address — or an archived email", async () => {
    await db.execute(
      sql`insert into email_settings (id, resend_api_key, from_email) values ('es', 're_123', 'noreply@yourdomain.com')`,
    );
    expect((await readOnboarding(db, solo)).steps.email).toBe(false);
    await db.execute(sql`update email_settings set from_email = 'info@firm.it'`);
    expect((await readOnboarding(db, solo)).steps.email).toBe(true);
    await db.execute(sql`delete from email_settings`);
    await db.execute(sql`insert into activity (id, type, message_id) values ('bcc', 'email', '<m@x>')`);
    expect((await readOnboarding(db, solo)).steps.email).toBe(true);
  });

  it("⚠️ put away, it stays away — unless sample data is still in, whose removal lives there", async () => {
    await setOnboardingFlag(db, ONBOARDING_KEYS.dismissed, true);
    expect(showOnboarding(await readOnboarding(db, solo))).toBe(false);
    await loadSampleData(db, { ownerId: "anna", locale: "it" });
    expect(showOnboarding(await readOnboarding(db, solo))).toBe(true);
  });
});
