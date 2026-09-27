/**
 * "How did it go?" — completing a task records it and plans the next one, against a real
 * Postgres.
 *
 * ⚠️⚠️ One call used to be three records: a task to remember it, an activity to say it
 * happened, often a comment. Completing a call now *is* the call in the timeline — its
 * kind, its outcome, the note — and the next step is a task on the same record.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";
import { activityTypeFor, needsRetry, outcomeFor, taskTypeOf } from "@/lib/task-kinds";

const db = drizzle(new PGlite());
const me = "luca";

vi.mock("@/lib/tenant-context", () => ({ getDb: async () => db }));
vi.mock("@/lib/auth-guard", () => ({
  requireWriteAccess: async () => ({ user: { id: me, role: "editor" } }),
  requireCapability: async () => ({ userId: me, tenantRole: "editor", isPlatformStaff: false }),
}));
vi.mock("@/lib/notify", () => ({ notifyMany: async () => undefined }));
vi.mock("@/lib/webhook-dispatch", () => ({ dispatchWebhook: async () => undefined }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { createTask, updateTaskStatus } = await import("./tasks");

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  await db.execute(sql`delete from activity`);
  await db.execute(sql`delete from task`);
  await db.execute(sql`delete from deal`);
  await db.execute(sql`delete from "user"`);
  await db.execute(
    sql`insert into "user" (id, name, email) values ('anna', 'Anna', 'a@x.it'), ('luca', 'Luca', 'l@x.it')`,
  );
  await db.execute(sql`insert into deal (id, name) values ('d1', 'Rossi Srl')`);
});

async function task(type: string) {
  await db.execute(
    sql`insert into task (id, title, type, status, owner_id, deal_id) values ('t1', 'Chiamare Rossi', ${type}, 'todo', 'anna', 'd1')`,
  );
}

async function activitiesOf() {
  return (await db.execute(sql`select type, content, outcome, task_id, owner_id, deal_id from activity`)).rows;
}

describe("⚠️⚠️ completing a task records what happened", () => {
  it("a call becomes a call in the timeline, with its outcome and the note", async () => {
    await task("call");
    await updateTaskStatus("t1", "done", undefined, { outcome: "reached", note: "Vuole lo sconto del 5%" });

    expect(await activitiesOf()).toEqual([
      {
        type: "call",
        content: "✓ «Chiamare Rossi»\nVuole lo sconto del 5%",
        outcome: "reached",
        task_id: "t1",
        // Whoever made the call, not whoever wrote the task down.
        owner_id: "luca",
        deal_id: "d1",
      },
    ]);
  });

  it("⚠️ an outcome that does not belong to the kind of task is dropped, not stored", async () => {
    await task("call");
    await updateTaskStatus("t1", "done", undefined, { outcome: "held" });

    expect((await activitiesOf())[0]).toMatchObject({ type: "call", outcome: null });
  });

  it("a to-do is a note: nobody was contacted", async () => {
    await task("todo");
    await updateTaskStatus("t1", "done");

    expect((await activitiesOf())[0]).toMatchObject({ type: "note", content: "✓ «Chiamare Rossi»", outcome: null });
  });

  it("ticking with nothing to say still records the kind", async () => {
    await task("meeting");
    await updateTaskStatus("t1", "done");

    expect((await activitiesOf())[0]).toMatchObject({ type: "meeting", outcome: null, task_id: "t1" });
  });
});

describe("⚠️⚠️ the next step is planned in the same gesture", () => {
  it("creates it on the same record, for the person who did this one", async () => {
    await task("call");
    const due = new Date("2026-10-01T09:30:00Z");
    await updateTaskStatus("t1", "done", undefined, {
      outcome: "no_answer",
      next: { type: "call", title: "Richiamare Rossi", dueDate: due, allDay: false },
    });

    const rows = (
      await db.execute(
        sql`select title, type, status, due_date, all_day, owner_id, assignee_id, deal_id from task where id <> 't1'`,
      )
    ).rows as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: "Richiamare Rossi",
      type: "call",
      status: "todo",
      all_day: false,
      owner_id: "luca",
      assignee_id: "luca",
      deal_id: "d1",
    });
    expect(new Date(`${rows[0].due_date}Z`).getTime()).toBe(due.getTime());
  });

  it("an empty title plans nothing", async () => {
    await task("call");
    await updateTaskStatus("t1", "done", undefined, { next: { title: "   " } });

    const [{ n }] = (await db.execute(sql`select count(*)::int as n from task`)).rows as { n: number }[];
    expect(n).toBe(1);
  });

  it("reopening a task records nothing and plans nothing", async () => {
    await task("call");
    await updateTaskStatus("t1", "todo", undefined, { note: "x", next: { title: "y" } });

    expect(await activitiesOf()).toEqual([]);
    const [{ n }] = (await db.execute(sql`select count(*)::int as n from task`)).rows as { n: number }[];
    expect(n).toBe(1);
  });
});

describe("a task's kind", () => {
  it("is stored as asked, and anything unknown is a to-do", async () => {
    const call = await createTask({ title: "Chiamare", type: "call" });
    const odd = await createTask({ title: "Boh", type: "fax" });
    const plain = await createTask({ title: "Niente" });

    expect([call.type, odd.type, plain.type]).toEqual(["call", "todo", "todo"]);
  });
});

describe("task-kinds", () => {
  it("maps kinds to activities and outcomes to kinds", () => {
    expect(activityTypeFor("todo")).toBe("note");
    expect(activityTypeFor("email")).toBe("email");
    expect(outcomeFor("meeting", "no_show")).toBe("no_show");
    expect(outcomeFor("email", "reached")).toBeNull();
    expect(taskTypeOf(null)).toBe("todo");
  });

  it("⚠️ proposes another attempt when nobody was reached", () => {
    expect(needsRetry("no_answer")).toBe(true);
    expect(needsRetry("voicemail")).toBe(true);
    expect(needsRetry("no_show")).toBe(true);
    expect(needsRetry("reached")).toBe(false);
    expect(needsRetry(null)).toBe(false);
  });
});
