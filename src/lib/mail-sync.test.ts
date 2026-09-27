/**
 * A connected mailbox end to end on a real Postgres (V3.2), with a provider that answers
 * what each test says: the stored grant (src/lib/mail-connection.ts), what the sync files and
 * forgets (src/lib/mail-sync.ts), sending as the person (src/lib/mailbox-send.ts), their busy
 * time in availability (src/lib/availability.ts) and appointments written into their calendar
 * (src/lib/appointment-mirror.ts).
 */
import { randomBytes } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";
import * as schema from "@/db/schema";

import type { MailProvider, SyncedMessage } from "./mail-providers/types";
import { ProviderError } from "./mail-providers/types";

const mock = vi.hoisted(() => ({
  provider: null as MailProvider | null,
  stopOnReply: [] as string[],
  writtenAt: [] as (Date | null)[],
}));
vi.mock("@/lib/mail-providers/registry", () => ({ providerFor: () => mock.provider }));
vi.mock("@/lib/sequence-runner", () => ({
  stopOnReply: async (_db: unknown, from: string, _now: Date, writtenAt?: Date) => {
    mock.stopOnReply.push(from);
    mock.writtenAt.push(writtenAt ?? null);
    return 0;
  },
}));

const { mirrorAppointment, mirrorAppointments } = await import("./appointment-mirror");
const { busyByUser } = await import("./availability");
const { accessTokenFor, disconnectMailbox, loadConnection, saveConnection } = await import("./mail-connection");
const { syncBudget, syncMailboxes } = await import("./mail-sync");
const { sendFromOwnMailbox } = await import("./mailbox-send");
const { decryptSecret } = await import("./tenant-db");

const db = drizzle(new PGlite(), { schema });
const NOW = new Date("2026-09-27T10:00:00Z");
const LATER = new Date("2026-09-27T12:00:00Z");
const ZONE = "Europe/Rome";
const WRITERS = async () => ["anna", "luca"];
let savedKey: string | undefined;

function fakeProvider(over: Partial<MailProvider> = {}) {
  const calls: { name: string; args: unknown[] }[] = [];
  const track =
    <A extends unknown[], R>(name: string, fn: (...a: A) => R) =>
    (...a: A) => {
      calls.push({ name, args: a });
      return fn(...a);
    };
  const p: MailProvider = {
    id: "google",
    scopes: [],
    authorizeUrl: () => "",
    exchangeCode: async () => ({ accessToken: "x", expiresAt: LATER, scopes: [] }),
    refresh: track("refresh", async () => ({
      accessToken: "fresh",
      refreshToken: "rotated",
      expiresAt: LATER,
      scopes: [],
    })),
    revoke: track("revoke", async () => undefined),
    mailbox: async () => ({ email: "anna@x.it" }),
    send: track("send", async () => ({ providerId: "p1", messageId: "sent-1@x.it", threadId: null })),
    startCursor: track("startCursor", async () => "fresh-cursor"),
    messagesSince: track("messagesSince", async (_t: string, cursor: string) => ({
      messages: [],
      cursor,
      more: false,
    })),
    busy: track("busy", async () => []),
    createEvent: track("createEvent", async () => "ev-1"),
    updateEvent: track("updateEvent", async () => undefined),
    deleteEvent: track("deleteEvent", async () => undefined),
    ...Object.fromEntries(
      Object.entries(over).map(([k, v]) => [
        k,
        typeof v === "function" ? track(k, v as (...a: unknown[]) => unknown) : v,
      ]),
    ),
  };
  mock.provider = p;
  return { p, calls, named: (n: string) => calls.filter((c) => c.name === n) };
}

const message = (over: Partial<SyncedMessage>): SyncedMessage => ({
  providerId: "m",
  messageId: "m@cliente.it",
  threadId: null,
  from: "mario@cliente.it",
  to: ["anna@x.it"],
  cc: [],
  subject: "Offerta",
  text: "Va bene così",
  date: new Date("2026-09-27T09:30:00Z"),
  ...over,
});

const connect = (over: { email?: string; expiresAt?: Date; refreshToken?: string; cursor?: string } = {}) =>
  saveConnection(
    db,
    {
      userId: "anna",
      provider: "google",
      email: over.email ?? "anna@x.it",
      tokens: {
        accessToken: "access-1",
        refreshToken: over.refreshToken ?? "refresh-1",
        expiresAt: over.expiresAt ?? LATER,
        scopes: ["email", "https://www.googleapis.com/auth/calendar.freebusy"],
      },
      cursor: over.cursor ?? "c0",
    },
    NOW,
  );
const connection = async () =>
  (await loadConnection(db, "anna")) as NonNullable<Awaited<ReturnType<typeof loadConnection>>>;
const activitiesOf = async () =>
  (
    await db.execute(
      sql`select contact_id, lead_id, owner_id, date::text as date, message_id, content from activity order by date`,
    )
  ).rows as {
    contact_id: string | null;
    lead_id: string | null;
    owner_id: string | null;
    date: string;
    message_id: string;
    content: string;
  }[];

beforeAll(async () => {
  savedKey = process.env.PLATFORM_ENCRYPTION_KEY;
  process.env.PLATFORM_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  await applyTenantMigrations(db as never);
}, 120_000);
afterAll(() => {
  process.env.PLATFORM_ENCRYPTION_KEY = savedKey;
});

beforeEach(async () => {
  mock.provider = null;
  mock.stopOnReply = [];
  mock.writtenAt = [];
  for (const t of [
    "appointment_mirror",
    "mail_busy",
    "mail_connection",
    "appointment",
    "activity",
    "lead",
    "contact",
    "user",
  ])
    await db.execute(sql.raw(`delete from "${t}"`));
  await db.execute(
    sql`insert into "user" (id, name, email) values ('anna', 'Anna', 'anna@x.it'), ('luca', 'Luca', 'luca@x.it')`,
  );
  await db.execute(
    sql`insert into contact (id, first_name, last_name, email) values ('mario', 'Mario', 'Rossi', 'Mario@Cliente.it')`,
  );
  await db.execute(sql`insert into lead (id, first_name, last_name, email, is_converted) values
    ('luigi', 'Luigi', 'Verdi', 'luigi@lead.it', false), ('old', 'Old', 'Lead', 'old@lead.it', true)`);
});

describe("⚠️⚠️ the stored grant", () => {
  it("keeps the tokens encrypted, never as they came", async () => {
    await connect();
    const row = (await db.execute(sql`select access_token, refresh_token from mail_connection`)).rows[0] as Record<
      string,
      string
    >;
    expect(row.access_token).not.toContain("access-1");
    expect(decryptSecret(row.access_token)).toBe("access-1");
    expect(decryptSecret(row.refresh_token)).toBe("refresh-1");
  });

  it("the same mailbox authorised again keeps where reading had got to; another one starts over", async () => {
    await connect({ cursor: "c0" });
    await db.execute(sql`update mail_connection set mail_cursor = 'c5'`);
    await connect({ cursor: "ignored" });
    expect(await connection()).toMatchObject({ mailCursor: "c5", status: "active", lastError: null });
    // ⚠️ Connected again after a revocation: from now, never the weeks in between.
    await db.execute(sql`update mail_connection set status = 'revoked'`);
    await connect({ cursor: "c-now" });
    expect(await connection()).toMatchObject({ mailCursor: "c-now", status: "active" });
    await connect({ email: "anna@other.it", cursor: "c-new" });
    expect(await connection()).toMatchObject({ email: "anna@other.it", mailCursor: "c-new" });
  });

  it("⚠️ refreshes a token that ran out, and keeps the refresh token Microsoft rotated", async () => {
    const { named } = fakeProvider();
    await connect({ expiresAt: NOW });
    expect(await accessTokenFor(db, await connection(), mock.provider as MailProvider, NOW)).toBe("fresh");
    expect(named("refresh")[0].args).toEqual(["refresh-1"]);
    const conn = await connection();
    expect(decryptSecret(conn.refreshToken as string)).toBe("rotated");
    expect(conn.expiresAt).toEqual(LATER);
    // Still good: no second refresh.
    expect(await accessTokenFor(db, conn, mock.provider as MailProvider, NOW)).toBe("fresh");
    expect(named("refresh")).toHaveLength(1);
  });

  it("⚠️⚠️ a refused refresh ends the connection, and says why", async () => {
    fakeProvider({
      refresh: async () => {
        throw new ProviderError("invalid_grant", 400);
      },
    });
    await connect({ expiresAt: NOW });
    expect(await accessTokenFor(db, await connection(), mock.provider as MailProvider, NOW)).toBeNull();
    expect(await connection()).toMatchObject({ status: "revoked", lastError: "invalid_grant" });
    // A passing outage is not a revocation.
    fakeProvider({
      refresh: async () => {
        throw new ProviderError("unavailable", 503);
      },
    });
    await db.execute(sql`update mail_connection set status = 'active'`);
    expect(await accessTokenFor(db, await connection(), mock.provider as MailProvider, NOW)).toBeNull();
    expect((await connection()).status).toBe("active");
  });

  it("disconnecting asks the provider to let go, and forgets everything it stood for", async () => {
    const { named } = fakeProvider();
    await connect();
    const conn = await connection();
    await db.execute(
      sql`insert into mail_busy (id, connection_id, user_id, start_at, end_at) values ('b', ${conn.id}, 'anna', now(), now())`,
    );
    expect(await disconnectMailbox(db, "anna", mock.provider)).toBe(true);
    expect(named("revoke")[0].args).toEqual(["refresh-1"]);
    expect((await db.execute(sql`select count(*)::int as n from mail_busy`)).rows[0]).toEqual({ n: 0 });
    expect(await loadConnection(db, "anna")).toBeNull();
  });
});

describe("⚠️⚠️ what the sync files", () => {
  it("mail with contacts and open leads, on their timelines — and nothing else", async () => {
    fakeProvider({
      messagesSince: async () => ({
        messages: [
          message({ messageId: "in-1", from: "mario@cliente.it" }),
          message({
            messageId: "out-1",
            from: "anna@x.it",
            to: ["luigi@lead.it"],
            date: new Date("2026-09-27T09:40:00Z"),
          }),
          message({ messageId: "private", from: "friend@gmail.com", to: ["anna@x.it"] }),
          message({ messageId: "converted", from: "old@lead.it" }),
        ],
        cursor: "c1",
        more: false,
      }),
    });
    await connect();
    const r = await syncMailboxes(db, { budget: syncBudget(), writers: WRITERS, now: NOW });
    expect(r).toMatchObject({ connections: 1, filed: 2 });
    const rows = await activitiesOf();
    expect(rows.map((a) => [a.message_id, a.contact_id, a.lead_id, a.owner_id])).toEqual([
      ["in-1", "mario", null, null],
      ["out-1", null, "luigi", "anna"],
    ]);
    // Dated when it was written, not when it was read.
    expect(rows[0].date).toBe("2026-09-27 09:30:00");
    expect(JSON.parse(rows[0].content)).toMatchObject({ direction: "in", subject: "Offerta" });
    expect(await connection()).toMatchObject({ mailCursor: "c1", mailSyncedAt: NOW });
  });

  it("⚠️ a reply in the person's own mailbox stops their sequences; their own sent mail does not", async () => {
    fakeProvider({
      messagesSince: async () => ({
        messages: [
          message({ from: "mario@cliente.it" }),
          message({ messageId: "o", from: "anna@x.it", to: ["mario@cliente.it"] }),
        ],
        cursor: "c1",
        more: false,
      }),
    });
    await connect();
    await syncMailboxes(db, { budget: syncBudget(), writers: WRITERS, now: NOW });
    expect(mock.stopOnReply).toEqual(["mario@cliente.it"]);
    // ⚠️ With the day it was written: an enrollment made after that is not what it answered.
    expect(mock.writtenAt).toEqual([new Date("2026-09-27T09:30:00Z")]);
  });

  it("⚠️ a message sent from the CRM and read back from Sent is one entry, not two", async () => {
    fakeProvider({
      messagesSince: async () => ({
        messages: [message({ messageId: "sent-1@x.it", from: "anna@x.it", to: ["mario@cliente.it"] })],
        cursor: "c1",
        more: false,
      }),
    });
    await connect();
    const sent = await sendFromOwnMailbox(db, "anna", {
      to: ["mario@cliente.it"],
      subject: "Offerta",
      html: "<p>x</p>",
    });
    expect(sent).toEqual({ used: true, ok: true, from: "anna@x.it", messageId: "sent-1@x.it" });
    // What sendEmailAction writes with the id the provider gave.
    await db.execute(sql`insert into activity (id, type, content, contact_id, owner_id, message_id) values
      ('a1', 'email', '{}', 'mario', 'anna', 'sent-1@x.it')`);
    await syncMailboxes(db, { budget: syncBudget(), writers: WRITERS, now: NOW });
    expect(await activitiesOf()).toHaveLength(1);
  });

  it("⚠️⚠️ one budget for the run: a mailbox that does not fit waits for the next, first in line", async () => {
    const { named } = fakeProvider();
    await connect();
    await db.execute(sql`insert into mail_connection (id, user_id, provider, email, access_token, expires_at, mail_synced_at)
      select 'c-luca', 'luca', 'google', 'luca@x.it', access_token, expires_at, '2026-09-27T09:00:00Z' from mail_connection`);
    await db.execute(sql`update mail_connection set mail_synced_at = '2026-09-27T09:30:00Z' where user_id = 'anna'`);
    // Enough for one mailbox and one message: the second waits.
    const r = await syncMailboxes(db, { budget: syncBudget(7), writers: WRITERS, now: NOW });
    expect(r).toMatchObject({ connections: 1, skipped: 1 });
    // Luca's was read longest ago, so Luca's went first.
    expect((await loadConnection(db, "luca"))?.mailSyncedAt).toEqual(NOW);
    expect((await connection()).mailSyncedAt).toEqual(new Date("2026-09-27T09:30:00Z"));
    expect(named("messagesSince")).toHaveLength(1);
  });

  it("⚠️ a mailbox that cannot afford one message is skipped whole, not half read", async () => {
    const { named } = fakeProvider();
    await connect();
    expect(await syncMailboxes(db, { budget: syncBudget(5), writers: WRITERS, now: NOW })).toMatchObject({
      connections: 0,
      skipped: 1,
    });
    expect(named("messagesSince")).toEqual([]);
  });

  it("⚠️ a cursor the provider forgot is taken again from now, not retried for ever", async () => {
    fakeProvider({
      messagesSince: async () => {
        throw new ProviderError("gone", 404, true);
      },
    });
    await connect();
    await syncMailboxes(db, { budget: syncBudget(), writers: WRITERS, now: NOW });
    expect(await connection()).toMatchObject({ mailCursor: "fresh-cursor", lastError: null });
  });

  it("a mailbox whose provider is switched off here, or whose grant was revoked, is left alone", async () => {
    await connect();
    mock.provider = null;
    expect(await syncMailboxes(db, { budget: syncBudget(), writers: WRITERS, now: NOW })).toMatchObject({
      connections: 0,
    });
    const { calls } = fakeProvider();
    await db.execute(sql`update mail_connection set status = 'revoked'`);
    await syncMailboxes(db, { budget: syncBudget(), writers: WRITERS, now: NOW });
    expect(calls).toEqual([]);
  });
});

describe("⚠️⚠️ security review, 27 September 2026", () => {
  it("⚠️⚠️ a mailbox whose owner may no longer write here is disconnected, not read", async () => {
    const { named } = fakeProvider();
    await connect();
    const r = await syncMailboxes(db, { budget: syncBudget(), writers: async () => ["luca"], now: NOW });
    expect(r).toMatchObject({ removed: 1, connections: 0 });
    expect(named("messagesSince")).toEqual([]);
    expect(named("revoke")).toHaveLength(1);
    expect(await loadConnection(db, "anna")).toBeNull();
  });

  it("⚠️ one message that cannot be filed does not stop the mailbox", async () => {
    fakeProvider({
      messagesSince: async () => ({
        messages: [
          // A Message-ID too long for the index: the insert fails every time.
          message({ messageId: "x".repeat(9000), from: "mario@cliente.it" }),
          message({ messageId: "ok-1", from: "mario@cliente.it" }),
        ],
        cursor: "c1",
        more: false,
      }),
    });
    await connect();
    await syncMailboxes(db, { budget: syncBudget(), writers: WRITERS, now: NOW });
    expect((await activitiesOf()).map((a) => a.message_id)).toContain("ok-1");
    expect((await connection()).mailCursor).toBe("c1");
  });

  it("⚠️ a token that will not decrypt is that mailbox's problem, not the workspace's", async () => {
    fakeProvider();
    await connect({ expiresAt: LATER });
    await db.execute(sql`insert into mail_connection (id, user_id, provider, email, access_token, expires_at, mail_synced_at)
      values ('broken', 'luca', 'google', 'luca@x.it', 'not-a-ciphertext', '2026-09-28T00:00:00Z', null)`);
    const r = await syncMailboxes(db, { budget: syncBudget(), writers: WRITERS, now: NOW });
    expect(r.connections).toBe(1);
    expect((await connection()).mailSyncedAt).toEqual(NOW);
  });

  it("⚠️⚠️ one workspace takes at most its share of the run's budget", async () => {
    // Two busy mailboxes, twenty messages each: well over one workspace's share between them.
    const twenty = Array.from({ length: 20 }, (_, i) =>
      message({ messageId: `busy-${i}`, from: `s${i}@elsewhere.it` }),
    );
    fakeProvider({ messagesSince: async () => ({ messages: twenty, cursor: "c1", more: true }) });
    await connect();
    await db.execute(sql`insert into mail_connection (id, user_id, provider, email, access_token, expires_at)
      select 'c-luca', 'luca', 'google', 'luca@x.it', access_token, expires_at from mail_connection`);
    const budget = syncBudget(1000);
    await syncMailboxes(db, { budget, writers: WRITERS, now: NOW });
    expect(1000 - budget.left).toBeLessThanOrEqual(120);
  });

  it("calendar access unticked at the consent screen: busy time is not asked for", async () => {
    const { named } = fakeProvider();
    await connect();
    await db.execute(sql`update mail_connection set scopes = 'email https://www.googleapis.com/auth/gmail.readonly'`);
    await syncMailboxes(db, { budget: syncBudget(), writers: WRITERS, now: NOW });
    expect(named("busy")).toEqual([]);
  });

  it("⚠️⚠️ only a refused grant ends a connection — not a wrong client secret", async () => {
    fakeProvider({
      refresh: async () => {
        throw new ProviderError('Google token answered 401: {"error": "invalid_client"}', 401);
      },
    });
    await connect({ expiresAt: NOW });
    expect(await accessTokenFor(db, await connection(), mock.provider as MailProvider, NOW)).toBeNull();
    expect((await connection()).status).toBe("active");
    fakeProvider({
      refresh: async () => {
        throw new ProviderError('Google token answered 400: {"error": "invalid_grant"}', 400);
      },
    });
    expect(await accessTokenFor(db, await connection(), mock.provider as MailProvider, NOW)).toBeNull();
    expect((await connection()).status).toBe("revoked");
  });

  it("⚠️⚠️ a passing failure to refresh fails the send, rather than sending from the workspace", async () => {
    fakeProvider({
      refresh: async () => {
        throw new ProviderError("unavailable", 503);
      },
    });
    await connect({ expiresAt: NOW });
    expect(
      await sendFromOwnMailbox(db, "anna", { to: ["a@b.it"], subject: "s", html: "h" }, { now: NOW }),
    ).toMatchObject({
      used: true,
      ok: false,
    });
  });

  it("⚠️ an event whose connection only blinked keeps its mirror row, so it is deleted later", async () => {
    fakeProvider({
      refresh: async () => {
        throw new ProviderError("unavailable", 503);
      },
    });
    await connect({ expiresAt: NOW });
    await db.execute(sql`insert into appointment_mirror (id, appointment_id, connection_id, external_id)
      select 'm', 'gone', id, 'ev-9' from mail_connection`);
    await mirrorAppointment(db, "gone", { zone: ZONE, now: NOW });
    expect((await db.execute(sql`select count(*)::int as n from appointment_mirror`)).rows[0]).toEqual({ n: 1 });
  });
});

describe("⚠️⚠️ busy time", () => {
  it("is replaced whole, read again only after a while, and counts in availability", async () => {
    const { named } = fakeProvider({
      busy: async () => [{ start: new Date("2026-09-28T08:00:00Z"), end: new Date("2026-09-28T09:00:00Z") }],
    });
    await connect();
    await syncMailboxes(db, { budget: syncBudget(), writers: WRITERS, now: NOW });
    await syncMailboxes(db, { budget: syncBudget(), writers: WRITERS, now: new Date(NOW.getTime() + 10 * 60_000) });
    expect(named("busy")).toHaveLength(1);

    const day = { start: new Date("2026-09-28T00:00:00Z"), end: new Date("2026-09-29T00:00:00Z") };
    expect((await busyByUser(db, ["anna", "luca"], day, ZONE)).anna).toEqual([
      { startAt: new Date("2026-09-28T08:00:00Z"), endAt: new Date("2026-09-28T09:00:00Z"), title: "" },
    ]);

    // Half an hour on, the calendar is read again and the old block is gone with the answer.
    mock.provider = { ...(mock.provider as MailProvider), busy: async () => [] };
    await syncMailboxes(db, { budget: syncBudget(), writers: WRITERS, now: new Date(NOW.getTime() + 31 * 60_000) });
    expect((await busyByUser(db, ["anna"], day, ZONE)).anna).toEqual([]);
  });

  it("an appointment mirrored there is not counted twice", async () => {
    await connect();
    const conn = await connection();
    await db.execute(sql`insert into appointment (id, title, start_at, end_at, ical_uid, organizer_id)
      values ('ap', 'Demo', '2026-09-28T08:00:00Z', '2026-09-28T09:00:00Z', 'ap@x', 'anna')`);
    await db.execute(sql`insert into mail_busy (id, connection_id, user_id, start_at, end_at)
      values ('b', ${conn.id}, 'anna', '2026-09-28T08:00:00Z', '2026-09-28T09:00:00Z')`);
    const day = { start: new Date("2026-09-28T00:00:00Z"), end: new Date("2026-09-29T00:00:00Z") };
    expect((await busyByUser(db, ["anna"], day, ZONE)).anna.map((b) => b.title)).toEqual(["Demo"]);
  });
});

describe("sending as the person", () => {
  it("not connected: the workspace sends, as before", async () => {
    expect(await sendFromOwnMailbox(db, "anna", { to: ["a@b.it"], subject: "s", html: "h" })).toEqual({ used: false });
  });

  it("⚠️ connected and failing: the send fails, rather than going out from somebody else's address", async () => {
    fakeProvider({
      send: async () => {
        throw new ProviderError("quota", 429);
      },
    });
    await connect();
    expect(await sendFromOwnMailbox(db, "anna", { to: ["a@b.it"], subject: "s", html: "h" })).toMatchObject({
      used: true,
      ok: false,
    });
  });
});

describe("⚠️⚠️ appointments in the organiser's calendar", () => {
  const appointment = (over = "") =>
    db.execute(
      sql.raw(`insert into appointment (id, title, start_at, end_at, ical_uid, organizer_id${over ? ", recurrence_rule" : ""})
      values ('ap', 'Demo', '2026-09-28T08:00:00Z', '2026-09-28T09:00:00Z', 'ap@x', 'anna'${over ? `, '${over}'` : ""})`),
    );
  const mirrors = async () => (await db.execute(sql`select appointment_id, external_id from appointment_mirror`)).rows;

  it("created, updated, and removed when cancelled", async () => {
    const { named } = fakeProvider();
    await connect();
    await appointment();
    expect(await mirrorAppointment(db, "ap", { zone: ZONE, now: NOW })).toBe("created");
    expect(named("createEvent")[0].args[1]).toMatchObject({ title: "Demo", allDay: false });
    expect(await mirrors()).toEqual([{ appointment_id: "ap", external_id: "ev-1" }]);

    await db.execute(sql`update appointment set title = 'Demo 2'`);
    expect(await mirrorAppointment(db, "ap", { zone: ZONE, now: NOW })).toBe("updated");
    expect(named("updateEvent")[0].args.slice(1, 3)).toEqual(["ev-1", expect.objectContaining({ title: "Demo 2" })]);

    await db.execute(sql`update appointment set status = 'cancelled'`);
    expect(await mirrorAppointment(db, "ap", { zone: ZONE, now: NOW })).toBe("deleted");
    expect(named("deleteEvent")[0].args[1]).toBe("ev-1");
    expect(await mirrors()).toEqual([]);
  });

  it("⚠️ deleted in the CRM: the event goes too, found by the mirror the appointment left behind", async () => {
    const { named } = fakeProvider();
    await connect();
    await appointment();
    await mirrorAppointments(db, ["ap"], { zone: ZONE, now: NOW });
    await db.execute(sql`delete from appointment where id = 'ap'`);
    // A later change elsewhere sweeps it up as well as the delete itself would.
    await mirrorAppointments(db, ["something-else"], { zone: ZONE, now: NOW });
    expect(named("deleteEvent")).toHaveLength(1);
    expect(await mirrors()).toEqual([]);
  });

  it("deleted at the provider by the person: written again, since the CRM still has it", async () => {
    const { named } = fakeProvider({
      updateEvent: async () => {
        throw new ProviderError("gone", 404);
      },
    });
    await connect();
    await appointment();
    await db.execute(sql`insert into appointment_mirror (id, appointment_id, connection_id, external_id)
      select 'm', 'ap', id, 'ev-old' from mail_connection`);
    expect(await mirrorAppointment(db, "ap", { zone: ZONE, now: NOW })).toBe("created");
    expect(named("createEvent")).toHaveLength(1);
    expect(await mirrors()).toEqual([{ appointment_id: "ap", external_id: "ev-1" }]);
  });

  it("⚠️ a repeating series is not mirrored, and an organiser with no mailbox is left alone", async () => {
    const { calls } = fakeProvider();
    await appointment("FREQ=WEEKLY");
    await connect();
    expect(await mirrorAppointment(db, "ap", { zone: ZONE, now: NOW })).toBe("skipped");
    await db.execute(sql`update appointment set recurrence_rule = null, organizer_id = 'luca'`);
    expect(await mirrorAppointment(db, "ap", { zone: ZONE, now: NOW })).toBe("skipped");
    expect(calls).toEqual([]);
  });

  it("⚠️ handed to a colleague: the event leaves the old organiser's calendar", async () => {
    const { named } = fakeProvider();
    await connect();
    await appointment();
    await mirrorAppointment(db, "ap", { zone: ZONE, now: NOW });
    await db.execute(sql`update appointment set organizer_id = 'luca'`);
    expect(await mirrorAppointment(db, "ap", { zone: ZONE, now: NOW })).toBe("skipped");
    expect(named("deleteEvent")[0].args[1]).toBe("ev-1");
    expect(await mirrors()).toEqual([]);
  });

  it("⚠️ two saves at once: one event stays, the other is taken back", async () => {
    let n = 0;
    const { named } = fakeProvider({
      // While this save talks to the provider, another one records its own event first.
      createEvent: async () => {
        n++;
        await db.execute(sql`insert into appointment_mirror (id, appointment_id, connection_id, external_id)
          select 'other', 'ap', id, 'ev-other' from mail_connection on conflict do nothing`);
        return `ev-${n}`;
      },
    });
    await connect();
    await appointment();
    await mirrorAppointment(db, "ap", { zone: ZONE, now: NOW });
    expect(await mirrors()).toEqual([{ appointment_id: "ap", external_id: "ev-other" }]);
    expect(named("deleteEvent")[0].args[1]).toBe("ev-1");
  });

  it("a provider that fails costs the appointment nothing: the connection says so", async () => {
    fakeProvider({
      createEvent: async () => {
        throw new ProviderError("quota", 429);
      },
    });
    await connect();
    await appointment();
    expect(await mirrorAppointment(db, "ap", { zone: ZONE, now: NOW })).toBe("skipped");
    expect((await connection()).lastError).toContain("quota");
  });
});
