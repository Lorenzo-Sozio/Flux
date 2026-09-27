/**
 * A person's rights from their record, and where their consent came from — against a real
 * Postgres.
 *
 * ⚠️⚠️ Erasure existed only behind an API key, an export of a person's data did not exist
 * at all, and consent was a boolean whose date stayed on the grant after an unsubscribe.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";
import * as schema from "@/db/schema";

import { buildContactPayload, buildLeadPayload } from "./api-import-validators";
import { consentPatch } from "./consent";
import { withdrawConsent } from "./consent-withdraw";
import { eraseByContactPoint } from "./erasure";
import { can } from "./permissions";
import { exportByContactPoint } from "./subject-access";

const db = drizzle(new PGlite(), { schema });

vi.mock("@/lib/tenant-context", () => ({ getDb: async () => db, getCurrentTenantId: async () => "t1" }));
vi.mock("@/lib/auth-guard", () => ({
  requireWriteAccess: async () => ({ user: { id: "anna" } }),
  requireCapability: async () => ({ userId: "anna", tenantRole: "admin", isPlatformStaff: false }),
  requirePlanLimit: async () => undefined,
}));
vi.mock("@/lib/i18n-server", () => ({ guardedT: (fn: () => unknown) => fn() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("@/lib/webhook-dispatch", () => ({ dispatchWebhook: async () => undefined }));
vi.mock("@/components/crm/automation/rule-engine", () => ({ runAutomations: async () => undefined }));
vi.mock("@/lib/notify", () => ({ notify: async () => undefined, notifyMany: async () => undefined }));
vi.mock("@/lib/record-count", () => ({ countRecords: async () => 0 }));

const { createContact, updateContact } = await import("@/actions/crm");

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  for (const t of ["field_change", "ticket_message", "ticket", "task", "activity", "deal", "contact", "lead"]) {
    await db.execute(sql.raw(`delete from "${t}"`));
  }
  await db.execute(sql`delete from email_suppression`);
  await db.execute(sql`delete from "user"`);
  await db.execute(sql`insert into "user" (id, name, email) values ('anna', 'Anna', 'anna@firm.it')`);
});

async function row(table: string, id: string) {
  const [r] = (await db.execute(sql.raw(`select * from "${table}" where id = '${id}'`))).rows as Record<
    string,
    unknown
  >[];
  return r;
}

async function history(entityId: string) {
  return (
    await db.execute(
      sql`select field, old_value, new_value, changed_by from field_change where entity_id = ${entityId} order by changed_at`,
    )
  ).rows;
}

describe("consent, decided", () => {
  const now = new Date("2026-09-26T10:00:00Z");
  const earlier = new Date("2026-01-10T10:00:00Z");

  it("a new yes is dated and sourced; a new no carries nothing", () => {
    expect(consentPatch(null, true, "form", now)).toEqual({
      marketingConsent: true,
      consentDate: now,
      consentSource: "form",
    });
    expect(consentPatch(null, false, "form", now)).toEqual({
      marketingConsent: false,
      consentDate: null,
      consentSource: null,
    });
    expect(consentPatch(null, undefined, "form", now)).toEqual({});
  });

  it("⚠️ unchanged keeps the date and source of the decision; a date typed for a standing yes is kept", () => {
    const before = { marketingConsent: true, consentDate: earlier };
    expect(consentPatch(before, true, "form", now)).toEqual({});
    const onPaper = new Date("2026-02-01T00:00:00Z");
    expect(consentPatch(before, true, "form", now, onPaper)).toEqual({ consentDate: onPaper });
  });

  it("⚠️⚠️ a withdrawal is dated today, not left on the date of the grant", () => {
    expect(consentPatch({ marketingConsent: true, consentDate: earlier }, false, "form", now)).toEqual({
      marketingConsent: false,
      consentDate: now,
      consentSource: "form",
    });
  });
});

describe("⚠️⚠️ consent through the form", () => {
  it("is sourced on create, and its change is dated and in the history", async () => {
    // Collected on paper in January, recorded now.
    const created = (await createContact({
      firstName: "Mario",
      lastName: "Rossi",
      marketingConsent: true,
      consentDate: "2026-01-10",
    })) as { contact: { id: string } };
    const id = created.contact.id;
    expect(await row("contact", id)).toMatchObject({ marketing_consent: true, consent_source: "form" });

    await updateContact(id, { marketingConsent: false });
    const after = await row("contact", id);
    expect(after).toMatchObject({ marketing_consent: false, consent_source: "form" });
    // The withdrawal's own date, not January's grant.
    expect(at(after.consent_date).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(await history(id)).toEqual([
      { field: "marketingConsent", old_value: "true", new_value: "false", changed_by: "anna" },
    ]);
  });
});

describe("⚠️⚠️ a withdrawal from outside", () => {
  it("is dated, sourced, and in the history as the person's own doing — once", async () => {
    await db.execute(
      sql`insert into lead (id, first_name, last_name, email, marketing_consent, consent_date, consent_source)
          values ('l1', 'Elena', 'Galli', 'elena@example.com', true, '2026-01-10T10:00:00Z', 'import')`,
    );
    const now = new Date("2026-09-26T10:00:00Z");
    expect(await withdrawConsent(db, "lead", "l1", "unsubscribe", now)).toBe(true);
    expect(await row("lead", "l1")).toMatchObject({ marketing_consent: false, consent_source: "unsubscribe" });
    expect(at((await row("lead", "l1")).consent_date)).toEqual(now);
    expect(await history("l1")).toEqual([
      { field: "marketingConsent", old_value: "true", new_value: "false", changed_by: null },
    ]);
    // Again: nothing to withdraw, and the decision keeps its date.
    expect(await withdrawConsent(db, "lead", "l1", "unsubscribe", new Date())).toBe(false);
    expect(at((await row("lead", "l1")).consent_date)).toEqual(now);
    expect(await history("l1")).toHaveLength(1);
  });
});

describe("⚠️⚠️ the person's data, and their erasure", () => {
  beforeEach(async () => {
    await db.execute(sql`
      insert into lead (id, first_name, last_name, email) values ('l1', 'Elena', 'Galli', 'Elena@Example.com')`);
    await db.execute(sql`
      insert into contact (id, first_name, last_name, email, marketing_consent, consent_source)
      values ('c1', 'Elena', 'Galli', 'elena@example.com', true, 'form')`);
    await db.execute(sql`insert into activity (id, type, content, contact_id) values ('a1', 'call', 'Chiamata', 'c1')`);
    await db.execute(sql`insert into deal (id, name, amount, contact_id) values ('d1', 'Arredo', '9000', 'c1')`);
    await db.execute(
      sql`insert into field_change (id, entity_type, entity_id, field, old_value, new_value) values ('h1', 'contact', 'c1', 'email', 'old@example.com', 'elena@example.com')`,
    );
    await db.execute(
      sql`insert into email_suppression (id, email, reason) values ('s1', 'elena@example.com', 'unsubscribe')`,
    );
  });

  it("the export holds every record of the person, their history and consent — and a deal only as the link", async () => {
    const data = await exportByContactPoint(db, " ELENA@example.com ");
    expect(data.found).toEqual({ leads: 1, contacts: 1 });
    expect(data.records.activities).toHaveLength(1);
    expect(data.records.history).toHaveLength(1);
    expect(data.records.suppression).toHaveLength(1);
    expect(data.consent).toContainEqual(
      expect.objectContaining({ record: "contact", id: "c1", marketingConsent: true, source: "form" }),
    );
    expect(data.records.deals).toEqual([expect.objectContaining({ id: "d1", name: "Arredo" })]);
    expect(data.records.deals[0]).not.toHaveProperty("amount");
  });

  it("⚠️⚠️ erasure takes the history with it: the old address is not left one table away", async () => {
    const report = await eraseByContactPoint(db, "elena@example.com");
    expect(report.deleted.field_change).toBe(1);
    expect((await db.execute(sql`select count(*)::int as n from field_change`)).rows[0]).toEqual({ n: 0 });
    // Nothing is reachable any more, and the deal survives without the person.
    expect((await exportByContactPoint(db, "elena@example.com")).found).toEqual({ leads: 0, contacts: 0 });
    expect(await row("deal", "d1")).toMatchObject({ name: "Arredo" });
  });

  it("⚠️ is for administrators only", () => {
    expect(can("admin", "privacy:manage")).toBe(true);
    expect(can("editor", "privacy:manage")).toBe(false);
    expect(can("viewer", "privacy:manage")).toBe(false);
  });
});

/** A raw \`timestamp\` column comes back as UTC text. */
function at(value: unknown): Date {
  return value instanceof Date ? value : new Date(`${String(value).replace(" ", "T")}Z`);
}

describe("⚠️ consent arriving through an import or the API", () => {
  it("a yes is dated and says where it came from; a no is left alone", () => {
    const yes = buildContactPayload(
      { firstName: "A", lastName: "B", marketingConsent: true } as never,
      "anna",
      "import",
    );
    expect(yes).toMatchObject({ marketingConsent: true, consentSource: "import" });
    expect(yes).toHaveProperty("consentDate");
    const api = buildLeadPayload({ firstName: "A", lastName: "B", marketingConsent: true } as never, "anna");
    expect(api).toMatchObject({ consentSource: "api" });
    const no = buildLeadPayload({ firstName: "A", lastName: "B", marketingConsent: false } as never, "anna");
    expect(no).not.toHaveProperty("consentSource");
  });
});
