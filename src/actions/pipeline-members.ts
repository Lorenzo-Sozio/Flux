"use server";

import { eq, isNotNull, notInArray } from "drizzle-orm";

import { platformDb } from "@/db";
import { deals, tenantMembers, users } from "@/db/schema";
import { requireCapability } from "@/lib/auth-guard";
import { getCurrentTenantId, getDb } from "@/lib/tenant-context";

export interface PipelineMember {
  id: string;
  name: string | null;
  email: string | null;
  role: string | null;
  /** Owns deals here but is no longer a member: still filterable, marked as such. */
  former: boolean;
}

/**
 * The agents the Pipeline pages can be filtered by.
 *
 * The only list of people was `getAllUsersAction`, which needs `user:manage` —
 * right for the users screen, wrong for a filter every viewer uses. This asks for
 * `record:read` and returns names, not accounts.
 *
 * ⚠️ Members come from the platform registry, which is the only place that knows
 * who belongs to this workspace. People who left still own deals, and dropping
 * them would leave those deals reachable only through "all agents", so they are
 * added from the deals themselves and marked `former`.
 */
export async function getPipelineMembers(): Promise<PipelineMember[]> {
  await requireCapability("record:read");
  const tenantId = await getCurrentTenantId();
  if (!tenantId) return [];

  const members = await platformDb
    .select({ id: users.id, name: users.name, email: users.email, role: tenantMembers.role })
    .from(tenantMembers)
    .innerJoin(users, eq(users.id, tenantMembers.userId))
    .where(eq(tenantMembers.tenantId, tenantId));

  const db = await getDb();
  const memberIds = members.map((m) => m.id);
  const formerOwners = await db
    .selectDistinct({ id: users.id, name: users.name, email: users.email })
    .from(deals)
    .innerJoin(users, eq(users.id, deals.ownerId))
    .where(memberIds.length ? notInArray(deals.ownerId, memberIds) : isNotNull(deals.ownerId));

  const label = (p: { name: string | null; email: string | null }) => (p.name ?? p.email ?? "").toLocaleLowerCase();
  return [
    ...members.map((m) => ({ ...m, former: false })),
    ...formerOwners.map((p: { id: string; name: string | null; email: string | null }) => ({
      ...p,
      role: null,
      former: true,
    })),
  ].sort((a, b) => Number(a.former) - Number(b.former) || label(a).localeCompare(label(b)));
}
