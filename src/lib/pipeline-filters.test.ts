/**
 * The Pipeline filters: what the URL means, and the SQL it becomes.
 *
 * No database is contacted: `neon()` only builds a function and `.toSQL()` never
 * calls it.
 */
import { neon } from "@neondatabase/serverless";
import { and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { describe, expect, it } from "vitest";

import { deals } from "@/db/schema";

import {
  ALL_OWNERS,
  ownerCondition,
  ownersParam,
  PIPELINE_VIEWS,
  parseOwners,
  parsePipelineFilters,
  pipelineViewAt,
  UNASSIGNED,
} from "./pipeline-filters";

const db = drizzle(neon("postgresql://user:pass@localhost/never-contacted"));
const where = (owners: string[]) => {
  const { sql, params } = db
    .select({ id: deals.id })
    .from(deals)
    .where(and(ownerCondition(deals.ownerId, owners)))
    .toSQL();
  return { sql: sql.replace(/\s+/g, " "), params };
};

describe("reading the URL", () => {
  it("takes agents as a list, once each, and drops what cannot be an id", () => {
    expect(parseOwners("u1,u2,u1, none ,drop me,'; --")).toEqual(["u1", "u2", "none"]);
    expect(parseOwners("")).toEqual([]);
    expect(parseOwners(null)).toEqual([]);
  });

  it("⚠️ reads `all` as no filter, not as an agent called all", () => {
    expect(parseOwners(ALL_OWNERS)).toEqual([]);
  });

  it("accepts only the offered periods and falls back to the page's own", () => {
    expect(parsePipelineFilters(new URLSearchParams("period=180")).period).toBe(180);
    expect(parsePipelineFilters(new URLSearchParams("period=7"), { period: 365 }).period).toBe(365);
    expect(parsePipelineFilters({}, {}).period).toBe(90);
  });

  it("accepts only deal statuses, and trims the search", () => {
    expect(parsePipelineFilters({ status: "won", q: "  acme " })).toMatchObject({ status: "won", q: "acme" });
    expect(parsePipelineFilters({ status: "deleted" }).status).toBeNull();
    expect(parsePipelineFilters({ q: ["first", "second"] }).q).toBe("first");
  });
});

describe("writing the URL", () => {
  const everyone = ["u1", "u2", UNASSIGNED];

  it("writes nothing for no selection, and `all` for every box ticked", () => {
    expect(ownersParam([], everyone)).toBeNull();
    expect(ownersParam(["u2", UNASSIGNED, "u1"], everyone)).toBe(ALL_OWNERS);
  });

  it("writes the ids otherwise", () => {
    expect(ownersParam(["u2", UNASSIGNED], everyone)).toBe("u2,none");
  });
});

describe("the owner condition", () => {
  it("filters nothing for everyone", () => {
    expect(ownerCondition(deals.ownerId, [])).toBeUndefined();
    expect(where([]).sql).not.toContain("where");
  });

  it("keeps the chosen agents", () => {
    const q = where(["u1", "u2"]);
    expect(q.sql).toContain('"deal"."owner_id" in ($1, $2)');
    expect(q.params).toEqual(["u1", "u2"]);
  });

  it("⚠️⚠️ finds deals nobody owns with IS NULL, never IN (NULL)", () => {
    const q = where([UNASSIGNED]);
    expect(q.sql).toContain('"deal"."owner_id" is null');
    expect(q.params).toEqual([]);
  });

  it("⚠️ combines agents and nobody with OR, so neither hides the other", () => {
    const q = where(["u1", UNASSIGNED]);
    expect(q.sql).toContain('("deal"."owner_id" in ($1) or "deal"."owner_id" is null)');
    expect(q.params).toEqual(["u1"]);
  });
});

describe("the views", () => {
  it("knows each Pipeline page by path, and a deal's own page as none", () => {
    expect(pipelineViewAt("/dashboard/pipeline")?.key).toBe("board");
    expect(pipelineViewAt("/dashboard/pipeline/win-loss/")?.key).toBe("winLoss");
    expect(pipelineViewAt("/dashboard/pipeline/abc123")).toBeNull();
  });

  it("offers the agent filter on every page", () => {
    for (const v of PIPELINE_VIEWS) expect(v.controls, v.key).toContain("owners");
  });
});
