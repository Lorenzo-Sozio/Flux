/**
 * The issuer profile actions, read as source.
 *
 * ⚠️ Whoever can change the partita IVA and the IBAN changes where every future
 * invoice says the money goes. That is an admin's decision, and the action has to
 * enforce it whatever the settings screen shows.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const src = readFileSync("src/actions/invoicing.ts", "utf8").split("\r\n").join("\n");

function body(name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  expect(start, `${name} is gone`).toBeGreaterThan(-1);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

describe("the issuer profile", () => {
  it("⚠️⚠️ is changed only with invoicing:manage, checked before the database", () => {
    const b = body("saveIssuerProfile");
    const guard = b.indexOf('await requireCapability("invoicing:manage")');
    expect(guard, "no capability check").toBeGreaterThan(-1);
    expect(guard).toBeLessThan(b.indexOf("getDb()"));
  });

  it("⚠️⚠️ stores only what cleanIssuer produced", () => {
    const b = body("saveIssuerProfile");
    expect(b).toContain("const values = cleanIssuer(input);");
    expect(b).not.toMatch(/\.\.\.input\b/);
  });

  it("is one row for the workspace, updated in place", () => {
    const b = body("saveIssuerProfile");
    expect(b).toContain("id: ROW");
    expect(b).toContain("target: invoiceIssuers.id");
  });
});
