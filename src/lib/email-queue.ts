import { and, asc, eq, inArray, lte } from "drizzle-orm";

import { emailJobs } from "@/db/schema";

/**
 * Taking queued emails to send.
 *
 * ⚠️⚠️ The worker used to select pending jobs `FOR UPDATE SKIP LOCKED` and mark
 * them processing in a second statement. On the Neon HTTP driver there is no
 * transaction to hold that lock: it is released when the SELECT returns, so two
 * runs overlapping — a slow minute, a retried cron call — both read the same jobs
 * and both sent them. Each customer received the email twice, and both sends
 * reported success.
 *
 * The UPDATE is the claim. `WHERE status = 'pending'` makes it succeed for one
 * caller only, and `RETURNING` hands that caller the rows it actually won.
 */

// biome-ignore lint/suspicious/noExplicitAny: the tenant db handle is built per request
type AnyDb = any;

/** The ids due now, oldest first. A read only: nothing is taken yet. */
export function dueJobIds(db: AnyDb, now: Date, limit: number) {
  return db
    .select({ id: emailJobs.id })
    .from(emailJobs)
    .where(and(eq(emailJobs.status, "pending"), lte(emailJobs.scheduledAt, now)))
    .orderBy(asc(emailJobs.scheduledAt))
    .limit(limit);
}

/** Marks as processing those of `ids` still pending, and returns exactly those. */
export function claimStatement(db: AnyDb, ids: string[]) {
  return db
    .update(emailJobs)
    .set({ status: "processing" })
    .where(and(inArray(emailJobs.id, ids), eq(emailJobs.status, "pending")))
    .returning();
}

export async function claimDueJobs(db: AnyDb, now: Date, limit: number): Promise<(typeof emailJobs.$inferSelect)[]> {
  const due: { id: string }[] = await dueJobIds(db, now, limit);
  if (due.length === 0) return [];
  return claimStatement(
    db,
    due.map((d) => d.id),
  );
}
