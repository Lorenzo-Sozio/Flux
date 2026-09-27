/**
 * `consent.withdrawn` (src/lib/consent-events.ts) against a real Postgres: the contact point
 * at the top of the payload, from the record or the link — and where it is announced from.
 */
import { readFileSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";

const sent: { event: string; payload: Record<string, unknown>; origin: unknown }[] = [];
vi.mock("@/lib/webhook-dispatch", () => ({
  dispatchWebhook: async (event: string, payload: Record<string, unknown>, origin: unknown) => {
    sent.push({ event, payload, origin });
  },
}));

const { announceOptOut } = await import("./consent-events");
const db = drizzle(new PGlite());

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  sent.length = 0;
  await db.execute(sql`delete from lead`);
  await db.execute(sql`delete from contact`);
  await db.execute(
    sql`insert into lead (id, first_name, last_name, email, phone) values ('l1', 'Anna', 'R', 'anna@x.it', '+39 333 1')`,
  );
  await db.execute(
    sql`insert into contact (id, first_name, last_name, mobile) values ('c1', 'Anna', 'R', '+39 333 2')`,
  );
});

describe("⚠️⚠️ consent.withdrawn", () => {
  it("carries the person's addresses at the top, where a receiver matching by address looks", async () => {
    await announceOptOut(
      db,
      {
        records: [
          { entity: "lead", id: "l1" },
          { entity: "contact", id: "c1" },
        ],
        source: "form",
        channel: "all",
      },
      { via: "user", actor: "u1" },
    );
    expect(sent).toEqual([
      {
        event: "consent.withdrawn",
        payload: {
          email: "anna@x.it",
          phone: "+39 333 1",
          mobile: "+39 333 2",
          channel: "all",
          source: "form",
          records: [
            { entity: "lead", id: "l1" },
            { entity: "contact", id: "c1" },
          ],
        },
        origin: { via: "user", actor: "u1" },
      },
    ]);
  });

  it("⚠️ an unsubscribe by address alone is still announced, with the address it came from", async () => {
    await announceOptOut(
      db,
      { records: [], email: " Someone@Else.IT ", source: "unsubscribe", channel: "email" },
      { via: "user", actor: null },
    );
    expect(sent[0].payload).toMatchObject({ email: "someone@else.it", channel: "email", records: [] });
  });

  it("nobody reachable, nothing announced", async () => {
    await announceOptOut(
      db,
      { records: [{ entity: "lead", id: "nope" }], source: "api", channel: "all" },
      {
        via: "api",
      },
    );
    expect(sent).toEqual([]);
  });
});

describe("⚠️⚠️ every door a refusal comes through announces it", () => {
  const read = (p: string) => readFileSync(p, "utf8").split("\r\n").join("\n");

  it("the unsubscribe link, both from a campaign and from a sequence", () => {
    expect(read("src/app/api/unsubscribe/route.ts").match(/await announceOptOut\(/g)).toHaveLength(2);
  });

  it("the record page, for a lead and for a contact, when consent goes from yes to no", () => {
    const crm = read("src/actions/crm.ts");
    expect(crm).toContain("if (previous?.marketingConsent === true && updatedLead.marketingConsent === false) {");
    expect(crm).toContain("if (previous?.marketingConsent === true && updatedContact.marketingConsent === false) {");
    expect(crm.match(/await announceOptOut\(/g)).toHaveLength(2);
  });

  it("⚠️⚠️ unticking the marketing consent refuses marketing, not every contact (decided 27 September 2026)", () => {
    // The follow-ups a person asked for go on: two purposes, the line /api/crm/opt-out draws too.
    const crm = read("src/actions/crm.ts");
    expect(crm.match(/source: "form", channel: "marketing"/g)).toHaveLength(2);
    expect(crm).not.toContain('source: "form", channel: "all"');
  });
});
