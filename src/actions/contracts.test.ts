/**
 * The contract actions, read as source.
 *
 * ⚠️ A server action is an endpoint whatever the screen shows. An action that
 * forgot its own check would let a viewer write contracts by calling it, and one
 * that skipped `cleanContract` would store the self-renewing contract with no end
 * date that is never due for renewal.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const src = readFileSync("src/actions/contracts.ts", "utf8").split("\r\n").join("\n");

function body(name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  expect(start, `${name} is gone`).toBeGreaterThan(-1);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

describe("changing a contract", () => {
  for (const [name, capability] of [
    ["createContract", "contract:write"],
    ["updateContract", "contract:write"],
    ["deleteContract", "contract:delete"],
  ]) {
    it(`⚠️⚠️ ${name} requires ${capability} before touching the database`, () => {
      const b = body(name);
      const guard = b.indexOf(`await requireCapability("${capability}")`);
      expect(guard, "no capability check").toBeGreaterThan(-1);
      expect(guard).toBeLessThan(b.indexOf("getDb()"));
    });
  }

  for (const name of ["createContract", "updateContract"]) {
    it(`⚠️⚠️ ${name} writes only what cleanContract returned`, () => {
      const b = body(name);
      expect(b).toContain("const cleaned = cleanContract(input);");
      expect(b).toContain("if (!cleaned.ok) return cleaned;");
      expect(b).toContain("...cleaned.value");
      expect(b).not.toMatch(/\.\.\.input\b/);
    });
  }
});

describe("reading contracts", () => {
  it("⚠️ computes every phase through termsOf, never a cast", () => {
    expect(src).not.toContain("as never");
    expect(body("getContracts")).toContain("termsOf(contract)");
    expect(body("getRecurringRevenueSummary")).toContain("rows.map(termsOf)");
  });
});
