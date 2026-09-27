/**
 * Every `/api/crm` route says what it touches, and passes through the gate with it.
 *
 * ⚠️⚠️ A route that authenticated without checking a scope would let a key minted to push
 * leads from a website erase a customer or read the whole contact list — and it would look
 * exactly like a working integration. This reads every route file, so a new one cannot be
 * added without appearing here.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = "src/app/api/crm";

function routes(dir = ROOT): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return routes(p);
    return name === "route.ts" ? [p.split("\\").join("/")] : [];
  });
}

/** What each route may be called for. Written out, not derived: deriving it would agree with any mistake. */
const EXPECTED: Record<string, string[]> = {
  activities: ["activities:write"],
  assistant: ["assistant:write"],
  "activities/bulk": ["activities:write"],
  close: ["deals:write"],
  companies: ["companies:write", "companies:read"],
  "companies/bulk": ["companies:write"],
  "companies/[companyId]/activities": ["activities:write"],
  "companies/[companyId]/activities/bulk": ["activities:write"],
  contacts: ["contacts:write", "contacts:read"],
  "contacts/bulk": ["contacts:write"],
  "contacts/[contactId]/activities": ["activities:write"],
  "contacts/[contactId]/activities/bulk": ["activities:write"],
  "custom-fields": ["custom_fields:write"],
  deals: ["deals:read"],
  "deals/[dealId]/activities": ["activities:write"],
  "deals/[dealId]/activities/bulk": ["activities:write"],
  erasure: ["privacy:write"],
  leads: ["leads:write", "leads:read"],
  "leads/bulk": ["leads:write"],
  "leads/[leadId]/activities": ["activities:write"],
  "leads/[leadId]/activities/bulk": ["activities:write"],
  "leads/stage": ["leads:write"],
  notes: ["activities:write"],
  "opt-out": ["privacy:write"],
  orders: ["orders:write", "orders:read"],
  pipelines: ["deals:read"],
  products: ["products:read"],
  quotes: ["quotes:write"],
  webhooks: ["webhooks:write"],
  "webhooks/[id]": ["webhooks:write"],
};

const declared = (src: string) =>
  [...src.matchAll(/const (?:SCOPE|READ_SCOPE) = \{ entity: "(\w+)", access: "(read|write)" \} as const;/g)].map(
    (m) => `${m[1]}:${m[2]}`,
  );

describe("⚠️⚠️ every /api/crm route", () => {
  const files = routes();

  it("is in the table, and the table has no route that is gone", () => {
    const found = files.map((f) => f.slice(ROOT.length + 1, -"/route.ts".length)).sort();
    expect(found).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const file of routes()) {
    const rel = file.slice(ROOT.length + 1, -"/route.ts".length);
    it(`${rel}: declares its scopes and gates every handler with them`, () => {
      const src = readFileSync(file, "utf8");
      expect(declared(src).sort()).toEqual([...(EXPECTED[rel] ?? ["?"])].sort());
      // Never the bare authenticator: it says who, not what they may do.
      expect(src).not.toContain("authenticateApiRequest");
      const handlers = src.match(/export async function (GET|POST|PUT|PATCH|DELETE)\(/g) ?? [];
      const gates = src.match(/await gateApiRequest\(req, (SCOPE|READ_SCOPE)\)/g) ?? [];
      expect(gates.length, "one gate per handler").toBe(handlers.length);
      if (src.includes("export async function POST(")) expect(src).toContain("await gateApiRequest(req, SCOPE)");
      if (src.includes("export async function GET(")) expect(src).toContain("await gateApiRequest(req, READ_SCOPE)");
    });
  }
});
