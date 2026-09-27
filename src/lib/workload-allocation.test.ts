/**
 * One workload rule for the page and the Gantt panel — and days that are dates, not instants.
 *
 * ⚠️⚠️ The two copies answered differently about the same person's week, and the page drew
 * every cell one day to the left in Rome, keying local midnights with `toISOString()`.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";

import { allocateWorkload, countOverloads, DEFAULT_TASK_HOURS, workingDayKeys } from "./workload-allocation";

const db = drizzle(new PGlite());
vi.mock("@/lib/tenant-context", () => ({ getDb: async () => db }));
vi.mock("@/lib/auth-guard", () => ({ requireCapability: async () => undefined }));
vi.mock("@/lib/workspace-time-zone", () => ({ getWorkspaceTimeZone: async () => "Europe/Rome" }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { getWorkloadMatrix } = await import("@/actions/workload");

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

const week = workingDayKeys("2026-09-28", "2026-10-02");

describe("working days", () => {
  it("are Monday to Friday, as dates, whatever the machine's zone", () => {
    expect(workingDayKeys("2026-09-26", "2026-10-05")).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-05",
    ]);
    expect(workingDayKeys("2026-10-05", "2026-10-01")).toEqual([]);
    expect(workingDayKeys("yesterday", "2026-10-01")).toEqual([]);
  });
});

describe("⚠️⚠️ the rule", () => {
  const base = { startDay: null, estimatedHours: null, parentId: null, status: "todo" };

  it("an unestimated task is an hour, on its due date when it has no start", () => {
    const load = allocateWorkload([{ ...base, id: "t", dueDay: "2026-09-30", people: ["anna"] }], week);
    expect(load.get("anna")?.get("2026-09-30")?.hours).toBe(DEFAULT_TASK_HOURS);
    expect(load.get("anna")?.size).toBe(1);
  });

  it("spreads over the whole span, so a task partly in view is not heavier", () => {
    const load = allocateWorkload(
      [{ ...base, id: "t", startDay: "2026-09-21", dueDay: "2026-10-02", estimatedHours: 20, people: ["anna"] }],
      week,
    );
    // Ten working days, two hours each; five of them in view.
    expect([...(load.get("anna")?.values() ?? [])].map((c) => c.hours)).toEqual([2, 2, 2, 2, 2]);
  });

  it("⚠️ counts everybody responsible, once each", () => {
    const load = allocateWorkload(
      [{ ...base, id: "t", dueDay: "2026-09-30", estimatedHours: 4, people: ["anna", "luca", "anna", null] }],
      week,
    );
    expect([...load.keys()].sort()).toEqual(["anna", "luca"]);
    expect(load.get("anna")?.get("2026-09-30")?.hours).toBe(4);
  });

  it("⚠️ a parent carries nothing, nor a task already done", () => {
    const load = allocateWorkload(
      [
        { ...base, id: "parent", dueDay: "2026-09-30", estimatedHours: 40, people: ["anna"] },
        { ...base, id: "child", parentId: "parent", dueDay: "2026-09-30", estimatedHours: 3, people: ["anna"] },
        { ...base, id: "done", status: "done", dueDay: "2026-09-30", estimatedHours: 9, people: ["anna"] },
      ],
      week,
    );
    expect(load.get("anna")?.get("2026-09-30")?.hours).toBe(3);
    // A parent outside the list still counts as one when the caller says so.
    const windowed = allocateWorkload(
      [{ ...base, id: "parent", dueDay: "2026-09-30", estimatedHours: 40, people: ["anna"] }],
      week,
      new Set(["parent"]),
    );
    expect(windowed.size).toBe(0);
  });

  it("counts a day over capacity once per person", () => {
    const load = allocateWorkload(
      [
        { ...base, id: "a", dueDay: "2026-09-30", estimatedHours: 6, people: ["anna"] },
        { ...base, id: "b", dueDay: "2026-09-30", estimatedHours: 6, people: ["anna", "luca"] },
      ],
      week,
    );
    expect(countOverloads(load)).toBe(1);
  });
});

describe("⚠️⚠️ the workload page", () => {
  it("puts a task on the day it is due on the workspace's clock, and keys the cells by date", async () => {
    await db.execute(sql`insert into "user" (id, name, email) values ('anna', 'Anna', 'anna@x.it')`);
    // 00:30 on Wednesday 30 September in Rome; still Tuesday in UTC.
    await db.execute(sql`
      insert into task (id, title, status, assignee_id, due_date, estimated_hours) values
        ('t1', 'Offerta', 'todo', 'anna', '2026-09-29T22:30:00Z', '3')`);

    const [row] = await getWorkloadMatrix("2026-09-28", "2026-10-02");
    expect(Object.keys(row.days)).toEqual(week);
    expect(row.days["2026-09-30"]).toMatchObject({ hours: 3, capacity: 8 });
    expect(row.days["2026-09-30"].tasks[0]).toMatchObject({ title: "Offerta", dueDate: "2026-09-30" });
    expect(row.days["2026-09-29"].hours).toBe(0);
  });
});
