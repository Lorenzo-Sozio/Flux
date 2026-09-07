/**
 * Task due-today reminder endpoint.
 * Call this daily (e.g. 08:00 AM) via Vercel Cron, GitHub Actions, or any scheduler.
 *
 * Vercel cron config (vercel.json):
 * { "crons": [{ "path": "/api/cron/task-reminders", "schedule": "0 8 * * *" }] }
 *
 * Protected by CRON_SECRET env variable. Add to .env:
 *   CRON_SECRET="your-random-secret"
 *
 * The scheduler should pass the header: Authorization: Bearer <CRON_SECRET>
 */
import { and, eq, gte } from "drizzle-orm";

import { getActivitiesDueToday } from "@/actions/activities";
import { notifications, users } from "@/db/schema";
import { runCronJob } from "@/lib/cron-runner";
import { sendActivityReminderEmail, sendTaskDueEmail } from "@/lib/email";
import { notify } from "@/lib/notify";
import { selectTasksDueToday } from "@/lib/tasks-due";
import type { TenantDb } from "@/lib/tenant-resolve";

// Runs once per workspace, with the active tenant set around the call so the
// dashboard actions it reuses resolve to the right database (rilievo B-02).
export async function GET(req: Request) {
  return runCronJob("task-reminders", req, runForTenant);
}

async function runForTenant(db: TenantDb) {
  // The shared query, not the server action: this runs with no session, and the
  // action is guarded so the screens cannot be read by a stranger.
  const dueTasks = await selectTasksDueToday(db);
  let notified = 0;

  // ⚠️⚠️ **This job runs every fifteen minutes and had no memory.**
  //
  // Every task due today produced a notification *and an email* on every run:
  // ninety-six of each, per task, per person, per day. Nobody reported it
  // because the bell only accumulates and the mail looked like the same
  // reminder arriving again — but wiring push notifications to the same rows
  // turns it into ninety-six buzzes on a phone, which is how a browser revokes
  // the permission and a person switches the whole feature off.
  //
  // The other reminder job that repeats, ticket-sla-check, remembers on the
  // ticket itself (`sla_breached_at`, `sla_warn_level`). Tasks have no such
  // column, so the memory is the notification already written: one reminder per
  // person per thing per day, read back from what today has already produced.
  //
  // Keyed on the title rather than an id because the same key has to cover both
  // loops below, and a task and an activity have no identifier in common. Two
  // things with the same title for the same person on the same day collapse into
  // one reminder, which is the right answer anyway.
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const toldToday = new Set(
    (
      await db
        .select({ userId: notifications.userId, title: notifications.title })
        .from(notifications)
        .where(and(eq(notifications.type, "task_due"), gte(notifications.createdAt, midnight)))
    ).map((n) => `${n.userId}\u0000${n.title}`),
  );

  for (const task of dueTasks) {
    const userId = task.assigneeId ?? task.ownerId;
    if (!userId) continue;

    const [user] = await db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, userId));

    if (!user) continue;

    // Build link to the relevant entity
    let link = "/dashboard/calendar";
    if (task.contactId) link = `/dashboard/contacts/${task.contactId}`;
    else if (task.leadId) link = `/dashboard/leads/${task.leadId}`;
    else if (task.companyId) link = `/dashboard/companies/${task.companyId}`;

    const title = `Task due today: "${task.title}"`;
    const key = `${userId}\u0000${title}`;
    // Already reminded on this run or an earlier one today.
    if (toldToday.has(key)) continue;
    toldToday.add(key);

    // In-app notification
    await notify({
      userId,
      type: "task_due",
      title,
      message: "This task is due today. Don't forget to complete it.",
      link,
    });

    // Email notification
    if (user.email) {
      // One recipient whose mail bounces must not stop the sweep for everyone else.
      // biome-ignore lint/suspicious/noEmptyBlockStatements: best-effort delivery
      await sendTaskDueEmail(user.email, task.title, link).catch(() => {});
    }

    notified++;
  }

  // ── Activity reminders (calls & meetings today) ──────────────────────────
  const dueActivities = await getActivitiesDueToday();
  let activitiesNotified = 0;

  for (const activity of dueActivities) {
    if (!activity.ownerId) continue;

    const [user] = await db
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, activity.ownerId));

    if (!user) continue;

    const typeLabel = activity.type === "call" ? "Call" : "Meeting";
    const description = activity.content ?? typeLabel;

    let link = "/dashboard/calendar";
    if (activity.contactId) link = `/dashboard/contacts/${activity.contactId}`;
    else if (activity.leadId) link = `/dashboard/leads/${activity.leadId}`;
    else if (activity.companyId) link = `/dashboard/companies/${activity.companyId}`;

    const title = `${typeLabel} today: "${description}"`;
    const key = `${activity.ownerId}\u0000${title}`;
    if (toldToday.has(key)) continue;
    toldToday.add(key);

    await notify({
      userId: activity.ownerId,
      type: "task_due",
      title,
      message: `You have a ${typeLabel.toLowerCase()} scheduled today.`,
      link,
      // biome-ignore lint/suspicious/noEmptyBlockStatements: fire-and-forget
    }).catch(() => {});

    if (user.email && activity.date) {
      // One recipient whose mail bounces must not stop the sweep for everyone else.
      // biome-ignore lint/suspicious/noEmptyBlockStatements: best-effort delivery
      await sendActivityReminderEmail(user.email, activity.type, description, activity.date, link).catch(() => {});
    }

    activitiesNotified++;
  }

  return {
    tasksFound: dueTasks.length,
    notified,
    activitiesFound: dueActivities.length,
    activitiesNotified,
  };
}
