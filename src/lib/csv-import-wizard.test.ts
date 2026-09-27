/**
 * The import wizard: the columns the person mapped, and what happens to a row that is
 * already in the CRM — against a real Postgres.
 *
 * ⚠️⚠️ The import accepted only headers it could guess, had no preview, and skipped every
 * duplicate: a file exported to refresh phone numbers left every existing contact exactly
 * as it was, and said "skipped" without saying why.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";

import { planCsvImport, rowToInput } from "./csv-import";
import { ALIASES, applyMapping, type CsvEntity, importFields, suggestMapping } from "./csv-import-fields";

const pg = drizzle(new PGlite());
let statements = 0;
const db = new Proxy(pg, {
  get(target, prop, receiver) {
    if (prop === "select" || prop === "insert" || prop === "execute") statements++;
    return Reflect.get(target, prop, receiver);
  },
}) as unknown as Parameters<typeof planCsvImport>[0];

beforeAll(async () => {
  await applyTenantMigrations(pg as never);
}, 120_000);

beforeEach(async () => {
  statements = 0;
  await pg.execute(sql`delete from contact`);
  await pg.execute(sql`delete from lead`);
  await pg.execute(sql`delete from company`);
  await pg.execute(sql`delete from "user"`);
  await pg.execute(
    sql`insert into "user" (id, name, email) values ('u1', 'Giulia', 'g@studio.it'), ('u2', 'Marco', 'm@studio.it')`,
  );
});

async function contact(email: string) {
  const [row] = (
    await pg.execute(
      sql`select first_name, last_name, phone, city, owner_id, source, tags, marketing_consent, company_id from contact where lower(email) = ${email.toLowerCase()}`,
    )
  ).rows;
  return row as Record<string, unknown>;
}

describe("mapping columns", () => {
  it("suggests fields from Italian and English headers, and leaves the rest to the person", () => {
    expect(suggestMapping("contacts", ["Nome", "Cognome", "E-mail", "Cellulare", "Codice cliente"])).toEqual({
      Nome: "firstName",
      Cognome: "lastName",
      "E-mail": "email",
      Cellulare: "mobile",
      "Codice cliente": "",
    });
  });

  it("never suggests one field for two columns", () => {
    expect(suggestMapping("contacts", ["Email", "Mail"])).toEqual({ Email: "email", Mail: "" });
  });

  it("⚠️ every field reads back as itself, so a mapped row is understood whatever the header was", () => {
    for (const entity of Object.keys(ALIASES) as CsvEntity[]) {
      for (const field of importFields(entity)) {
        const value = field === "tags" ? "a;b" : field === "marketingConsent" ? "sì" : "x";
        const input = rowToInput(entity, applyMapping({ "Colonna qualunque": value }, { "Colonna qualunque": field }));
        expect(Object.keys(input), `${entity}.${field}`).toEqual([field]);
      }
    }
  });

  it("drops the columns mapped to nothing", () => {
    expect(applyMapping({ A: "1", B: "2" }, { A: "firstName", B: "" })).toEqual({ firstName: "1" });
  });
});

describe("⚠️⚠️ a row already in the CRM", () => {
  beforeEach(async () => {
    await pg.execute(sql`
      insert into contact (id, first_name, last_name, email, phone, city, owner_id, source, status)
      values ('c1', 'Mario', 'Rossi', 'Mario@Rossi.it', '0101', 'Genova', 'u2', 'fiera', 'active')`);
  });

  it("is skipped by default, and nothing changes", async () => {
    const plan = await planCsvImport(
      db,
      "contacts",
      [{ firstName: "Mario", lastName: "Rossi", email: "mario@rossi.it", phone: "999" }],
      "u1",
    );
    await plan.write();

    expect(plan).toMatchObject({ newRecords: 0, updated: 0, skipped: 1, duplicates: ["mario@rossi.it"] });
    expect(await contact("mario@rossi.it")).toMatchObject({ phone: "0101" });
  });

  it("is updated on request with the row's filled cells — empty cells, owner and source untouched", async () => {
    const plan = await planCsvImport(
      db,
      "contacts",
      [
        {
          firstName: "Mario",
          lastName: "Rossi",
          email: "MARIO@rossi.it",
          phone: "999",
          city: "",
          tags: "vip;2026",
          marketingConsent: "sì",
          source: "web",
          company: "Rossi Srl",
        },
      ],
      "u1",
      { onDuplicate: "update" },
    );
    await plan.write();

    expect(plan).toMatchObject({ newRecords: 1, updated: 1, skipped: 0 });
    const row = await contact("mario@rossi.it");
    expect(row).toMatchObject({
      phone: "999",
      city: "Genova",
      owner_id: "u2",
      source: "fiera",
      tags: ["vip", "2026"],
      marketing_consent: true,
    });
    const [company] = (await pg.execute(sql`select id from company where name = 'Rossi Srl'`)).rows as { id: string }[];
    expect(row.company_id).toBe(company.id);
  });

  it("is created again when asked to", async () => {
    const plan = await planCsvImport(
      db,
      "contacts",
      [{ firstName: "Mario", lastName: "Rossi", email: "mario@rossi.it" }],
      "u1",
      { onDuplicate: "create" },
    );
    await plan.write();

    expect(plan).toMatchObject({ newRecords: 1, updated: 0, skipped: 0 });
    const [{ n }] = (await pg.execute(sql`select count(*)::int as n from contact`)).rows as { n: number }[];
    expect(n).toBe(2);
  });

  it("⚠️ twice in the same file, updating: the later row wins, and the record is counted once", async () => {
    const plan = await planCsvImport(
      db,
      "contacts",
      [
        { firstName: "Mario", lastName: "Rossi", email: "mario@rossi.it", phone: "111" },
        { firstName: "Mario", lastName: "Rossi", email: "mario@rossi.it", phone: "222", city: "Savona" },
      ],
      "u1",
      { onDuplicate: "update" },
    );
    await plan.write();

    expect(plan.updated).toBe(1);
    expect(await contact("mario@rossi.it")).toMatchObject({ phone: "222", city: "Savona" });
  });

  it("⚠️ a new person twice in the same file, updating: one record, with both rows' cells", async () => {
    const plan = await planCsvImport(
      db,
      "contacts",
      [
        { firstName: "Anna", lastName: "Verdi", email: "anna@verdi.it", phone: "333" },
        { firstName: "Anna", lastName: "Verdi", email: "anna@verdi.it", city: "Pisa" },
      ],
      "u1",
      { onDuplicate: "update" },
    );
    await plan.write();

    expect(plan).toMatchObject({ newRecords: 1, updated: 0 });
    expect(await contact("anna@verdi.it")).toMatchObject({ phone: "333", city: "Pisa", owner_id: "u1" });
  });
});

describe("leads and companies update too", () => {
  it("a lead, by email", async () => {
    await pg.execute(
      sql`insert into lead (id, first_name, last_name, email, owner_id, status) values ('l1', 'Giulia', 'Bianchi', 'g@b.it', 'u2', 'new')`,
    );
    const plan = await planCsvImport(
      db,
      "leads",
      [{ firstName: "Giulia", lastName: "Bianchi", email: "g@b.it", status: "Qualified" }],
      "u1",
      { onDuplicate: "update" },
    );
    await plan.write();

    const [lead] = (await pg.execute(sql`select status, owner_id from lead where id = 'l1'`)).rows;
    expect(lead).toEqual({ status: "qualified", owner_id: "u2" });
  });

  it("a company, by name ignoring case", async () => {
    await pg.execute(sql`insert into company (id, name, city, owner_id) values ('co1', 'ACME S.r.l.', 'Milano', 'u2')`);
    const plan = await planCsvImport(
      db,
      "companies",
      [{ name: "Acme S.r.l.", vatNumber: "IT01234567890", city: "" }],
      "u1",
      { onDuplicate: "update" },
    );
    await plan.write();

    const [company] = (await pg.execute(sql`select name, vat_number, city, owner_id from company`)).rows;
    expect(company).toEqual({ name: "Acme S.r.l.", vat_number: "IT01234567890", city: "Milano", owner_id: "u2" });
  });
});

describe("⚠️⚠️ the Worker budget", () => {
  it("updates five thousand records in a bounded number of statements", async () => {
    const n = 5_000;
    await pg.execute(sql`
      insert into contact (id, first_name, last_name, email, owner_id, status)
      select 'c' || i, 'N' || i, 'C' || i, 'p' || i || '@x.it', 'u2', 'active' from generate_series(1, ${n}) as i`);
    const rows = Array.from({ length: n }, (_, i) => ({
      firstName: `N${i + 1}`,
      lastName: `C${i + 1}`,
      email: `p${i + 1}@x.it`,
      phone: `${i + 1}`,
    }));

    statements = 0;
    const plan = await planCsvImport(db, "contacts", rows, "u1", { onDuplicate: "update" });
    await plan.write();

    expect(plan.updated).toBe(n);
    expect(statements).toBeLessThan(50);
    expect(await contact("p4321@x.it")).toMatchObject({ phone: "4321", owner_id: "u2" });
  }, 60_000);
});
