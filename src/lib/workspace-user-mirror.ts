import { and, eq, ne } from "drizzle-orm";

import { users } from "@/db/schema";
import type { getDb } from "@/lib/tenant-context";

/**
 * The signed-in person's row in the workspace's own `user` table, which the workspace's
 * foreign keys point at (a record's owner, a task's assignee).
 *
 * The dashboard layout wrote it on every page: a DELETE of any stale row carrying the same
 * address under another id (left by an old invitation bug), then an upsert — two writes,
 * one after the other, before anything else of the page could start. The row changes when
 * the person's name, address or role does, which is almost never. So it is written when
 * that tuple is new to this process, and again at most every ten minutes as a safety net
 * for a row removed behind its back.
 */
const WRITTEN_FOR_MS = 10 * 60 * 1000;
const written = new Map<string, number>();

type Db = Awaited<ReturnType<typeof getDb>>;

export async function mirrorUser(
  db: Db,
  workspaceId: string,
  person: { id: string; name: string; email: string; role: string },
): Promise<void> {
  const key = [workspaceId, person.id, person.name, person.email, person.role].join("\u0000");
  const at = written.get(key);
  if (at !== undefined && Date.now() - at < WRITTEN_FOR_MS) return;

  // Remove any stale row created with the same email but a wrong platform ID.
  // This can happen when a previous invitation acceptance bug inserted the user
  // directly into the tenant DB instead of the platform DB, generating a mismatch.
  if (person.email) {
    await db.delete(users).where(and(eq(users.email, person.email), ne(users.id, person.id)));
  }
  await db
    .insert(users)
    .values({ id: person.id, name: person.name, email: person.email, role: person.role })
    .onConflictDoUpdate({ target: users.id, set: { name: person.name, role: person.role } });

  // Remembered only once written: a failed write is tried again on the next page.
  written.set(key, Date.now());
}
