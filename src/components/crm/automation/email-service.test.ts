/**
 * An automation's email, against a real Postgres: who it goes to, what it says, and
 * whether its links open.
 *
 * ⚠️⚠️ Three things were broken here and none looked broken from the rule builder:
 *
 *  1. `{{contact.email}}` — the recipient the builder suggests — never resolved, because
 *     the record was spread flat. The send failed with "Invalid recipient email after
 *     merge", and a rule on a deal had no way to reach the deal's contact at all.
 *  2. Every tracked link was built without its signature, and the click route answers
 *     an unsigned link with a 400: the customer clicked and landed on an error.
 *  3. The owner was loaded as the whole `user` row, so `{{owner.password}}` resolved.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";

process.env.RESEND_API_KEY = "re_test";
process.env.TRACKING_SECRET = "segreto-di-prova";
process.env.NEXT_PUBLIC_APP_URL = "https://crm.example.it";

const db = drizzle(new PGlite());
vi.mock("@/lib/tenant-context", () => ({ getDb: async () => db }));

const { sendAutomationEmailWithContext } = await import("./email-service");
const { verifyTrackingUrl } = await import("@/lib/tracking-token");

// What the rule queued: the workspace's worker sends it (V2.7, §8.3).
let inviati: { to: string; subject: string; html: string; cc: string | null; campaignLogId: string | null }[] = [];
async function queued() {
  inviati = (
    await db.execute(
      sql`select to_email as "to", subject, html_body as html, cc, campaign_log_id as "campaignLogId" from email_job order by created_at`,
    )
  ).rows as typeof inviati;
}

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  inviati = [];
  // ⚠️ No network: an automation email never leaves from here any more.
  vi.stubGlobal("fetch", async () => {
    throw new Error("an automation email must be queued, not sent directly");
  });
  await db.execute(sql`delete from email_job`);
  await db.execute(sql`delete from email_suppression`);
  await db.execute(sql`delete from campaign_log`);
  await db.execute(sql`delete from deal`);
  await db.execute(sql`delete from contact`);
  await db.execute(sql`delete from company`);
  await db.execute(sql`delete from "user"`);
  await db.execute(
    sql`insert into "user" (id, name, email, password) values ('u1', 'Giulia Verdi', 'giulia@studio.it', '$2b$10$hash-segreto')`,
  );
  await db.execute(sql`insert into company (id, name) values ('co1', 'Rossi Impianti Srl')`);
  await db.execute(
    sql`insert into contact (id, first_name, last_name, email, company_id) values ('c1', 'Mario', 'Rossi', 'mario@rossi.it', 'co1')`,
  );
  await db.execute(
    sql`insert into deal (id, name, amount, contact_id, company_id, owner_id) values ('d1', 'Impianto sede', '12000', 'c1', 'co1', 'u1')`,
  );
});

const onDeal = { entityType: "deal", entityId: "d1", event: "onUpdate", oldData: {}, newData: {} } as const;

async function send(to: string, subject: string, body: string, trackClicks = false, cc?: string) {
  try {
    return await sendAutomationEmailWithContext(to, cc, undefined, subject, body, false, trackClicks, onDeal);
  } finally {
    await queued();
  }
}

/** The body as written, before the unsubscribe footer every automated email carries. */
const written = (html: string) => html.split("<p style")[0].split("\n<")[0];

describe("⚠️⚠️ the fields the builder suggests are the fields that resolve", () => {
  it("a rule on a deal writes to the deal's contact, by {{contact.email}}", async () => {
    await send("{{contact.email}}", "{{deal.name}}", "<p>Gentile {{contact.firstName}}</p>");

    expect(inviati).toHaveLength(1);
    expect(inviati[0].to).toBe("mario@rossi.it");
    expect(inviati[0].subject).toBe("Impianto sede");
    expect(inviati[0].html).toContain("Gentile Mario");
  });

  it("names the company and the owner, and gives a person a full name", async () => {
    await send("{{contact.email}}", "x", "{{company.name}} · {{owner.name}} · {{contact.name}}");

    expect(inviati[0].html).toContain("Rossi Impianti Srl · Giulia Verdi · Mario Rossi");
  });

  it("keeps the flat fields that rules written earlier use", async () => {
    await send("{{contact.email}}", "{{name}} — {{amount}}", "x");

    expect(inviati[0].subject).toBe("Impianto sede — 12000.00");
  });

  it("⚠️⚠️ never exposes the owner's password or anything else of theirs beyond name and email", async () => {
    await send("{{contact.email}}", "x", "[{{owner.password}}] [{{owner.externalCalendarUrl}}] [{{owner.role}}]");

    expect(inviati[0].html).not.toContain("hash-segreto");
    expect(inviati[0].html.startsWith("[{{owner.password}}] [{{owner.externalCalendarUrl}}] [{{owner.role}}]")).toBe(
      true,
    );
  });

  it("an empty field is empty text, not the word null", async () => {
    // job_title is null on this contact, and optional in the schema.
    await send("{{contact.email}}", "x", "Ruolo: {{contact.jobTitle}}.");

    expect(inviati[0].html.startsWith("Ruolo: .")).toBe(true);
  });

  it("an unresolved recipient is refused before anything is sent", async () => {
    await expect(send("{{contact.nonEsiste}}", "x", "y")).rejects.toThrow(/Invalid recipient/);
    expect(inviati).toEqual([]);
  });
});

describe("⚠️⚠️ a tracked link opens", () => {
  it("every rewritten link carries a signature the click route accepts", async () => {
    await send("{{contact.email}}", "x", '<a href="https://www.rossi.it/offerta">offerta</a>', true);

    const href = inviati[0].html.match(/href="([^"]+)"/)?.[1] ?? "";
    const link = new URL(href);
    expect(link.origin + link.pathname).toBe("https://crm.example.it/api/track/click");
    const log = link.searchParams.get("log") ?? "";
    const url = link.searchParams.get("url") ?? "";
    const sig = link.searchParams.get("sig") ?? "";
    expect(url).toBe("https://www.rossi.it/offerta");
    expect(verifyTrackingUrl(log, url, sig)).toBe(true);
  });
});

describe("⚠️⚠️ through the workspace's queue (§8.3)", () => {
  it("is queued as an email_job, signed with its own log, copies kept", async () => {
    await send("{{contact.email}}", "x", "<p>ciao</p>", false, "{{owner.email}}");

    expect(inviati).toHaveLength(1);
    expect(inviati[0]).toMatchObject({ to: "mario@rossi.it", cc: "giulia@studio.it" });
    expect(inviati[0].campaignLogId).toBeTruthy();
  });

  it("carries a way out, signed against its log", async () => {
    await send("{{contact.email}}", "x", "<p>ciao</p>");

    expect(inviati[0].html).toMatch(/\/api\/unsubscribe\?token=/);
  });

  it("⚠️ is not written to somebody who unsubscribed, and that is not a failure of the rule", async () => {
    await db.execute(
      sql`insert into email_suppression (id, email, reason) values ('s1', 'mario@rossi.it', 'unsubscribe')`,
    );

    await expect(send("{{contact.email}}", "x", "<p>ciao</p>")).resolves.toBe(0);
    expect(inviati).toEqual([]);
  });
});
