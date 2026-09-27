import { eq } from "drizzle-orm";

import { platformDb } from "@/db";
import { tenantMembers } from "@/db/schema";
import { type Capability, can } from "@/lib/permissions";

/**
 * The people of one workspace who hold `capability`: who to ask, who to tell.
 *
 * ⚠️⚠️ **Read from the platform registry, filtered by `can()`.** Two places looked for
 * "the admins" with `users.role IN ('admin','owner')` in the workspace's own `user` table
 * — the quote approval request and the new-order bell. That table is a copy: the dashboard
 * layout writes the membership role into it when a person opens the dashboard, and nothing
 * removes the row when they leave. So someone promoted to admin was not asked until their
 * next visit, and someone who had left the workspace kept receiving approval requests and
 * order alerts. An out-of-date list of recipients is not an error, so nothing said so.
 *
 * Membership is the registry's: the only place that is right the moment it changes.
 */
export async function membersWith(tenantId: string, capability: Capability): Promise<string[]> {
  const members = await platformDb
    .select({ userId: tenantMembers.userId, role: tenantMembers.role })
    .from(tenantMembers)
    .where(eq(tenantMembers.tenantId, tenantId));
  return members.filter((m) => can(m.role, capability)).map((m) => m.userId);
}
