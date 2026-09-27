/**
 * The Bcc archive address, against a real Postgres, through processInboundEmail.
 *
 * ⚠️⚠️ Email written from Gmail or Outlook never reached a timeline: the record said
 * "last contact three weeks ago" about somebody emailed yesterday. Copying an address in
 * Bcc files it on the records it was sent to — and nowhere it was not.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";
import * as schema from "@/db/schema";

import { addressHeaderText } from "./email-parser";
import {
  ARCHIVE_MAX_RECORDS,
  archiveAddress,
  archiveDomain,
  ensureArchiveToken,
  findArchiveAlias,
  newArchiveToken,
  parseArchiveAddress,
  rotateArchiveToken,
} from "./mail-archive";

const DOMAIN = "in.flux.test";
const db = drizzle(new PGlite(), { schema });
const notified: { userId: string; type: string; key?: string; params?: Record<string, unknown> }[] = [];
let writers = ["anna"];

vi.mock("@/lib/tenant-resolve", () => ({
  resolveTenantByProbe: async (_key: string, probe: (d: unknown, t: unknown) => Promise<boolean>) => {
    const tenant = { id: "t1", subdomain: "acme" };
    return (await probe(db, tenant)) ? { db, tenant } : null;
  },
}));
vi.mock("@/lib/workspace-members", () => ({ membersWith: async () => writers }));
vi.mock("@/lib/tenant-context", () => ({ runWithTenant: (_id: string, fn: () => unknown) => fn() }));
vi.mock("@/lib/notify", () => ({
  notify: async (n: (typeof notified)[number]) => {
    notified.push(n);
  },
}));
vi.mock("@/lib/sequence-runner", () => ({ stopOnReply: async () => 0 }));
vi.mock("@/lib/schema-ready", () => ({ tolerateUnmigrated: (_f: string, fn: () => unknown) => fn() }));
vi.mock("@/components/crm/automation/rule-engine", () => ({ runAutomations: async () => undefined }));
vi.mock("next/server", () => ({ after: () => undefined }));

const { processInboundEmail } = await import("./ticket-from-email");

let token = "";

beforeAll(async () => {
  vi.stubEnv("INBOUND_BCC_DOMAIN", DOMAIN);
  await applyTenantMigrations(db as never);
}, 120_000);

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  notified.length = 0;
  writers = ["anna"];
  for (const t of [
    "ticket_message",
    "ticket",
    "task",
    "activity",
    "contact",
    "lead",
    "company",
    "email_settings",
    "mail_archive_address",
  ]) {
    await db.execute(sql.raw(`delete from "${t}"`));
  }
  await db.execute(sql`delete from "user"`);
  await db.execute(sql`insert into "user" (id, name, email) values ('anna', 'Anna', 'anna@firm.it')`);
  await db.execute(sql`insert into email_settings (id, from_email) values ('es1', 'info@firm.it')`);
  await db.execute(sql`insert into company (id, name) values ('co1', 'Rossi Srl')`);
  await db.execute(
    sql`insert into contact (id, first_name, last_name, email, company_id) values ('c1', 'Mario', 'Rossi', 'Mario@Rossi.it', 'co1')`,
  );
  await db.execute(
    sql`insert into lead (id, first_name, last_name, email) values ('l1', 'Giulia', 'Bianchi', 'giulia@bianchi.it')`,
  );
  await db.execute(
    sql`insert into lead (id, first_name, last_name, email, is_converted) values ('l2', 'Vecchio', 'Lead', 'old@lead.it', true)`,
  );
  token = await ensureArchiveToken(db, "anna");
});

function alias(t = token, subdomain = "acme") {
  return archiveAddress(subdomain, t, DOMAIN);
}

function mail(over: Partial<Parameters<typeof processInboundEmail>[0]> = {}) {
  return processInboundEmail({
    fromRaw: "Anna <anna@gmail.com>",
    to: "Mario Rossi <mario@rossi.it>",
    cc: "giulia@bianchi.it, old@lead.it, collega@firm.it",
    // A Bcc recipient is in no header: only among where it was delivered.
    recipients: [alias()],
    subject: "Offerta",
    htmlBody: "",
    textBody: "Ecco l'offerta che le avevo promesso.",
    inboundMessageId: "<m1@gmail.com>",
    inReplyTo: null,
    ...over,
  });
}

async function rows(table: string) {
  return (await db.execute(sql.raw(`select * from "${table}"`))).rows as Record<string, unknown>[];
}

describe("the address", () => {
  it("round-trips, and nothing else parses as one", () => {
    const t = newArchiveToken();
    expect(t).toMatch(/^[a-z2-7]{20}$/);
    expect(parseArchiveAddress(archiveAddress("acme-srl", t, DOMAIN), DOMAIN)).toEqual({
      subdomain: "acme-srl",
      token: t,
    });
    // Case folded by a mail system along the way still names the same person.
    expect(parseArchiveAddress(archiveAddress("acme", t, DOMAIN).toUpperCase(), DOMAIN)).toEqual({
      subdomain: "acme",
      token: t,
    });
    expect(parseArchiveAddress(archiveAddress("acme", t, "other.test"), DOMAIN)).toBeNull();
    expect(parseArchiveAddress(`crm+acme.${t.slice(1)}@${DOMAIN}`, DOMAIN)).toBeNull();
    expect(parseArchiveAddress(`info+acme.${t}@${DOMAIN}`, DOMAIN)).toBeNull();
    expect(parseArchiveAddress(`crm+acme.${t}@x.${DOMAIN}`, DOMAIN)).toBeNull();
  });

  it("⚠️ is found in any delivery header, and not at all without a domain configured", () => {
    const a = alias();
    expect(findArchiveAlias(["mario@rossi.it", `Archivio <${a}>`], DOMAIN)?.address).toBe(a);
    expect(findArchiveAlias([a], null)).toBeNull();
    expect(archiveDomain({})).toBeNull();
    expect(archiveDomain({ INBOUND_BCC_DOMAIN: " @In.Flux.Test " })).toBe(DOMAIN);
    expect(archiveDomain({ INBOUND_BCC_DOMAIN: "not a domain" })).toBeNull();
  });

  it("reads the shapes bridges hand an address header in", () => {
    expect(addressHeaderText("a@x.it")).toBe("a@x.it");
    expect(addressHeaderText(["a@x.it", "b@x.it"])).toBe("a@x.it, b@x.it");
    expect(addressHeaderText({ text: "A <a@x.it>" })).toBe("A <a@x.it>");
    expect(addressHeaderText({ value: [{ address: "a@x.it" }, { address: "b@x.it" }] })).toBe("a@x.it, b@x.it");
    expect(addressHeaderText(42)).toBe("");
    expect(addressHeaderText(null)).toBe("");
  });

  it("is one per person, and a new one replaces it", async () => {
    expect(await ensureArchiveToken(db, "anna")).toBe(token);
    const next = await rotateArchiveToken(db, "anna");
    expect(next).not.toBe(token);
    expect(await ensureArchiveToken(db, "anna")).toBe(next);
  });
});

describe("⚠️⚠️ an email copied to the address", () => {
  it("is filed on the contact and the open lead it was sent to, by the person who sent it", async () => {
    const result = await mail();
    expect(result).toMatchObject({ ok: true, action: "archived", filed: 2 });

    const filed = await rows("activity");
    expect(filed.map((a) => [a.contact_id, a.lead_id, a.company_id, a.owner_id])).toEqual(
      expect.arrayContaining([
        ["c1", null, "co1", "anna"],
        [null, "l1", null, "anna"],
      ]),
    );
    expect(filed).toHaveLength(2);
    const content = JSON.parse(String(filed[0].content));
    expect(content).toMatchObject({ _type: "email_v2", direction: "out", subject: "Offerta" });
    expect(content.bodyText).toContain("offerta che le avevo promesso");
    // Not a ticket, not a reply owed, and no stub contact for anybody it did not know.
    expect(await rows("ticket")).toEqual([]);
    expect(await rows("task")).toEqual([]);
    expect(await rows("contact")).toHaveLength(1);
    expect(notified).toEqual([]);
  });

  it("⚠️ once per record, however many times the webhook delivers it", async () => {
    await mail();
    expect(await mail()).toMatchObject({ ok: true, action: "archived", filed: 0 });
    expect(await rows("activity")).toHaveLength(2);
  });

  it("from a customer, reads as written by them", async () => {
    await mail({ fromRaw: "Mario Rossi <mario@rossi.it>", to: "anna@gmail.com", cc: "" });
    const [filed] = await rows("activity");
    expect(filed).toMatchObject({ contact_id: "c1", owner_id: null });
    expect(JSON.parse(String(filed.content)).direction).toBe("in");
  });

  it("⚠️ matching nobody, files nothing and says so", async () => {
    const result = await mail({ to: "sconosciuto@altro.it", cc: "" });
    expect(result).toMatchObject({ ok: true, action: "archived", filed: 0 });
    expect(await rows("activity")).toEqual([]);
    expect(await rows("ticket")).toEqual([]);
    expect(notified).toEqual([
      expect.objectContaining({ userId: "anna", key: "mailArchiveUnmatched", params: { subject: "Offerta" } }),
    ]);
  });

  it("⚠️ an address that was replaced files nothing", async () => {
    const old = token;
    await rotateArchiveToken(db, "anna");
    expect(await mail({ recipients: [alias(old)] })).toMatchObject({ ok: false, skipped: "unknown_archive_address" });
    expect(await rows("activity")).toEqual([]);
  });

  it("⚠️ nor one whose owner may no longer write here", async () => {
    writers = ["luca"];
    expect(await mail()).toMatchObject({ ok: false, skipped: "unknown_archive_address" });
    expect(await rows("activity")).toEqual([]);
  });

  it("nor one naming another workspace", async () => {
    expect(await mail({ recipients: [alias(token, "altra")] })).toMatchObject({ skipped: "unknown_archive_address" });
    expect(await rows("activity")).toEqual([]);
  });

  it("⚠️ a message to a list is filed on a bounded number of records", async () => {
    const many = Array.from({ length: ARCHIVE_MAX_RECORDS + 5 }, (_, i) => `p${i}@lista.it`);
    for (const [i, email] of many.entries()) {
      await db.execute(
        sql`insert into contact (id, first_name, last_name, email) values (${`m${i}`}, 'P', 'Q', ${email})`,
      );
    }
    expect(await mail({ to: many.join(", "), cc: "" })).toMatchObject({ filed: ARCHIVE_MAX_RECORDS });
  });

  it("without the address, an email is what it always was", async () => {
    expect(await mail({ recipients: [], to: "info@firm.it", cc: "" })).toMatchObject({ action: "ticket_created" });
    expect(await rows("activity")).toEqual([]);
  });
});
