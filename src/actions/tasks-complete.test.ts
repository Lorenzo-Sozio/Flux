/**
 * Completing a task tells the people it concerns — never the one who completed it.
 *
 * ⚠️⚠️ It notified `assigneeId ?? ownerId`, usually the person clicking, as `task_due`
 * (which pushes by default) with a link to the calendar: ticking a task buzzed your own
 * phone.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";

const db = drizzle(new PGlite());
let me = "anna";
const told: { userId: string; type: string; key?: string; params?: Record<string, unknown>; link?: string }[] = [];

vi.mock("@/lib/tenant-context", () => ({ getDb: async () => db }));
vi.mock("@/lib/auth-guard", () => ({
  requireWriteAccess: async () => ({ user: { id: me, role: "editor" } }),
  requireCapability: async () => ({ userId: me, tenantRole: "editor", isPlatformStaff: false }),
}));
vi.mock("@/lib/notify", () => ({
  notifyMany: async (rows: typeof told) => {
    told.push(...rows);
  },
}));
vi.mock("@/lib/webhook-dispatch", () => ({ dispatchWebhook: async () => undefined }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { updateTaskStatus } = await import("./tasks");

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  told.length = 0;
  await db.execute(sql`delete from task`);
  await db.execute(sql`delete from "user"`);
  await db.execute(
    sql`insert into "user" (id, name, email) values ('anna', 'Anna', 'anna@x.it'), ('luca', 'Luca', 'luca@x.it')`,
  );
});

async function task(ownerId: string | null, assigneeId: string | null) {
  await db.execute(
    sql`insert into task (id, title, status, owner_id, assignee_id) values ('t1', 'Chiamare Rossi', 'todo', ${ownerId}, ${assigneeId})`,
  );
}

describe("⚠️⚠️ completing a task", () => {
  it("does not notify the person who completed it", async () => {
    await task("anna", "anna");
    me = "anna";
    await updateTaskStatus("t1", "done");
    expect(told).toEqual([]);
  });

  it("tells the owner when somebody else completes a task they handed out", async () => {
    await task("anna", "luca");
    me = "luca";
    await updateTaskStatus("t1", "done");
    expect(told).toEqual([
      expect.objectContaining({
        userId: "anna",
        type: "task_completed",
        key: "taskCompleted",
        params: { completer: "Luca", title: "Chiamare Rossi" },
        link: "/dashboard/tasks?task=t1",
      }),
    ]);
  });

  it("tells the assignee when the owner completes it for them", async () => {
    await task("anna", "luca");
    me = "anna";
    await updateTaskStatus("t1", "done");
    expect(told.map((n) => n.userId)).toEqual(["luca"]);
  });
});
