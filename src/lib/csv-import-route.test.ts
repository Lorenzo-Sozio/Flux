/**
 * Who may import a CSV, and what happens to a file that would overflow the plan.
 *
 * ⚠️⚠️ The contact and company routes only checked that somebody was signed in: a viewer,
 * read-only everywhere else, could import five thousand rows, and the plan's record limit
 * was never asked. Leads had a button and no route.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";

const db = drizzle(new PGlite());
let role: "viewer" | "editor" = "editor";
let limit: number | null = null;

class ForbiddenError extends Error {}
class UnauthenticatedError extends Error {}
class EntitlementError extends Error {}

vi.mock("@/lib/tenant-context", () => ({ getDb: async () => db }));
vi.mock("@/lib/rate-limiter", () => ({ checkRateLimit: async () => true }));
vi.mock("@/lib/i18n-server", () => ({ serverT: async () => (key: string) => key }));
vi.mock("@/lib/auth-guard", () => ({
  ForbiddenError,
  UnauthenticatedError,
  EntitlementError,
  requireCapability: async (capability: string) => {
    // The real table decides this; what is checked here is that the route asks for it.
    if (capability !== "record:import") throw new Error(`asked for ${capability}`);
    if (role === "viewer") throw new ForbiddenError("no");
    return { userId: "u1", tenantRole: role, isPlatformStaff: false };
  },
  requirePlanLimit: async (_metric: string, value: number) => {
    if (limit !== null && value >= limit) throw new EntitlementError("limite raggiunto");
  },
}));

const { handleCsvImport } = await import("./csv-import-route");

function upload(csv: string, extra: Record<string, string> = {}) {
  const form = new FormData();
  form.append("file", new File([csv], "import.csv", { type: "text/csv" }));
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return new Request("https://x.test/api/contacts/import", { method: "POST", body: form });
}

async function contactCount() {
  return ((await db.execute(sql`select count(*)::int as n from contact`)).rows[0] as { n: number }).n;
}

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  role = "editor";
  limit = null;
  await db.execute(sql`delete from contact`);
  await db.execute(sql`delete from lead`);
  await db.execute(sql`delete from company`);
  await db.execute(sql`delete from "user"`);
  await db.execute(sql`insert into "user" (id, name, email) values ('u1', 'Giulia', 'giulia@studio.it')`);
});

describe("⚠️⚠️ the CSV import route", () => {
  it("refuses a viewer, and writes nothing", async () => {
    role = "viewer";
    const r = await handleCsvImport(upload("firstName,lastName\nA,B"), "contacts");

    expect(r.status).toBe(403);
    expect(await contactCount()).toBe(0);
  });

  it("refuses a file that would overflow the plan whole, instead of stopping at the line that crosses", async () => {
    await db.execute(sql`insert into contact (id, first_name, last_name) values ('c0', 'Già', 'Qui')`);
    limit = 3; // one record held, room for two more

    const r = await handleCsvImport(upload("firstName,lastName\nA,Uno\nB,Due\nC,Tre"), "contacts");

    expect(r.status).toBe(403);
    expect(await contactCount()).toBe(1);
  });

  it("takes a file that exactly fills the plan", async () => {
    limit = 2;
    const r = await handleCsvImport(upload("firstName,lastName\nA,Uno\nB,Due"), "contacts");

    expect(r.status).toBe(200);
    expect(await contactCount()).toBe(2);
  });

  it("reads the semicolons Italian Excel writes, and Italian headers", async () => {
    const r = await handleCsvImport(upload("Nome;Cognome;Email\nMario;Rossi;mario@x.it\n"), "contacts");
    const body = await r.json();

    expect(body).toMatchObject({ created: 1, skipped: 0, total: 1 });
    expect(await contactCount()).toBe(1);
  });

  it("imports leads, which used to have a button and no route", async () => {
    const r = await handleCsvImport(upload("firstName,lastName,email\nLuca,Verdi,luca@x.it"), "leads");

    expect(r.status).toBe(200);
    expect(((await db.execute(sql`select count(*)::int as n from lead`)).rows[0] as { n: number }).n).toBe(1);
  });
});

describe("⚠️ the wizard's preview and mapping", () => {
  it("previews without writing", async () => {
    const res = await handleCsvImport(upload("firstName,lastName\nAnna,Neri\nLuca,Blu", { dryRun: "1" }), "contacts");

    expect(await res.json()).toMatchObject({ success: true, dryRun: true, created: 2, updated: 0 });
    expect(await contactCount()).toBe(0);
  });

  it("⚠️ tells the preview the file would overflow the plan, instead of refusing it", async () => {
    limit = 1;
    const res = await handleCsvImport(upload("firstName,lastName\nAnna,Neri\nLuca,Blu", { dryRun: "1" }), "contacts");

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ dryRun: true, limitError: "limite raggiunto" });
    expect(await contactCount()).toBe(0);
  });

  it("reads the columns as the person mapped them, whatever their headers", async () => {
    const mapping = JSON.stringify({ "Colonna A": "firstName", "Colonna B": "lastName", Interno: "" });
    const res = await handleCsvImport(upload("Colonna A,Colonna B,Interno\nAnna,Neri,42", { mapping }), "contacts");

    expect(await res.json()).toMatchObject({ created: 1 });
    const [row] = (await db.execute(sql`select first_name, last_name from contact`)).rows;
    expect(row).toEqual({ first_name: "Anna", last_name: "Neri" });
  });

  it("ignores a mapping that is not an object of strings", async () => {
    const res = await handleCsvImport(
      upload("firstName,lastName\nAnna,Neri", { mapping: "[1,2]", onDuplicate: "bogus" }),
      "contacts",
    );
    expect(await res.json()).toMatchObject({ created: 1 });
  });
});
