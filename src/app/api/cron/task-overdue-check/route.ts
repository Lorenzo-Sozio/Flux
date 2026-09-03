/**
 * Overdue task → dependency risk check.
 * Run daily (08:00) via Vercel Cron:
 * { "crons": [{ "path": "/api/cron/task-overdue-check", "schedule": "0 8 * * *" }] }
 * Protected by CRON_SECRET env variable.
 */

import { and, eq, isNotNull, lt } from "drizzle-orm";

import { createNotificationAction } from "@/actions/auth";
import { taskDependencies, tasks } from "@/db/schema";
import { runCronJob } from "@/lib/cron-runner";
import type { TenantDb } from "@/lib/tenant-resolve";

// Runs once per workspace. It used to run once for no workspace at all: getDb()
// reads a request header that a scheduled request never carries (rilievo B-02).
export async function GET(req: Request) {
  return runCronJob("task-overdue-check", req, runForTenant);
}

async function runForTenant(db: TenantDb) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // find tasks that are overdue (dueDate < today, status != done) and have FS successors
  const overdueTasks = await db
    .select({ id: tasks.id, title: tasks.title, ownerId: tasks.ownerId, dueDate: tasks.dueDate })
    .from(tasks)
    .where(and(isNotNull(tasks.dueDate), lt(tasks.dueDate, today), eq(tasks.status, "todo")));

  let notified = 0;

  for (const task of overdueTasks) {
    const successors = await db
      .select({ successorId: taskDependencies.successorId })
      .from(taskDependencies)
      .where(and(eq(taskDependencies.predecessorId, task.id), eq(taskDependencies.type, "FS")));

    if (successors.length === 0) continue;

    const notifyUserId = task.ownerId;
    if (!notifyUserId) continue;

    await createNotificationAction({
      userId: notifyUserId,
      type: "task_due",
      title: `Task "${task.title}" is overdue`,
      message: `${successors.length} dependent task(s) are at risk. Consider rescheduling.`,
      link: "/dashboard/tasks",
      // biome-ignore lint/suspicious/noEmptyBlockStatements: swallow fire-and-forget errors
    }).catch(() => {});

    notified++;
  }

  return { overdueWithDeps: overdueTasks.length, notified };
}
