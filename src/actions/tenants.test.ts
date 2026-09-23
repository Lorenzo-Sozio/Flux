/**
 * Creating a workspace, read as source.
 *
 * Three rules here are invisible in review and expensive to get wrong, and all three
 * were wrong at once on 23 September 2026:
 *
 *  1. **Whose workspace it is.** The panel authorises the action with its own session
 *     and the owner used to come from the *application's* — a different identity, in
 *     whatever browser the panel happened to be open in.
 *  2. **Which database it gets.** A workspace pointed at the platform's own database
 *     has the tenant migrations run over the registry that holds every workspace.
 *  3. **All of it, or none.** Four unrelated writes left a workspace with no owner and
 *     an unmigrated database when the second one failed.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const src = readFileSync("src/actions/tenants.ts", "utf8").split("\r\n").join("\n");

function body(name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  expect(start, `${name} is gone`).toBeGreaterThan(-1);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

describe("creating a workspace", () => {
  const create = body("createTenant");

  it("⚠️⚠️ takes the owner from the admin panel session, never from the application's", () => {
    expect(create).toContain("const { user: admin } = await requireAdminPanelAccess();");
    expect(create).toContain("const creatorId = admin.id;");
    // `auth()` is the application's session: present in the browser of whoever last
    // used Flux on that machine, and nothing to do with who is operating the panel.
    expect(create).not.toMatch(/\bawait auth\(\)/);
    expect(src).not.toContain('from "@/auth"');
  });

  it("⚠️ refuses to write an owner row for an account that no longer exists", () => {
    const check = create.indexOf("if (!creator) {");
    expect(check, "no existence check").toBeGreaterThan(-1);
    expect(check).toBeLessThan(create.indexOf("platformDb.batch"));
  });

  it("⚠️⚠️ refuses the platform's own database, before writing anything", () => {
    const guard = create.indexOf("sameDatabase(dbUrl, process.env.DATABASE_URL)");
    expect(guard, "no platform-database guard").toBeGreaterThan(-1);
    expect(guard).toBeLessThan(create.indexOf("platformDb.batch"));
  });

  it("⚠️⚠️ writes the workspace, its subscription and its owner in one batch", () => {
    expect(create).toContain("await platformDb.batch(");
    // Three inserts, one statement each, and all of them inside `writes` — the array
    // handed to the batch — rather than run on their own before it.
    const writesAt = create.indexOf("const writes");
    expect(writesAt).toBeGreaterThan(-1);
    for (const table of ["tenants", "billingSubscriptions", "tenantMembers"]) {
      const at = create.indexOf(`.insert(${table})`);
      expect(at, table).toBeGreaterThan(writesAt);
      expect(at, table).toBeLessThan(create.indexOf("await platformDb.batch("));
    }
  });
});
