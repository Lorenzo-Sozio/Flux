/**
 * An email from somebody a salesperson owns reaches that salesperson — against a real
 * Postgres, through processInboundEmail.
 *
 * ⚠️⚠️ Every inbound email naming no ticket opened a support ticket, a prospect answering
 * their quote included: it sat in the support queue, a stub contact appeared beside the
 * lead who wrote it, and the person waiting for the answer never saw it.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";
import * as schema from "@/db/schema";

import { inboundEmailConfigured, replyTaskTitle, replyToFor } from "./inbound-sales-reply";

// With the schema: the ticket path reads through `db.query`.
const db = drizzle(new PGlite(), { schema });
const notified: { userId: string; type: string; key?: string; params?: Record<string, unknown> }[] = [];
let sequencesStopped = 0;

vi.mock("@/lib/tenant-resolve", () => ({
  resolveTenantByProbe: async (_key: string, probe: (d: unknown, t: unknown) => Promise<boolean>) =>
    (await probe(db, { id: "t1" })) ? { db, tenant: { id: "t1" } } : null,
}));
vi.mock("@/lib/tenant-context", () => ({ runWithTenant: (_id: string, fn: () => unknown) => fn() }));
vi.mock("@/lib/notify", () => ({
  notify: async (n: (typeof notified)[number]) => {
    notified.push(n);
  },
}));
vi.mock("@/lib/sequence-runner", () => ({ stopOnReply: async () => sequencesStopped }));
vi.mock("@/lib/schema-ready", () => ({ tolerateUnmigrated: (_f: string, fn: () => unknown) => fn() }));
vi.mock("@/components/crm/automation/rule-engine", () => ({ runAutomations: async () => undefined }));
vi.mock("next/server", () => ({ after: () => undefined }));

const { processInboundEmail } = await import("./ticket-from-email");

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  notified.length = 0;
  sequencesStopped = 0;
  for (const t of ["ticket_message", "ticket", "task", "activity", "contact", "lead", "company", "email_settings"]) {
    await db.execute(sql.raw(`delete from "${t}"`));
  }
  await db.execute(sql`delete from "user"`);
  await db.execute(sql`insert into "user" (id, name, email) values ('anna', 'Anna', 'anna@firm.it')`);
  await db.execute(sql`insert into email_settings (id, from_email) values ('es1', 'info@firm.it')`);
});

function mail(from: string, subject = "Re: Preventivo") {
  return processInboundEmail({
    fromRaw: from,
    to: "info@firm.it",
    subject,
    htmlBody: "",
    textBody: "Va bene, procediamo.",
    inboundMessageId: "<m1@x>",
    inReplyTo: null,
  });
}

async function count(table: string) {
  const [{ n }] = (await db.execute(sql.raw(`select count(*)::int as n from "${table}"`))).rows as { n: number }[];
  return n;
}

describe("⚠️⚠️ a reply from somebody a salesperson owns", () => {
  it("goes on the contact's timeline and becomes the owner's task, not a ticket", async () => {
    // Typed with capitals on the record: the match ignores case on both sides.
    await db.execute(
      sql`insert into contact (id, first_name, last_name, email, owner_id) values ('c1', 'Mario', 'Rossi', 'Mario@Rossi.it', 'anna')`,
    );

    const result = await mail("Mario Rossi <Mario@Rossi.it>");

    expect(result).toMatchObject({ ok: true, action: "sales_reply" });
    expect(await count("ticket")).toBe(0);
    // No stub contact beside the one who wrote.
    expect(await count("contact")).toBe(1);

    const [activity] = (await db.execute(sql`select type, content, contact_id, owner_id from activity`)).rows as {
      type: string;
      content: string;
      contact_id: string;
      owner_id: string | null;
    }[];
    expect(activity).toMatchObject({ type: "email", contact_id: "c1", owner_id: null });
    expect(JSON.parse(activity.content)).toMatchObject({
      _type: "email_v2",
      from: "mario@rossi.it",
      subject: "Re: Preventivo",
      bodyText: "Va bene, procediamo.",
    });

    const tasks = (await db.execute(sql`select title, type, owner_id, assignee_id, contact_id, status from task`)).rows;
    expect(tasks).toEqual([
      {
        title: "↩ Mario Rossi: Re: Preventivo",
        type: "email",
        owner_id: "anna",
        assignee_id: "anna",
        contact_id: "c1",
        status: "todo",
      },
    ]);
    expect(notified).toEqual([expect.objectContaining({ userId: "anna", type: "email_reply", key: "emailReply" })]);
  });

  it("a contact nobody owns goes to whoever owns its company", async () => {
    await db.execute(sql`insert into company (id, name, owner_id) values ('co1', 'Rossi Srl', 'anna')`);
    await db.execute(
      sql`insert into contact (id, first_name, last_name, email, company_id) values ('c1', 'Mario', 'Rossi', 'mario@rossi.it', 'co1')`,
    );

    expect(await mail("mario@rossi.it")).toMatchObject({ action: "sales_reply" });
    const [task] = (await db.execute(sql`select owner_id, company_id from task`)).rows;
    expect(task).toEqual({ owner_id: "anna", company_id: "co1" });
  });

  it("a lead that has not been converted is the lead's owner's", async () => {
    await db.execute(
      sql`insert into lead (id, first_name, last_name, email, owner_id) values ('l1', 'Giulia', 'Bianchi', 'giulia@b.it', 'anna')`,
    );

    expect(await mail("giulia@b.it")).toMatchObject({ action: "sales_reply" });
    const [activity] = (await db.execute(sql`select lead_id from activity`)).rows;
    expect(activity).toEqual({ lead_id: "l1" });
  });

  it("⚠️ once is enough: a reply that already stopped a sequence does not notify twice", async () => {
    sequencesStopped = 1;
    await db.execute(
      sql`insert into contact (id, first_name, last_name, email, owner_id) values ('c1', 'Mario', 'Rossi', 'mario@rossi.it', 'anna')`,
    );

    await mail("mario@rossi.it");

    expect(notified).toEqual([]);
    expect(await count("task")).toBe(1);
  });
});

describe("what stays with support", () => {
  it("a sender nobody owns opens a ticket, as before", async () => {
    await db.execute(
      sql`insert into contact (id, first_name, last_name, email) values ('c1', 'Mario', 'Rossi', 'mario@rossi.it')`,
    );

    expect(await mail("mario@rossi.it")).toMatchObject({ action: "ticket_created" });
    expect(await count("task")).toBe(0);
  });

  it("an unknown sender opens a ticket and gets a contact, as before", async () => {
    expect(await mail("Chi Sono <nuovo@x.it>")).toMatchObject({ action: "ticket_created" });
    expect(await count("contact")).toBe(1);
  });

  it("a converted lead is not routed as a lead", async () => {
    await db.execute(
      sql`insert into lead (id, first_name, last_name, email, owner_id, is_converted) values ('l1', 'Giulia', 'Bianchi', 'giulia@b.it', 'anna', true)`,
    );

    expect(await mail("giulia@b.it")).toMatchObject({ action: "ticket_created" });
  });

  it("⚠️ a reply to a ticket stays on the ticket, even from somebody a salesperson owns", async () => {
    await db.execute(
      sql`insert into contact (id, first_name, last_name, email, owner_id) values ('c1', 'Mario', 'Rossi', 'mario@rossi.it', 'anna')`,
    );
    await db.execute(
      sql`insert into ticket (id, ticket_number, subject, status, channel, priority) values ('tk1', 'TKT-202609-ABCDEF', 'Guasto', 'open', 'email', 'normal')`,
    );

    const result = await mail("mario@rossi.it", "Re: [TKT-202609-ABCDEF] Guasto");

    expect(result).toMatchObject({ action: "message_appended", ticketId: "tk1" });
    expect(await count("task")).toBe(0);
  });
});

describe("Reply-To on an email sent from a record", () => {
  it("is the writer's own address only when replies cannot come back to Flux", () => {
    expect(replyToFor(false, "anna@firm.it")).toBe("anna@firm.it");
    expect(replyToFor(true, "anna@firm.it")).toBeUndefined();
    expect(replyToFor(false, null)).toBeUndefined();
  });

  it("knows whether inbound email is configured", () => {
    expect(inboundEmailConfigured({})).toBe(false);
    expect(inboundEmailConfigured({ INBOUND_EMAIL_SECRET: "x" })).toBe(true);
    expect(inboundEmailConfigured({ RESEND_INBOUND_WEBHOOK_SECRET: "x" })).toBe(true);
  });

  it("titles the task with a mark, not a sentence in one language", () => {
    expect(replyTaskTitle("Mario", "x".repeat(300))).toHaveLength(200);
  });
});
