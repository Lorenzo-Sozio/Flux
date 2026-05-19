/**
 * Distributed rate limiter backed by the platform Postgres database.
 * Safe for multi-instance / serverless deployments — state is shared
 * across all server instances.
 *
 * Uses an upsert pattern:
 *   - First request in a window inserts a new row.
 *   - Subsequent requests in the same window increment the counter.
 *   - Expired windows are reset on the next request (lazy cleanup).
 *
 * A periodic cleanup job is not required; old rows are harmless and
 * can be pruned at any time with: DELETE FROM ratelimit_entry WHERE reset_at < NOW().
 *
 * Usage:
 *   const ok = await checkRateLimit("otp:" + email, 3, 15 * 60_000);
 *   if (!ok) return { error: "Too many attempts. Try again later." };
 */

import { sql } from "drizzle-orm";

import { platformDb } from "@/db";
import { rateLimitEntries } from "@/db/schema";

/**
 * Returns true if the request is allowed, false if the rate limit is exceeded.
 *
 * @param key     Unique identifier for the rate-limited resource (e.g. "otp:user@example.com")
 * @param limit   Maximum number of allowed requests within the window
 * @param windowMs  Duration of the window in milliseconds
 */
export async function checkRateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  const now = new Date();
  const newResetAt = new Date(now.getTime() + windowMs);

  try {
    const result = await platformDb
      .insert(rateLimitEntries)
      .values({ key, count: 1, resetAt: newResetAt, updatedAt: now })
      .onConflictDoUpdate({
        target: rateLimitEntries.key,
        set: {
          count: sql`CASE WHEN ${rateLimitEntries.resetAt} <= ${now} THEN 1 ELSE ${rateLimitEntries.count} + 1 END`,
          resetAt: sql`CASE WHEN ${rateLimitEntries.resetAt} <= ${now} THEN ${newResetAt} ELSE ${rateLimitEntries.resetAt} END`,
          updatedAt: now,
        },
      })
      .returning({ count: rateLimitEntries.count });

    const count = result[0]?.count ?? 1;
    return count <= limit;
  } catch {
    // Fail open on DB errors — don't block the user if the rate-limit table is unavailable.
    // Log and monitor this; a sustained DB failure would disable rate limiting.
    console.error("[rate-limiter] DB error — failing open");
    return true;
  }
}
