/**
 * Email queue worker — processes pending email_job rows.
 *
 * Call this endpoint every minute via a cron job:
 *   Vercel:  vercel.json  → { "crons": [{ "path": "/api/cron/email-worker", "schedule": "* * * * *" }] }
 *   External: curl -H "Authorization: Bearer $CRON_SECRET" https://your-domain/api/cron/email-worker
 *
 * Rate: EMAILS_PER_WORKER_RUN env var (default 30) → ~30 emails/minute.
 * Retry: up to 3 attempts with exponential backoff (5 min, 30 min).
 */

import { and, eq, lte, sql } from "drizzle-orm";

import { getActivitiesWithPendingReminder } from "@/actions/activities";
import { createNotificationAction } from "@/actions/auth";
import { campaignLogs, emailJobs, marketingCampaigns, users } from "@/db/schema";
import { runCronJob } from "@/lib/cron-runner";
import { sendActivityReminderEmail } from "@/lib/email";
import { getEmailConfig, sendEmail } from "@/lib/email-provider";
import type { TenantDb } from "@/lib/tenant-resolve";

const BATCH_SIZE = Number.parseInt(process.env.EMAILS_PER_WORKER_RUN ?? "30", 10);

// Retry delays in milliseconds (5 min, 30 min)
const RETRY_DELAYS_MS = [5 * 60 * 1000, 30 * 60 * 1000];

/**
 * Drains the email queue for every workspace.
 *
 * Until now this opened a single database with getDb(), which reads a request
 * header that a scheduled request never carries: the job threw immediately, so
 * queued campaign email was never sent at all and simply accumulated (audit
 * rilievo B-02). The batch size is per workspace, so one busy tenant cannot
 * starve the others.
 */
export async function GET(req: Request) {
  return runCronJob("email-worker", req, runForTenant);
}

async function runForTenant(db: TenantDb) {
  const now = new Date();
  const config = await getEmailConfig();

  // Fetch a batch of pending jobs scheduled for now or earlier
  const jobs = await db
    .select()
    .from(emailJobs)
    .where(and(eq(emailJobs.status, "pending"), lte(emailJobs.scheduledAt, now)))
    .limit(BATCH_SIZE)
    .for("update", { skipLocked: true }); // prevent duplicate processing

  if (jobs.length === 0) {
    // Reminders still have to run even when the queue is empty.
    const reminders = await dispatchActivityReminders(db);
    return { processed: 0, sent: 0, failed: 0, remindersDispatched: reminders };
  }

  // Mark all fetched jobs as "processing" atomically
  const jobIds = jobs.map((j) => j.id);
  await db
    .update(emailJobs)
    .set({ status: "processing" })
    .where(
      sql`${emailJobs.id} = ANY(ARRAY[${sql.join(
        jobIds.map((id) => sql`${id}`),
        sql`, `,
      )}]::text[])`,
    );

  let sent = 0;
  let failed = 0;
  const campaignsDone = new Set<string>();

  for (const job of jobs) {
    try {
      const result = await sendEmail({ to: job.toEmail, subject: job.subject, html: job.htmlBody }, config);

      if (result.success) {
        // Mark job sent
        await db
          .update(emailJobs)
          .set({ status: "sent", processedAt: now, ...(result.messageId ? { lastError: null } : {}) })
          .where(eq(emailJobs.id, job.id));

        // Update campaign log
        if (job.campaignLogId) {
          await db
            .update(campaignLogs)
            .set({ status: "sent", ...(result.messageId ? { messageId: result.messageId } : {}) })
            .where(eq(campaignLogs.id, job.campaignLogId));
        }

        sent++;
      } else {
        await handleJobFailure(db, job, result.error ?? "Send failed", now);
        failed++;
      }
    } catch (err: any) {
      await handleJobFailure(db, job, err?.message ?? "Unexpected error", now);
      failed++;
    }

    if (job.campaignId) campaignsDone.add(job.campaignId);
  }

  // Check if any campaign is fully complete (no remaining pending/processing jobs)
  for (const campaignId of campaignsDone) {
    const remaining = await db
      .select({ id: emailJobs.id })
      .from(emailJobs)
      .where(and(eq(emailJobs.campaignId, campaignId), sql`${emailJobs.status} IN ('pending', 'processing')`))
      .limit(1);

    if (remaining.length === 0) {
      await db
        .update(marketingCampaigns)
        .set({ status: "completed", updatedAt: now })
        .where(eq(marketingCampaigns.id, campaignId));
    }
  }

  const remindersDispatched = await dispatchActivityReminders(db);

  return { processed: jobs.length, sent, failed, remindersDispatched };
}

// ── Activity reminder notifications ──────────────────────────────────────────
async function dispatchActivityReminders(db: TenantDb): Promise<number> {
  const pendingReminders = await getActivitiesWithPendingReminder(2);
  let remindersDispatched = 0;

  for (const activity of pendingReminders) {
    if (!activity.ownerId || !activity.date) continue;

    const [user] = await db
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, activity.ownerId));

    if (!user) continue;

    const typeLabel = activity.type === "call" ? "Call" : activity.type === "meeting" ? "Meeting" : "Activity";
    const description = activity.content ?? typeLabel;

    let link = "/dashboard/calendar";
    if (activity.contactId) link = `/dashboard/contacts/${activity.contactId}`;
    else if (activity.leadId) link = `/dashboard/leads/${activity.leadId}`;
    else if (activity.companyId) link = `/dashboard/companies/${activity.companyId}`;

    await createNotificationAction({
      userId: activity.ownerId,
      type: "task_due",
      title: `Upcoming ${typeLabel}: "${description}"`,
      message: `Scheduled for ${activity.date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`,
      link,
      // biome-ignore lint/suspicious/noEmptyBlockStatements: fire-and-forget
    }).catch(() => {});

    if (user.email) {
      // One recipient whose mail bounces must not stop the sweep for everyone else.
      // biome-ignore lint/suspicious/noEmptyBlockStatements: best-effort delivery
      await sendActivityReminderEmail(user.email, activity.type, description, activity.date, link).catch(() => {});
    }

    remindersDispatched++;
  }

  return remindersDispatched;
}

async function handleJobFailure(db: TenantDb, job: typeof emailJobs.$inferSelect, error: string, now: Date) {
  const newAttempts = job.attempts + 1;

  if (newAttempts >= job.maxAttempts) {
    // Permanent failure
    await db
      .update(emailJobs)
      .set({ status: "failed", attempts: newAttempts, lastError: error, processedAt: now })
      .where(eq(emailJobs.id, job.id));

    if (job.campaignLogId) {
      await db
        .update(campaignLogs)
        .set({ status: "failed", errorMessage: error })
        .where(eq(campaignLogs.id, job.campaignLogId));
    }
  } else {
    // Schedule retry with exponential backoff
    const delayMs = RETRY_DELAYS_MS[newAttempts - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
    const retryAt = new Date(now.getTime() + delayMs);

    await db
      .update(emailJobs)
      .set({ status: "pending", attempts: newAttempts, lastError: error, scheduledAt: retryAt })
      .where(eq(emailJobs.id, job.id));
  }
}
