/**
 * The territory actions, read as source.
 *
 * ⚠️ A server action is an endpoint whatever the screen shows. The settings page is
 * admin-only, but an action that forgot its own check would let any member save a
 * territory by calling it directly, and one that skipped `cleanTerritory` would
 * store the territory with no criteria the screen refuses.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const src = readFileSync("src/actions/territories.ts", "utf8").split("\r\n").join("\n");

function body(name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  expect(start, `${name} is gone`).toBeGreaterThan(-1);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

describe("changing a territory", () => {
  for (const name of ["createTerritory", "updateTerritory", "deleteTerritory"]) {
    it(`⚠️⚠️ ${name} requires the territory capability before anything else`, () => {
      const b = body(name);
      const guard = b.indexOf('await requireCapability("territory:manage")');
      expect(guard, "no capability check").toBeGreaterThan(-1);
      expect(guard).toBeLessThan(b.indexOf("getDb()"));
    });
  }

  for (const name of ["createTerritory", "updateTerritory"]) {
    it(`⚠️⚠️ ${name} writes only what cleanTerritory returned`, () => {
      const b = body(name);
      expect(b).toContain("const cleaned = cleanTerritory(input);");
      expect(b).toContain("if (!cleaned.ok) return cleaned;");
      expect(b).toContain("...cleaned.value");
      expect(b).not.toMatch(/\.\.\.input\b/);
    });
  }
});

describe("reading territories", () => {
  it("needs no more than reading records", () => {
    expect(body("getTerritories")).toContain('await requireCapability("record:read")');
  });
});
