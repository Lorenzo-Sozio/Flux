/**
 * The activity figures of the reports page, against a real Postgres.
 *
 * ⚠️⚠️ They read `user_activity_log`, which nothing in the product writes: two tabs and the
 * export told every manager that the team had done nothing. They read the calls, meetings,
 * emails and notes people log now — dated by when the activity happened, not when it was
 * typed in, because a call logged on Monday for last Friday belongs to last Friday.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";

const db = drizzle(new PGlite());

vi.mock("@/lib/tenant-context", () => ({ getDb: async () => db }));
vi.mock("@/lib/auth-guard", () => ({ requireCapability: async () => undefined }));

const { getActivityByAction, getActivityByUser, getDailyActivityTrend, getReportKPIs, getTaskPerformanceByUser } =
  await import("./reports");

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  await db.execute(sql`delete from activity`);
  await db.execute(sql`delete from "user"`);
  await db.execute(
    sql`insert into "user" (id, name, email) values ('anna', 'Anna', 'anna@x.it'), ('luca', 'Luca', 'luca@x.it')`,
  );
  const add = (owner: string, type: string, date: string, created = "2026-09-20T09:00:00Z") =>
    db.execute(
      sql`insert into activity (id, type, owner_id, date, created_at) values (${crypto.randomUUID()}, ${type}, ${owner}, ${date}, ${created})`,
    );
  await add("anna", "call", "2026-09-10T10:00:00Z");
  await add("anna", "call", "2026-09-11T10:00:00Z");
  await add("anna", "meeting", "2026-09-11T15:00:00Z");
  await add("luca", "email", "2026-09-11T11:00:00Z");
  // Logged on the 20th for a call made on 1 September: outside a 10–15 September period.
  await add("luca", "call", "2026-09-01T10:00:00Z", "2026-09-20T09:00:00Z");
});

const period = { from: "2026-09-10", to: "2026-09-15" };

describe("⚠️⚠️ the activity tab counts what people logged", () => {
  it("per person", async () => {
    expect(await getActivityByUser(period)).toEqual([
      { userId: "anna", userName: "Anna", userEmail: "anna@x.it", count: 3 },
      { userId: "luca", userName: "Luca", userEmail: "luca@x.it", count: 1 },
    ]);
  });

  it("per type", async () => {
    expect(await getActivityByAction(period)).toEqual([
      { action: "call", count: 2 },
      { action: "email", count: 1 },
      { action: "meeting", count: 1 },
    ]);
  });

  it("per day, on the day the activity happened", async () => {
    const days = (await getDailyActivityTrend(period)).map((d) => ({
      day: String(d.day).slice(0, 10),
      count: d.count,
    }));
    expect(days).toEqual([
      { day: "2026-09-10", count: 1 },
      { day: "2026-09-11", count: 3 },
    ]);
  });

  it("and the headline figure, for one person or for everyone", async () => {
    expect((await getReportKPIs(period)).activityCount).toBe(4);
    expect((await getReportKPIs({ ...period, userId: "luca" })).activityCount).toBe(1);
  });
});

describe("⚠️ task performance per person", () => {
  beforeEach(async () => {
    await db.execute(sql`delete from task`);
    const task = (
      id: string,
      assignee: string,
      status: string,
      created: string,
      extra: { completedAt?: string; due?: string } = {},
    ) =>
      db.execute(
        sql`insert into task (id, title, status, assignee_id, created_at, completed_at, due_date) values (${id}, ${id}, ${status}, ${assignee}, ${created}, ${extra.completedAt ?? null}, ${extra.due ?? null})`,
      );
    await task("t1", "anna", "done", "2026-09-10T09:00:00Z", { completedAt: "2026-09-12T09:00:00Z" });
    await task("t2", "anna", "todo", "2026-09-11T09:00:00Z", { due: "2026-09-12T09:00:00Z" });
    // Not done, whatever its status is called: overdue all the same.
    await task("t3", "anna", "in_progress", "2026-09-11T09:00:00Z", { due: "2026-09-13T09:00:00Z" });
    await task("t4", "luca", "todo", "2026-08-01T09:00:00Z");
  });

  it("counts in grouped statements, and leaves out who had nothing in the period", async () => {
    expect(await getTaskPerformanceByUser(period)).toEqual([
      { userId: "anna", userName: "Anna", tasksTotal: 3, tasksCompleted: 1, tasksOverdue: 2, completionRate: 33 },
    ]);
    expect(await getTaskPerformanceByUser({ ...period, userId: "luca" })).toEqual([]);
  });
});
