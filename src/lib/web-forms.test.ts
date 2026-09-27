/**
 * The public forms, against a real Postgres: what a submission becomes, and what it never
 * becomes — a duplicate, a consent nobody gave, markup in a ticket.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";
import { tickets } from "@/db/schema";

vi.mock("next/server", () => ({ after: () => undefined }));

const { verifyTurnstile } = await import("./turnstile");
const { ensureWebForms, readLeadSubmission, readTicketSubmission, submitLeadForm, submitTicketForm } = await import(
  "./web-forms"
);

const db = drizzle(new PGlite());
type Form = Awaited<ReturnType<typeof ensureWebForms>>[number];
let leadForm: Form;

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  for (const t of ["ticket_message", "ticket", "activity", "contact", "lead", "web_form"]) {
    await db.execute(sql.raw(`delete from "${t}"`));
  }
  await db.execute(sql`delete from "user"`);
  await db.execute(sql`insert into "user" (id, name, email) values ('anna', 'Anna', 'anna@firm.it')`);
  const forms = await ensureWebForms(db);
  await db.execute(sql`update web_form set enabled = true, owner_id = 'anna' where kind = 'lead'`);
  leadForm = { ...(forms.find((f) => f.kind === "lead") as Form), enabled: true, ownerId: "anna" };
});

async function rows(table: string) {
  return (await db.execute(sql.raw(`select * from "${table}"`))).rows as Record<string, unknown>[];
}

const submission = (over: Record<string, unknown> = {}) => {
  const s = readLeadSubmission({
    name: "Elena Galli",
    email: "Elena@Example.com",
    message: "Vorrei un preventivo",
    ...over,
  });
  if (!s) throw new Error("submission");
  return s;
};

describe("reading a submission", () => {
  it("needs a name and a real address; a ticket also a subject and a description", () => {
    expect(readLeadSubmission({ name: "", email: "a@b.it" })).toBeNull();
    expect(readLeadSubmission({ name: "A", email: "nope" })).toBeNull();
    expect(readLeadSubmission({ name: "A", email: "A@B.IT" })?.email).toBe("a@b.it");
    expect(readTicketSubmission({ name: "A", email: "a@b.it", subject: "x" })).toBeNull();
    expect(readLeadSubmission({ name: "A", email: "a@b.it", consent: "on" })?.consent).toBe(true);
    expect(readLeadSubmission({ name: "A", email: "a@b.it", consent: "yes please" })?.consent).toBe(false);
  });

  it("⚠️ Turnstile: checked when configured, not a wall when it is not", async () => {
    const answering = (success: boolean) => (async () => ({ json: async () => ({ success }) })) as never;
    expect(await verifyTurnstile(null, null, {})).toBe(true);
    expect(await verifyTurnstile(null, null, { TURNSTILE_SECRET_KEY: "s" }, answering(true))).toBe(false);
    expect(await verifyTurnstile("t", null, { TURNSTILE_SECRET_KEY: "s" }, answering(false))).toBe(false);
    expect(await verifyTurnstile("t", null, { TURNSTILE_SECRET_KEY: "s" }, answering(true))).toBe(true);
  });
});

describe("⚠️⚠️ the contact form", () => {
  it("files a new lead for the form's owner, with the message, and no consent nobody gave", async () => {
    const result = await submitLeadForm(db, leadForm, submission(), "🌐");
    expect(result).toMatchObject({ kind: "created", ownerId: "anna" });
    const [lead] = await rows("lead");
    expect(lead).toMatchObject({
      first_name: "Elena",
      last_name: "Galli",
      email: "elena@example.com",
      source: "web_form",
      owner_id: "anna",
      marketing_consent: false,
      consent_source: null,
    });
    const [note] = await rows("activity");
    expect(note).toMatchObject({ type: "note", lead_id: lead.id, owner_id: null });
    expect(String(note.content)).toContain("Vorrei un preventivo");
  });

  it("⚠️ a ticked consent is recorded as given through the web form, dated", async () => {
    await submitLeadForm(db, leadForm, submission({ consent: true }), "🌐");
    const [lead] = await rows("lead");
    expect(lead).toMatchObject({ marketing_consent: true, consent_source: "web" });
    expect(lead.consent_date).not.toBeNull();
  });

  it("⚠️⚠️ somebody already known gets the message on their record — not a second record", async () => {
    await db.execute(
      sql`insert into contact (id, first_name, last_name, email, owner_id) values ('c1', 'Elena', 'Galli', 'ELENA@example.com', null)`,
    );
    const result = await submitLeadForm(db, leadForm, submission(), "🌐");
    expect(result).toMatchObject({ kind: "known", contactId: "c1", ownerId: "anna" });
    expect(await rows("lead")).toEqual([]);
    expect((await rows("activity"))[0]).toMatchObject({ contact_id: "c1" });
  });

  it("an open lead with that address, likewise", async () => {
    await db.execute(
      sql`insert into lead (id, first_name, last_name, email) values ('l1', 'Elena', 'G', 'elena@example.com')`,
    );
    expect(await submitLeadForm(db, leadForm, submission(), "🌐")).toMatchObject({ kind: "known", leadId: "l1" });
    expect(await rows("lead")).toHaveLength(1);
  });
});

describe("⚠️⚠️ the support form", () => {
  it("opens a numbered ticket on the web channel, for a contact found or created", async () => {
    const s = readTicketSubmission({
      name: "Paolo Verdi",
      email: "paolo@example.com",
      subject: "Non accedo",
      description: "Dopo l'aggiornamento",
    });
    if (!s) throw new Error("ticket");
    const result = await submitTicketForm(db, s);
    expect(result.ticketNumber).toMatch(/^TKT-/);
    expect((await rows("ticket"))[0]).toMatchObject({ channel: "web", status: "new", contact_id: result.contactId });
    expect((await rows("contact"))[0]).toMatchObject({ email: "paolo@example.com", source: "web_form" });
    // The same person again: the same contact.
    const again = await submitTicketForm(db, { ...s, subject: "Ancora" });
    expect(again.contactId).toBe(result.contactId);
    expect(await rows("contact")).toHaveLength(1);
  });

  it("⚠️⚠️ a request from the site carries the SLA for its priority, like one typed in", async () => {
    await db.execute(sql`delete from sla`);
    await db.execute(
      sql`insert into sla (id, name, priority, first_response_time_minutes, resolution_time_minutes) values ('std', 'Standard', 'normal', 60, 480)`,
    );
    const s = readTicketSubmission({ name: "P", email: "p@example.com", subject: "S", description: "D" });
    if (!s) throw new Error("ticket");
    const before = Date.now();
    await submitTicketForm(db, s);
    const [ticket] = await db
      .select({ slaId: tickets.slaId, due: tickets.firstResponseDueAt, deadline: tickets.slaDeadlineAt })
      .from(tickets);
    expect(ticket.slaId).toBe("std");
    // Sixty wall-clock minutes from arrival, give or take the test's own run time.
    expect(Math.abs((ticket.due?.getTime() ?? 0) - before - 60 * 60_000)).toBeLessThan(60_000);
    expect(Math.abs((ticket.deadline?.getTime() ?? 0) - before - 480 * 60_000)).toBeLessThan(60_000);
    await db.execute(sql`delete from sla`);
  });

  it("⚠️⚠️ what a stranger typed reaches the agent's screen as text, not as markup", async () => {
    const s = readTicketSubmission({
      name: "X",
      email: "x@example.com",
      subject: "Hi",
      description: `<img src=x onerror="alert(1)"><script>steal()</script>`,
    });
    if (!s) throw new Error("ticket");
    await submitTicketForm(db, s);
    const [message] = await rows("ticket_message");
    expect(String(message.content)).not.toContain("<script>");
    expect(String(message.content)).not.toContain("<img");
    expect(String(message.content)).toContain("&lt;script&gt;");
  });
});
