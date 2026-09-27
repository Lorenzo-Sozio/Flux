/**
 * Overdue task → dependency risk check.
 * Run daily (08:00) via Vercel Cron:
 * { "crons": [{ "path": "/api/cron/task-overdue-check", "schedule": "0 8 * * *" }] }
 * Protected by CRON_SECRET env variable.
 */

import { and, eq, isNotNull, lt } from "drizzle-orm";

import { platformDb } from "@/db";
import { taskDependencies, tasks, tenantMembers } from "@/db/schema";
import { getAppUrlOrNull } from "@/lib/app-url";
import { sendContractNotices } from "@/lib/contract-notices";
import { runCronJob } from "@/lib/cron-runner";
import { sendEmail } from "@/lib/email-provider";
import type { Tenant } from "@/lib/get-tenant";
import { sendMorningDigests } from "@/lib/morning-digest";
import { notify } from "@/lib/notify";
import { runScheduledRules } from "@/lib/scheduled-rules";
import type { TenantDb } from "@/lib/tenant-resolve";
import { dayStart } from "@/lib/workspace-day";
import { getWorkspaceTimeZone } from "@/lib/workspace-time-zone";

// Runs once per workspace. It used to run once for no workspace at all: getDb()
// reads a request header that a scheduled request never carries (rilievo B-02).
export async function GET(req: Request) {
  return runCronJob("task-overdue-check", req, runForTenant);
}

async function runForTenant(db: TenantDb, tenant: Tenant) {
  // The workspace's today, not the server's UTC one.
  const today = dayStart(new Date(), await getWorkspaceTimeZone());

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

    await notify({
      userId: notifyUserId,
      type: "task_due",
      key: "taskOverdue",
      params: { title: task.title, count: successors.length },
      link: "/dashboard/tasks",
      // biome-ignore lint/suspicious/noEmptyBlockStatements: swallow fire-and-forget errors
    }).catch(() => {});

    notified++;
  }

  // Contracts entering their renewal window ride on this job rather than a new
  // trigger: the Free plan allows five and all five are taken.
  const contracts = await sendContractNotices(db);

  // ⚠️ The morning digest rides here too, for the same reason: one email per person per
  // day in place of one per task (src/lib/morning-digest.ts). Members only — a workspace's
  // copy of its users can outlive a membership. It never fails the job it rides on.
  let digests = 0;
  const appUrl = getAppUrlOrNull();
  if (appUrl) {
    try {
      const members = (
        await platformDb
          .select({ userId: tenantMembers.userId })
          .from(tenantMembers)
          .where(eq(tenantMembers.tenantId, tenant.id))
      ).map((m) => m.userId);
      digests = await sendMorningDigests(db, {
        members,
        timeZone: await getWorkspaceTimeZone(),
        appUrl,
        send: (to, subject, html) => sendEmail({ to, subject, html }),
      });
    } catch (err) {
      console.error("[task-overdue-check] morning digest skipped:", err);
    }
  }

  // Rules that fire when a condition becomes true with time (§8.1): here too, since the job
  // already runs every workspace each morning and a new schedule would cost a cron trigger.
  const rules = await runScheduledRules(db).catch((err) => {
    console.error("[task-overdue-check] scheduled rules skipped:", err);
    return { checked: 0, fired: 0 };
  });

  return { overdueWithDeps: overdueTasks.length, notified, contracts, digests, rules };
}
