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

import { and, eq, gte, sql } from "drizzle-orm";

import { campaignLogs, emailJobs, marketingCampaigns, notifications, users } from "@/db/schema";
import { activitiesDueForReminder } from "@/lib/activity-reminders";
import { getAppUrlOrNull } from "@/lib/app-url";
import { runCronJob } from "@/lib/cron-runner";
import { sendActivityReminderEmail } from "@/lib/email";
import { getEmailConfig, sendEmail } from "@/lib/email-provider";
import { claimDueJobs } from "@/lib/email-queue";
import { type SyncBudget, syncBudget, syncMailboxes } from "@/lib/mail-sync";
import { readLocale } from "@/lib/morning-digest";
import { composeNotification } from "@/lib/notification-text";
import { notify } from "@/lib/notify";
import { tolerateUnmigrated } from "@/lib/schema-ready";
import { advanceSequences, SEQUENCE_TOKEN_PREFIX } from "@/lib/sequence-runner";
import type { TenantDb } from "@/lib/tenant-resolve";
import { unsubscribeUrlFor } from "@/lib/unsubscribe-token";
import { membersWith } from "@/lib/workspace-members";
import { getWorkspaceTimeZone } from "@/lib/workspace-time-zone";

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
  // One budget for every workspace this run opens: see src/lib/mail-sync.ts.
  const budget = syncBudget();
  return runCronJob("email-worker", req, async (db, tenant) => ({
    ...(await runForTenant(db)),
    mailboxes: await readMailboxes(db, tenant.id, budget),
  }));
}

/**
 * The connected mailboxes (V3.2), after the queue: sending what is owed comes first. A
 * failure here is logged and costs the queue nothing.
 */
async function readMailboxes(db: TenantDb, tenantId: string, budget: SyncBudget) {
  // Asked of the registry only when the workspace has a mailbox to read.
  const writers = () => membersWith(tenantId, "record:write");
  return tolerateUnmigrated("mailboxes", () => syncMailboxes(db, { budget, writers }), null).catch((err) => {
    console.error("[email-worker] mailbox sync failed:", err instanceof Error ? err.message : err);
    return null;
  });
}

function unsubscribeFor(job: { toEmail: string; campaignLogId: string | null; sequenceEnrollmentId: string | null }) {
  return unsubscribeUrlFor(job, getAppUrlOrNull(), SEQUENCE_TOKEN_PREFIX);
}

async function runForTenant(db: TenantDb) {
  const now = new Date();
  const config = await getEmailConfig();

  // Follow-up sequences first, so a step that falls due now is queued and sent in
  // this same run rather than a minute later.
  const sequences = await tolerateUnmigrated("sequences", () => advanceSequences(db, now), null);

  // Claimed, not locked: see src/lib/email-queue.ts for the double sends a lock
  // the HTTP driver cannot hold used to produce.
  const jobs = await claimDueJobs(db, now, BATCH_SIZE);

  if (jobs.length === 0) {
    // Reminders still have to run even when the queue is empty.
    const reminders = await dispatchActivityReminders(db);
    return { processed: 0, sent: 0, failed: 0, remindersDispatched: reminders, sequences };
  }

  let sent = 0;
  let failed = 0;
  const campaignsDone = new Set<string>();

  for (const job of jobs) {
    try {
      const result = await sendEmail(
        {
          to: job.toEmail,
          subject: job.subject,
          html: job.htmlBody,
          ...(job.cc ? { cc: job.cc } : {}),
          ...(job.bcc ? { bcc: job.bcc } : {}),
          // A sequence's thread (src/lib/sequence-plan.ts): the first email's id, and a reply to it.
          ...(job.messageHeaderId ? { messageId: job.messageHeaderId } : {}),
          ...(job.inReplyTo ? { inReplyTo: job.inReplyTo, references: job.inReplyTo } : {}),
          // The mail client's own unsubscribe button, in one click (RFC 8058): campaigns, rules'
          // emails and sequence steps — everything this queue sends that has a way out.
          ...(unsubscribeFor(job) ? { listUnsubscribe: unsubscribeFor(job) as string } : {}),
        },
        config,
      );

      if (result.success) {
        // Mark job sent
        await db
          .update(emailJobs)
          .set({ status: "sent", processedAt: now, messageId: result.messageId ?? null, lastError: null })
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

  return { processed: jobs.length, sent, failed, remindersDispatched, sequences };
}

// ── Activity reminder notifications ──────────────────────────────────────────
async function dispatchActivityReminders(db: TenantDb): Promise<number> {
  const pendingReminders = await activitiesDueForReminder(db);
  let remindersDispatched = 0;

  // ⚠️ The window is two minutes wide and this job runs every minute, so every
  // reminder matched on two consecutive runs: two notifications and two emails
  // where one was meant. The wide window is deliberate — it is what stops a
  // missed run losing a reminder altogether — so the fix is memory, not a
  // narrower window.
  //
  // Same memory as `task-reminders`: what today has already produced. No column
  // to add, and one reminder per person per thing per day is the right answer
  // even if the window were to change again.
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

    const params = {
      kind: activity.type,
      description,
      time: activity.date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
    };
    // The stored title doubles as the memory of what was sent today.
    const { title } = await composeNotification("activityReminder", params);
    const key = `${activity.ownerId}\u0000${title}`;
    // Already sent on this run or an earlier one today.
    if (toldToday.has(key)) continue;
    toldToday.add(key);

    await notify({
      userId: activity.ownerId,
      type: "task_due",
      key: "activityReminder",
      params,
      link,
      // biome-ignore lint/suspicious/noEmptyBlockStatements: fire-and-forget
    }).catch(() => {});

    if (user.email) {
      // One recipient whose mail bounces must not stop the sweep for everyone else.
      await sendActivityReminderEmail(user.email, activity.type, description, activity.date, link, {
        locale: await readLocale(db, activity.ownerId).catch(() => null),
        timeZone: await getWorkspaceTimeZone(),
      }).catch(() => undefined);
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
