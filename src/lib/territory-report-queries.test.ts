/**
 * The SQL behind the territory report, read as generated.
 *
 * No database is contacted: `neon()` only builds a function and `.toSQL()` never
 * calls it.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { describe, expect, it } from "vitest";

import { dealsByPlace, leadsByPlace } from "./territory-report-queries";

const db = drizzle(neon("postgresql://user:pass@localhost/never-contacted"));
const flat = (s: string) => s.replace(/\s+/g, " ").trim();
const since = new Date("2026-06-01T00:00:00Z");

describe("leads by place", () => {
  const { sql: text, params } = leadsByPlace(db, since).toSQL();
  const q = flat(text);

  it("passes the start of the period as a timestamp string the driver can send", () => {
    expect(params).toEqual([since.toISOString(), since.toISOString()]);
  });

  it("⚠️ groups by the whole address, so each place is one row", () => {
    expect(q).toContain('group by "lead"."country", "lead"."state", "lead"."zip_code"');
  });

  it("⚠️ counts as open only leads not converted and not disqualified", () => {
    expect(q).toContain(`count(*) filter (where "is_converted" = false and "status" <> 'unqualified')`);
  });

  it("⚠️⚠️ dates new leads by creation and conversions by conversion, never by last edit", () => {
    expect(q).toContain('filter (where "created_at" >= $1)');
    expect(q).toContain('"is_converted" = true and "converted_at" >= $2');
    expect(q).not.toContain("updated_at");
  });
});

describe("deals by place", () => {
  const { sql: text } = dealsByPlace(db, since).toSQL();
  const q = flat(text);

  it("⚠️⚠️ keeps deals with no company or no contact", () => {
    // An inner join would drop them from every territory and from the "no
    // territory" row, and the totals would stop matching the pipeline.
    expect(q).toContain('left join "company" on "company"."id" = "deal"."company_id"');
    expect(q).toContain('left join "contact" on "contact"."id" = "deal"."contact_id"');
    expect(q).not.toMatch(/\binner join\b/);
  });

  it("⚠️⚠️ dates wins and losses by closing, never by last edit", () => {
    expect(q).toContain(`"deal"."status" = 'won' and "deal"."closed_at" >=`);
    expect(q).toContain(`"deal"."status" = 'lost' and "deal"."closed_at" >=`);
    expect(q).not.toContain("updated_at");
  });

  it("counts open pipeline whatever its age", () => {
    expect(q).toContain(`coalesce(sum("deal"."amount") filter (where "deal"."status" = 'open'), 0)`);
  });
});
