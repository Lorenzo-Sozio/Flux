/**
 * The dashboard's CSV import, against a real Postgres.
 *
 * ⚠️⚠️ What it replaced wrote row by row — two to four statements each, up to 5,000 rows,
 * against a Worker budget of a thousand subrequests — so a file of a few hundred rows
 * stopped halfway. It matched companies on the exact name, so "ACME S.r.l." next to
 * "Acme S.r.l." became two companies. And the lead import had no route at all.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";

import { planCsvImport, rowToInput } from "./csv-import";

const pg = drizzle(new PGlite());

/** The same database, counting every statement the import issues. */
let statements = 0;
const db = new Proxy(pg, {
  get(target, prop, receiver) {
    if (prop === "select" || prop === "insert") statements++;
    return Reflect.get(target, prop, receiver);
  },
}) as unknown as typeof pg;

beforeAll(async () => {
  await applyTenantMigrations(pg as never);
}, 120_000);

beforeEach(async () => {
  statements = 0;
  await pg.execute(sql`delete from contact`);
  await pg.execute(sql`delete from lead`);
  await pg.execute(sql`delete from company`);
  await pg.execute(sql`delete from "user"`);
  await pg.execute(sql`insert into "user" (id, name, email) values ('u1', 'Giulia', 'giulia@studio.it')`);
});

async function rows<T>(q: ReturnType<typeof sql>): Promise<T[]> {
  return (await pg.execute(q)).rows as T[];
}

describe("reading a row", () => {
  it("understands Flux's own export, snake_case and Italian headers alike", () => {
    expect(rowToInput("contacts", { firstName: "Anna", last_name: "Bianchi", "E-mail": "A@X.IT" })).toEqual({
      firstName: "Anna",
      lastName: "Bianchi",
      email: "A@X.IT",
    });
    expect(rowToInput("contacts", { Nome: "Mario", Cognome: "Rossi", Città: "Milano", Azienda: "Rossi Srl" })).toEqual({
      firstName: "Mario",
      lastName: "Rossi",
      city: "Milano",
      company: "Rossi Srl",
    });
  });

  it("reads yes/sì as consent, splits tags, and drops empty cells instead of calling them invalid", () => {
    expect(
      rowToInput("leads", {
        firstName: "A",
        email: "",
        marketingConsent: "sì",
        tags: "fiera; web,caldo",
        status: "QUALIFIED",
      }),
    ).toEqual({ firstName: "A", marketingConsent: true, tags: ["fiera", "web", "caldo"], status: "qualified" });
    expect(rowToInput("contacts", { marketingConsent: "no" })).toEqual({ marketingConsent: false });
  });

  it("ignores columns it does not know, such as the id of an exported row", () => {
    expect(rowToInput("companies", { id: "x", name: "Acme", createdAt: "2026-01-01" })).toEqual({ name: "Acme" });
  });
});

describe("⚠️⚠️ contacts", () => {
  it("skips a duplicate email, in the table or earlier in the same file, ignoring case", async () => {
    await pg.execute(
      sql`insert into contact (id, first_name, last_name, email) values ('c0', 'Già', 'Qui', 'gia@x.it')`,
    );

    const plan = await planCsvImport(
      db as never,
      "contacts",
      [
        { firstName: "A", lastName: "Uno", email: "GIA@x.it" },
        { firstName: "B", lastName: "Due", email: "nuovo@x.it" },
        { firstName: "C", lastName: "Tre", email: "Nuovo@X.it" },
      ],
      "u1",
    );
    await plan.write();

    expect(plan.newRecords).toBe(1);
    expect(plan.duplicates).toEqual(["gia@x.it", "nuovo@x.it"]);
    expect((await rows<{ n: number }>(sql`select count(*)::int as n from contact`))[0].n).toBe(2);
  });

  it("finds the company whatever its capitals, and creates a new one once for all its people", async () => {
    await pg.execute(sql`insert into company (id, name) values ('acme', 'Acme S.r.l.')`);

    const plan = await planCsvImport(
      db as never,
      "contacts",
      [
        { firstName: "A", lastName: "Uno", company: "ACME S.R.L." },
        { firstName: "B", lastName: "Due", company: "Beta Spa" },
        { firstName: "C", lastName: "Tre", company: "beta spa" },
      ],
      "u1",
    );
    await plan.write();

    const people = await rows<{ last_name: string; company_id: string }>(
      sql`select last_name, company_id from contact order by last_name`,
    );
    const companies = await rows<{ id: string; name: string }>(sql`select id, name from company order by name`);
    expect(companies.map((c) => c.name)).toEqual(["Acme S.r.l.", "Beta Spa"]);
    const beta = companies.find((c) => c.name === "Beta Spa")?.id;
    expect(people).toEqual([
      { last_name: "Due", company_id: beta },
      { last_name: "Tre", company_id: beta },
      { last_name: "Uno", company_id: "acme" },
    ]);
    // Two contacts' worth of new records plus the one new company: what the plan limit sees.
    expect(plan.newRecords).toBe(4);
  });

  it("reports a rejected row by the line a spreadsheet shows, and imports the rest", async () => {
    const plan = await planCsvImport(
      db as never,
      "contacts",
      [
        { firstName: "A", lastName: "Uno" },
        { firstName: "B", email: "non-una-email" },
      ],
      "u1",
    );

    expect(plan.newRecords).toBe(1);
    expect(plan.errors).toHaveLength(1);
    expect(plan.errors[0].line).toBe(3);
    expect(plan.errors[0].errors.map((e) => e.field).sort()).toEqual(["email", "lastName"]);
  });

  it("⚠️⚠️ imports five thousand rows in a bounded number of statements", async () => {
    const file = Array.from({ length: 5_000 }, (_, i) => ({
      firstName: `N${i}`,
      lastName: `C${i}`,
      email: `p${i}@x.it`,
      company: `Azienda ${i % 40}`,
    }));

    const plan = await planCsvImport(db as never, "contacts", file, "u1");
    await plan.write();

    expect((await rows<{ n: number }>(sql`select count(*)::int as n from contact`))[0].n).toBe(5_000);
    // 10 email lookups + 1 company lookup + 1 company insert + 25 contact inserts.
    expect(statements).toBeLessThan(50);
  }, 60_000);
});

describe("leads", () => {
  it("are imported, with the source marked as an import", async () => {
    const plan = await planCsvImport(
      db as never,
      "leads",
      [
        { Nome: "Luca", Cognome: "Verdi", Email: "luca@x.it", Stato: "qualified" },
        { Nome: "Sara", Email: "LUCA@x.it" },
      ],
      "u1",
    );
    await plan.write();

    expect(plan.newRecords).toBe(1);
    const saved = await rows<{ first_name: string; status: string; source: string; owner_id: string }>(
      sql`select first_name, status, source, owner_id from lead`,
    );
    expect(saved).toEqual([{ first_name: "Luca", status: "qualified", source: "import", owner_id: "u1" }]);
  });
});

describe("companies", () => {
  it("dedupe on the name ignoring case, and treat % as a character", async () => {
    await pg.execute(sql`insert into company (id, name) values ('a', 'Alfa Srl')`);

    const plan = await planCsvImport(
      db as never,
      "companies",
      [{ name: "ALFA SRL" }, { name: "%" }, { name: "Gamma" }],
      "u1",
    );
    await plan.write();

    expect(plan.duplicates).toEqual(["ALFA SRL"]);
    const names = (await rows<{ name: string }>(sql`select name from company order by name`)).map((r) => r.name);
    expect(names).toEqual(["%", "Alfa Srl", "Gamma"]);
  });
});
