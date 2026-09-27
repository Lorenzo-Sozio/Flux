/**
 * The morning digest, against a real Postgres.
 *
 * ⚠️⚠️ It replaces one email per task due today — no summary, no way to turn it off. So it
 * has to say everything once, in the reader's language, to the people who want it, and
 * only once a day however often the job runs.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";

import { countOpenDealsWithoutNextStep } from "./deal-signals";
import { collectDigests, DIGEST_TEXT, digestEmail, rememberLocale, sendMorningDigests } from "./morning-digest";

const db = drizzle(new PGlite());
const TZ = "Europe/Rome";
const DAY = 86_400_000;

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  for (const t of ["notification_preference", "task", "quote", "deal", "company"]) {
    await db.execute(sql.raw(`delete from "${t}"`));
  }
  await db.execute(sql`delete from "user"`);
  await db.execute(sql`
    insert into "user" (id, name, email) values
      ('anna', 'Anna', 'anna@x.it'), ('luca', 'Luca', 'luca@x.it'), ('ex', 'Ex', 'ex@x.it')`);
});

async function task(
  id: string,
  person: string,
  due: Date | null,
  extra: { title?: string; type?: string; status?: string } = {},
) {
  await db.execute(sql`
    insert into task (id, title, type, status, assignee_id, due_date)
    values (${id}, ${extra.title ?? id}, ${extra.type ?? "todo"}, ${extra.status ?? "todo"}, ${person}, ${due})`);
}

describe("⚠️⚠️ what each person has waiting", () => {
  it("today's tasks by title, late ones counted, replies owed apart, deals and quotes per owner", async () => {
    const now = new Date();
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 0, 0, 0);
    await task("today", "anna", now);
    await task("late", "anna", new Date(Date.now() - 3 * DAY));
    await task("done", "anna", now, { status: "done" });
    await task("reply", "anna", now, { type: "email", title: "↩ Mario: Re: Preventivo" });
    await task("tomorrow", "anna", new Date(Date.now() + 3 * DAY));
    await task("lucas", "luca", now);
    await db.execute(sql`insert into company (id, name) values ('c1', 'Rossi')`);
    await db.execute(
      sql`insert into deal (id, name, owner_id, status) values ('d1', 'Nuda', 'anna', 'open'), ('d2', 'Vinta', 'anna', 'won')`,
    );
    await db.execute(sql`
      insert into quote (id, quote_number, deal_id, company_id, owner_id, status, subtotal, total_amount)
      values ('q1', 'Q-1', 'd2', 'c1', 'anna', 'accepted', '1', '1')`);

    const digests = await collectDigests(db as never, ["anna", "luca"], TZ, now);

    expect(digests.get("anna")).toEqual({
      dueToday: ["today"],
      overdue: 1,
      dealsWithoutStep: 1,
      repliesDue: 1,
      quotesToOrder: 1,
    });
    expect(digests.get("luca")?.dueToday).toEqual(["lucas"]);
    expect(await countOpenDealsWithoutNextStep(db as never, "anna")).toBe(1);
  });
});

describe("the email", () => {
  const full = { dueToday: ["Chiamare <Rossi>"], overdue: 2, dealsWithoutStep: 0, repliesDue: 1, quotesToOrder: 0 };

  it("says nothing when there is nothing to say", () => {
    expect(
      digestEmail(
        { dueToday: [], overdue: 0, dealsWithoutStep: 0, repliesDue: 0, quotesToOrder: 0 },
        { name: "A", locale: "it", appUrl: "https://x" },
      ),
    ).toBeNull();
  });

  it("counts everything in its subject, escapes what people typed, and links home", () => {
    const mail = digestEmail(full, { name: "Anna", locale: "it", appUrl: "https://crm.example.it" });
    expect(mail?.subject).toBe("Buongiorno: 4 cose per oggi");
    expect(mail?.html).toContain("Chiamare &lt;Rossi&gt;");
    expect(mail?.html).not.toContain("<Rossi>");
    expect(mail?.html).toContain("https://crm.example.it/dashboard/crm");
  });

  it("is written in English for whoever reads the product in English", () => {
    expect(digestEmail(full, { name: "Anna", locale: "en", appUrl: "https://x" })?.subject).toBe(
      "Good morning: 4 things for today",
    );
  });

  it("has every sentence in both languages", () => {
    expect(Object.keys(DIGEST_TEXT.en).sort()).toEqual(Object.keys(DIGEST_TEXT.it).sort());
  });
});

describe("⚠️⚠️ sending", () => {
  const sent: { to: string; subject: string }[] = [];
  const send = async (to: string, subject: string) => {
    sent.push({ to, subject });
  };
  beforeEach(() => {
    sent.length = 0;
  });

  it("once a day, however many times the job runs", async () => {
    await task("t1", "anna", new Date());
    const opts = { members: ["anna"], timeZone: TZ, appUrl: "https://x", send };

    expect(await sendMorningDigests(db as never, opts)).toBe(1);
    expect(await sendMorningDigests(db as never, opts)).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it("⚠️ once, even when two runs start together", async () => {
    await task("t1", "anna", new Date());
    const opts = { members: ["anna"], timeZone: TZ, appUrl: "https://x", send };

    const [a, b] = await Promise.all([sendMorningDigests(db as never, opts), sendMorningDigests(db as never, opts)]);

    expect(a + b).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it("⚠️ only to members, only to those who want it, only with something to say", async () => {
    await task("t1", "anna", new Date());
    await task("t2", "luca", new Date());
    await task("t3", "ex", new Date());
    await db.execute(sql`insert into notification_preference (user_id, digest_email) values ('luca', false)`);

    await sendMorningDigests(db as never, { members: ["anna", "luca"], timeZone: TZ, appUrl: "https://x", send });

    expect(sent.map((s) => s.to)).toEqual(["anna@x.it"]);
  });

  it("in the language the person last used", async () => {
    await task("t1", "anna", new Date());
    await rememberLocale(db as never, "anna", "en");

    await sendMorningDigests(db as never, { members: ["anna"], timeZone: TZ, appUrl: "https://x", send });

    expect(sent[0].subject).toMatch(/^Good morning/);
  });

  it("remembers a language only when it is one the product speaks", async () => {
    await rememberLocale(db as never, "anna", "de");
    expect((await db.execute(sql`select count(*)::int as n from notification_preference`)).rows[0]).toEqual({ n: 0 });
  });
});
