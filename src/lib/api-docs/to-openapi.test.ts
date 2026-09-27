/**
 * The machine-readable reference is the page, converted (src/lib/api-docs/to-openapi.ts):
 * every public operation, with its scope, and nothing in it that JSON cannot carry.
 */
import { describe, expect, it } from "vitest";

import { openApiSpec } from "@/lib/openapi/spec";

import { PUBLIC_API_GROUPS } from "./public-api";
import { publicApiPaths, publicOpenApi } from "./to-openapi";

const ops = (paths: Record<string, Record<string, Record<string, unknown>>>) =>
  Object.entries(paths).flatMap(([path, byMethod]) =>
    Object.entries(byMethod).map(([method, op]) => ({ path, method: method.toUpperCase(), op })),
  );

describe("⚠️⚠️ the public OpenAPI document", () => {
  const doc = publicOpenApi("https://crm.example");
  const all = ops(doc.paths as never);

  it("has one operation per documented entry, and no other", () => {
    const entries = PUBLIC_API_GROUPS.flatMap((g) => g.endpoints.map((e) => `${e.method} ${e.path}`)).sort();
    expect(all.map((o) => `${o.method} ${o.path}`).sort()).toEqual(entries);
  });

  it("carries each /api/crm operation's scope, where a person and a generator can read it", () => {
    const crm = all.filter((o) => o.path.startsWith("/api/crm/"));
    expect(crm.length).toBeGreaterThanOrEqual(28);
    for (const { op } of crm) {
      expect(op["x-scope"]).toMatch(/^\w+:(read|write)$/);
      expect(String(op.description)).toContain(`Scope: \`${op["x-scope"]}\``);
      // And says what happens without it.
      expect(Object.keys(op.responses as object)).toContain("403");
    }
  });

  it("survives a trip through JSON unchanged: no undefined, no functions", () => {
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
    expect(doc.servers).toEqual([{ url: "https://crm.example" }]);
    expect(publicOpenApi(null)).not.toHaveProperty("servers");
  });

  it("⚠️ the staff spec takes the same operations, not a copy of its own", () => {
    const staff = openApiSpec.paths as Record<string, unknown>;
    for (const [path, byMethod] of Object.entries(publicApiPaths())) expect(staff[path]).toEqual(byMethod);
  });
});
