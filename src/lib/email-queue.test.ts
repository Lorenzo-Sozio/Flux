/**
 * Claiming queued emails, read as the SQL drizzle generates.
 *
 * No database is contacted: `neon()` only builds a function and `.toSQL()` never
 * calls it.
 */
import { readFileSync } from "node:fs";

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { describe, expect, it } from "vitest";

import { claimStatement, dueJobIds } from "./email-queue";

const db = drizzle(neon("postgresql://user:pass@localhost/never-contacted"));
const flat = (s: string) => s.replace(/\s+/g, " ").trim();

describe("the claim", () => {
  const { sql: text, params } = claimStatement(db, ["j1", "j2"]).toSQL();
  const q = flat(text);

  it("⚠️⚠️ is one update that only succeeds on jobs still pending", () => {
    expect(q).toMatch(/^update "email_job" set "status" = \$1/);
    expect(q).toContain('where ("email_job"."id" in ($2, $3) and "email_job"."status" = $4)');
    expect(params).toEqual(["processing", "j1", "j2", "pending"]);
  });

  it("⚠️⚠️ returns the rows it took, so only the winner sends them", () => {
    expect(q).toContain("returning");
  });
});

describe("finding what is due", () => {
  it("reads pending jobs due now, oldest first", () => {
    const q = flat(dueJobIds(db, new Date("2026-09-15T10:00:00Z"), 30).toSQL().sql);
    expect(q).toContain('"email_job"."status" = $1');
    expect(q).toContain('"email_job"."scheduled_at" <= $2');
    expect(q).toContain('order by "email_job"."scheduled_at" asc');
  });
});

describe("the worker", () => {
  const worker = readFileSync("src/app/api/cron/email-worker/route.ts", "utf8");

  it("⚠️⚠️ sends only what claimDueJobs handed it", () => {
    expect(worker).toContain("await claimDueJobs(db, now, BATCH_SIZE)");
  });

  it("⚠️⚠️ no longer relies on a row lock the HTTP driver cannot hold", () => {
    expect(worker).not.toMatch(/\.for\(\s*"update"/);
  });
});
