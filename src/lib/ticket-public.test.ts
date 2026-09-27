/**
 * The customer's side of a ticket, against a real Postgres: asked once, in their language,
 * under the conversation; a status page that shows only what they may see; an answer that
 * counts once and can be changed.
 */
import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";
import { tickets } from "@/db/schema";

import {
  ensurePublicToken,
  isPublicToken,
  loadStatusPage,
  rateTicket,
  replyFooterHtml,
  requestRating,
  setCsatEnabled,
  statusPageUrl,
} from "./ticket-public";

const db = drizzle(new PGlite());
const BASE = "https://crm.example";
const ask = (over: Record<string, unknown> = {}) =>
  requestRating(db as never, { ticketId: "t1", subdomain: "acme", base: BASE, ...over });

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  for (const t of ["email_job", "ticket_message", "ticket", "contact", "company", "workspace_setting"]) {
    await db.execute(sql.raw(`delete from "${t}"`));
  }
  await db.execute(sql`delete from "user"`);
  await db.execute(sql`insert into "user" (id, name, email) values ('anna', 'Anna', 'anna@firm.it')`);
  await db.execute(sql`insert into company (id, name, language) values ('c1', 'Acme', null)`);
  await db.execute(
    sql`insert into contact (id, first_name, last_name, email, company_id) values ('p1', 'Paolo', 'Verdi', 'paolo@example.com', 'c1')`,
  );
  await db.execute(
    sql`insert into ticket (id, ticket_number, subject, description, channel, status, contact_id, assignee_id)
        values ('t1', 'TKT-1', 'Stampante <b>ferma</b>', 'Non stampa', 'email', 'resolved', 'p1', 'anna')`,
  );
  await db.execute(
    sql`insert into ticket_message (id, ticket_id, content, channel, is_public, sender_id, email_message_id, created_at) values
        ('m1', 't1', '<p>Non stampa</p>', 'email', true, null, '<in-1@example.com>', now() - interval '2 hours'),
        ('m2', 't1', '<p>Cliente difficile</p>', 'email', false, 'anna', null, now() - interval '1 hour'),
        ('m3', 't1', '<p>Risolto, riprovi</p><script>x()</script>', 'email', true, 'anna', '<tkt-m3@crm.example>', now())`,
  );
  await setCsatEnabled(db as never, true);
});

const jobs = async () =>
  (await db.execute(sql`select * from email_job`)).rows as {
    subject: string;
    html_body: string;
    in_reply_to: string;
  }[];
const ticket = async () => (await db.select().from(tickets).where(eq(tickets.id, "t1")))[0];

describe("asking", () => {
  it("⚠️⚠️ nothing goes to a customer until the workspace switches it on", async () => {
    await setCsatEnabled(db as never, false);
    expect(await ask()).toBe("disabled");
    expect(await jobs()).toHaveLength(0);
  });

  it("⚠️⚠️ asks once, under the conversation, with both answers one click away", async () => {
    expect(await ask()).toBe("sent");
    const [job] = await jobs();
    const token = (await ticket()).publicToken as string;
    expect(isPublicToken(token)).toBe(true);
    // The number in the subject is what threads a reply back to the ticket.
    expect(job.subject).toBe("[TKT-1] Re: Stampante <b>ferma</b>");
    expect(job.in_reply_to).toBe("<tkt-m3@crm.example>");
    expect(job.html_body).toContain(`${BASE}/t/acme/${token}?rate=good`);
    expect(job.html_body).toContain(`${BASE}/t/acme/${token}?rate=bad`);
    // A subject is the customer's text too: in the body it is text, not markup.
    expect(job.html_body).toContain("Stampante &lt;b&gt;ferma&lt;/b&gt;");
    expect((await ticket()).csatRequestedAt).not.toBeNull();

    // Resolved again, from the board and the page at once: still one email.
    expect(await ask()).toBe("asked");
    expect(await jobs()).toHaveLength(1);
  });

  it("⚠️⚠️ two at once — the board and the page, both reading 'not asked yet' — still send one", async () => {
    // Neither sees the other's claim when it reads, so only the conditional write can decide.
    const results = await Promise.all([ask(), ask(), ask()]);
    expect(results.filter((r) => r === "sent")).toHaveLength(1);
    expect(await jobs()).toHaveLength(1);
  });

  it("⚠️ in the customer's language: their company's choice, otherwise Italian", async () => {
    await ask();
    expect((await jobs())[0].html_body).toContain("La tua richiesta è stata risolta");
    await db.execute(sql`delete from email_job`);
    await db.execute(sql`update ticket set csat_requested_at = null`);
    await db.execute(sql`update company set language = 'en'`);
    await ask();
    expect((await jobs())[0].html_body).toContain("Your request has been resolved");
  });

  it("⚠️ asks nobody without an address, and sends no links that point nowhere", async () => {
    expect(await ask({ base: null })).toBe("noLink");
    expect(await ask({ subdomain: null })).toBe("noLink");
    // Neither claimed the ask: it can still happen once the address exists.
    expect((await ticket()).csatRequestedAt).toBeNull();
    await db.execute(sql`update contact set email = null`);
    expect(await ask()).toBe("noEmail");
    expect(await jobs()).toHaveLength(0);
  });

  it("does not ask again once the customer has answered", async () => {
    await db.execute(sql`update ticket set csat_rating = 'good', csat_rated_at = now()`);
    expect(await ask()).toBe("rated");
  });
});

describe("the token", () => {
  it("is made once and kept", async () => {
    const a = await ensurePublicToken(db as never, "t1");
    const b = await ensurePublicToken(db as never, "t1");
    expect(a).toBe(b);
    expect(isPublicToken(a)).toBe(true);
    expect(await ensurePublicToken(db as never, "nope")).toBeNull();
  });

  it("⚠️ links are built from the public address, and the footer escapes what it prints", () => {
    expect(statusPageUrl(`${BASE}/`, "acme", "abc", "bad")).toBe(`${BASE}/t/acme/abc?rate=bad`);
    const html = replyFooterHtml("en", `${BASE}/t/acme/x"><script>`);
    expect(html).not.toContain("<script>");
    expect(html).toContain("Follow this request online: <a href=");
  });
});

describe("⚠️⚠️ the status page", () => {
  it("shows the public conversation only — never an internal note — sanitised", async () => {
    const token = (await ensurePublicToken(db as never, "t1")) as string;
    const page = await loadStatusPage(db as never, token);
    expect(page?.number).toBe("TKT-1");
    expect(page?.messages).toHaveLength(2);
    expect(page?.messages.map((m) => m.fromCustomer)).toEqual([true, false]);
    expect(page?.messages.some((m) => m.html.includes("Cliente difficile"))).toBe(false);
    expect(page?.messages[1].html).not.toContain("<script>");
    expect(page?.canRate).toBe(true);
  });

  it("⚠️ a token that is not one is refused before any query; an unknown one finds nothing", async () => {
    expect(await loadStatusPage(db as never, "' or 1=1 --")).toBeNull();
    expect(await loadStatusPage(db as never, "a".repeat(20))).toBeNull();
  });

  it("a ticket the customer wrote shows its description as the request, when there is no message yet", async () => {
    await db.execute(sql`delete from ticket_message`);
    await db.execute(sql`update ticket set status = 'open'`);
    const page = await loadStatusPage(db as never, (await ensurePublicToken(db as never, "t1")) as string);
    expect(page?.messages).toEqual([expect.objectContaining({ fromCustomer: true, html: "Non stampa" })]);
    expect(page?.canRate).toBe(false);
  });

  it("⚠️ a ticket typed in by an agent does not show the agent's summary to the customer", async () => {
    await db.execute(sql`delete from ticket_message`);
    await db.execute(sql`update ticket set channel = 'phone', description = 'Cliente difficile, gia'' lamentato'`);
    const page = await loadStatusPage(db as never, (await ensurePublicToken(db as never, "t1")) as string);
    expect(page?.messages).toEqual([]);
  });
});

describe("⚠️⚠️ answering", () => {
  it("records the answer, tells a change from a repeat, and keeps a comment given earlier", async () => {
    const token = await ensurePublicToken(db as never, "t1");
    const first = await rateTicket(db as never, { token, rating: "bad" });
    expect(first).toMatchObject({ ok: true, changed: true, notifyUserId: "anna", ticketNumber: "TKT-1" });
    // The page reloaded, or the comment sent after the click: not a new answer.
    const again = await rateTicket(db as never, { token, rating: "bad", comment: "  Ci hanno messo una settimana  " });
    expect(again).toMatchObject({ ok: true, changed: false });
    expect(await ticket()).toMatchObject({ csatRating: "bad", csatComment: "Ci hanno messo una settimana" });
    // Changing their mind keeps what they wrote.
    expect(await rateTicket(db as never, { token, rating: "good" })).toMatchObject({ changed: true });
    expect(await ticket()).toMatchObject({ csatRating: "good", csatComment: "Ci hanno messo una settimana" });
  });

  it("⚠️ only once it is resolved, only with a real answer and a real token", async () => {
    const token = await ensurePublicToken(db as never, "t1");
    await db.execute(sql`update ticket set status = 'open'`);
    expect(await rateTicket(db as never, { token, rating: "good" })).toEqual({ ok: false, reason: "notYet" });
    await db.execute(sql`update ticket set status = 'closed'`);
    expect(await rateTicket(db as never, { token, rating: "meh" })).toEqual({ ok: false, reason: "invalid" });
    expect(await rateTicket(db as never, { token: "x", rating: "good" })).toEqual({ ok: false, reason: "invalid" });
    expect(await rateTicket(db as never, { token: "b".repeat(20), rating: "good" })).toEqual({
      ok: false,
      reason: "notFound",
    });
    expect(await rateTicket(db as never, { token, rating: "good" })).toMatchObject({ ok: true });
  });
});
