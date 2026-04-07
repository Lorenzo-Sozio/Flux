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

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { and, eq, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { campaignLogs, emailJobs, marketingCampaigns } from "@/db/schema";
import { sendEmail, getEmailConfig } from "@/lib/email-provider";

const BATCH_SIZE = parseInt(process.env.EMAILS_PER_WORKER_RUN ?? "30");

// Retry delays in milliseconds (5 min, 30 min)
const RETRY_DELAYS_MS = [5 * 60 * 1000, 30 * 60 * 1000];

export async function GET(req: NextRequest) {
  // Verify cron secret (timing-safe to prevent oracle attacks)
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const authHeader = req.headers.get("authorization") ?? "";
    const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    let authorized = false;
    try {
      const a = Buffer.from(provided);
      const b = Buffer.from(secret);
      authorized = a.length === b.length && timingSafeEqual(a, b);
    } catch {}
    if (!authorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const now = new Date();
  const config = await getEmailConfig();

  // Fetch a batch of pending jobs scheduled for now or earlier
  const jobs = await db
    .select()
    .from(emailJobs)
    .where(and(eq(emailJobs.status, "pending"), lte(emailJobs.scheduledAt, now)))
    .limit(BATCH_SIZE)
    .for("update", { skipLocked: true });  // prevent duplicate processing

  if (jobs.length === 0) {
    return NextResponse.json({ processed: 0, message: "No pending jobs." });
  }

  // Mark all fetched jobs as "processing" atomically
  const jobIds = jobs.map((j) => j.id);
  await db
    .update(emailJobs)
    .set({ status: "processing" })
    .where(sql`${emailJobs.id} = ANY(ARRAY[${sql.join(jobIds.map((id) => sql`${id}`), sql`, `)}]::text[])`);

  let sent = 0;
  let failed = 0;
  const campaignsDone = new Set<string>();

  for (const job of jobs) {
    try {
      const result = await sendEmail(
        { to: job.toEmail, subject: job.subject, html: job.htmlBody },
        config
      );

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
        await handleJobFailure(job, result.error ?? "Send failed", now);
        failed++;
      }
    } catch (err: any) {
      await handleJobFailure(job, err?.message ?? "Unexpected error", now);
      failed++;
    }

    if (job.campaignId) campaignsDone.add(job.campaignId);
  }

  // Check if any campaign is fully complete (no remaining pending/processing jobs)
  for (const campaignId of campaignsDone) {
    const remaining = await db
      .select({ id: emailJobs.id })
      .from(emailJobs)
      .where(
        and(
          eq(emailJobs.campaignId, campaignId),
          sql`${emailJobs.status} IN ('pending', 'processing')`
        )
      )
      .limit(1);

    if (remaining.length === 0) {
      await db
        .update(marketingCampaigns)
        .set({ status: "completed", updatedAt: now })
        .where(eq(marketingCampaigns.id, campaignId));
    }
  }

  return NextResponse.json({ processed: jobs.length, sent, failed });
}

async function handleJobFailure(job: typeof emailJobs.$inferSelect, error: string, now: Date) {
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
