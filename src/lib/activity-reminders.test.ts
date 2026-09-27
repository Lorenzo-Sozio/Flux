/**
 * Activity reminders reach people: every one of them, whatever minute it falls on.
 *
 * ⚠️⚠️ The worker looked two minutes ahead, which was right when it ran every minute. The
 * frequent jobs now share one ten-minute schedule, so a reminder falling between two runs
 * matched neither — about four in five were never sent.
 */
import { readFileSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";

import { activitiesDueForReminder, REMINDER_LOOKAHEAD_MINUTES } from "./activity-reminders";

const db = drizzle(new PGlite());

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  await db.execute(sql`delete from activity`);
});

/** Minutes between runs of the email worker, read from the schedule that actually runs it. */
function workerIntervalMinutes(): number {
  const src = readFileSync("custom-worker.ts", "utf8");
  const block = src.split("const CRON_JOBS")[1] ?? "";
  for (const entry of block.matchAll(/"([^"]*\*[^"]*)":\s*\[([^\]]+)\]/g)) {
    if (entry[2].includes("/api/cron/email-worker")) {
      const minute = entry[1].split(" ")[0];
      const step = minute.match(/^\*\/(\d+)$/);
      return step ? Number(step[1]) : minute === "*" ? 1 : 60;
    }
  }
  throw new Error("email-worker has no schedule in custom-worker.ts");
}

describe("⚠️⚠️ activity reminders", () => {
  it("look at least as far ahead as the worker's schedule", () => {
    expect(REMINDER_LOOKAHEAD_MINUTES).toBeGreaterThanOrEqual(workerIntervalMinutes());
  });

  it("are all picked up by runs every ten minutes, even when a run starts late", async () => {
    // One reminder due at every minute of an hour: activity at T, reminder 15 minutes before.
    const base = Date.UTC(2026, 8, 28, 9, 0, 0);
    for (let m = 0; m < 60; m++) {
      const date = new Date(base + (m + 15) * 60_000).toISOString();
      await db.execute(
        sql`insert into activity (id, type, date, reminder_minutes) values (${`a${m}`}, 'call', ${date}, 15)`,
      );
    }

    const seen = new Set<string>();
    // Runs every ten minutes, each one up to ninety seconds late.
    for (let run = 0; run <= 6; run++) {
      const jitter = (run % 3) * 45_000;
      const now = new Date(base - 10 * 60_000 + run * 10 * 60_000 + jitter);
      for (const a of await activitiesDueForReminder(db as never, now)) seen.add(a.id);
    }

    expect(seen.size).toBe(60);
  });

  it("does not reach back into the day's history", async () => {
    const now = new Date(Date.UTC(2026, 8, 28, 12, 0, 0));
    await db.execute(
      sql`insert into activity (id, type, date, reminder_minutes) values ('old', 'call', ${new Date(now.getTime() - 60 * 60_000).toISOString()}, 5)`,
    );
    expect(await activitiesDueForReminder(db as never, now)).toEqual([]);
  });
});
