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
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getTasksDueToday } from "@/actions/tasks";
import { createNotificationAction } from "@/actions/auth";
import { sendTaskDueEmail } from "@/lib/email";

export async function GET(req: NextRequest) {
  // Protect with secret so only the scheduler can trigger this
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

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

  return NextResponse.json({
    ok: true,
    tasksFound: dueTasks.length,
    notified,
    timestamp: new Date().toISOString(),
  });
}
