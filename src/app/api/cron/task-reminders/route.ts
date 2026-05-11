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
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/tenant-context";
import { verifyCronRequest } from "@/lib/cron-auth";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getTasksDueToday } from "@/actions/tasks";
import { getActivitiesDueToday } from "@/actions/activities";
import { createNotificationAction } from "@/actions/auth";
import { sendTaskDueEmail, sendActivityReminderEmail } from "@/lib/email";

export async function GET(req: NextRequest) {
  const authError = verifyCronRequest(req);
  if (authError) return authError;

  const db = await getDb();

  const dueTasks = await getTasksDueToday();
  let notified = 0;

  for (const task of dueTasks) {
    const userId = task.assigneeId ?? task.ownerId;
    if (!userId) continue;

    const [user] = await db
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, userId));

    if (!user) continue;

    // Build link to the relevant entity
    let link = "/dashboard/calendar";
    if (task.contactId) link = `/dashboard/contacts/${task.contactId}`;
    else if (task.leadId) link = `/dashboard/leads/${task.leadId}`;
    else if (task.companyId) link = `/dashboard/companies/${task.companyId}`;

    // In-app notification
    await createNotificationAction({
      userId,
      type: "task_due",
      title: `Task due today: "${task.title}"`,
      message: "This task is due today. Don't forget to complete it.",
      link,
    });

    // Email notification
    if (user.email) {
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

    await createNotificationAction({
      userId: activity.ownerId,
      type: "task_due",
      title: `${typeLabel} today: "${description}"`,
      message: `You have a ${typeLabel.toLowerCase()} scheduled today.`,
      link,
    }).catch(() => {});

    if (user.email && activity.date) {
      await sendActivityReminderEmail(user.email, activity.type, description, activity.date, link).catch(() => {});
    }

    activitiesNotified++;
  }

  return NextResponse.json({
    ok: true,
    tasksFound: dueTasks.length,
    notified,
    activitiesFound: dueActivities.length,
    activitiesNotified,
    timestamp: new Date().toISOString(),
  });
}
