/**
 * Writing an automation rule is an admin's decision.
 *
 * A rule acts for the whole workspace: it emails customers, calls outside addresses and
 * reassigns records. Creating one asked only `record:write`, so every editor could.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const src = readFileSync("src/actions/automation.ts", "utf8");

function guardOf(fn: string): string {
  const start = src.indexOf(`export async function ${fn}(`);
  expect(start, `${fn} exists`).toBeGreaterThan(-1);
  const body = src.slice(start, start + 400);
  return body.match(/require\w+\((?:"[^"]+")?\)/)?.[0] ?? "";
}

describe("⚠️⚠️ automation rules", () => {
  for (const fn of [
    "createAutomationRule",
    "updateAutomationRule",
    "toggleAutomationRuleActive",
    "deleteAutomationRule",
    "installAutomationRecipe",
  ]) {
    it(`${fn} asks for automation:manage`, () => {
      expect(guardOf(fn)).toBe('requireCapability("automation:manage")');
    });
  }

  it("reading them stays open to everyone who reads records", () => {
    expect(guardOf("getAutomationRules")).toBe('requireCapability("record:read")');
  });
});
