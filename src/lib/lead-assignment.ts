/**
 * Who is told that a lead is now theirs: the person it was assigned to, or — assigned to a group —
 * everybody in the group. Never whoever made the assignment: they know.
 *
 * ⚠️⚠️ Every way a lead gets an owner or a group goes through here — typed in, edited, reassigned in
 * bulk, filed by the API. A lead created already assigned used to tell nobody, and a lead handed to
 * a group told nobody at all: the group's queue filled up in silence.
 */
import { eq, inArray } from "drizzle-orm";

import { leads, userGroupMembers, userGroups } from "@/db/schema";
import { type NotificationInput, notifyManyIn } from "@/lib/notify";

// biome-ignore lint/suspicious/noExplicitAny: the tenant db handle is built per request
type AnyDb = any;

export interface Assignment {
  ownerId: string | null | undefined;
  groupId: string | null | undefined;
}

/**
 * The pure half: who hears of it. The owner when the owner changed; the group's members when the
 * group changed, except the owner already told. A machine assigning (the API) has no actor.
 */
export function assignmentRecipients(input: {
  before: Assignment | null;
  after: Assignment;
  actorId: string | null;
  groupMembers: readonly string[];
}): { owner: string | null; group: string[] } {
  const { before, after, actorId } = input;
  const owner = after.ownerId && after.ownerId !== before?.ownerId && after.ownerId !== actorId ? after.ownerId : null;
  const groupChanged = Boolean(after.groupId) && after.groupId !== before?.groupId;
  const group = groupChanged
    ? [...new Set(input.groupMembers)].filter((id) => id !== actorId && id !== after.ownerId)
    : [];
  return { owner, group };
}

/** Tells whoever a lead was just assigned to. Never throws: the assignment is already saved. */
export async function announceLeadAssignment(
  db: AnyDb,
  input: {
    leadId: string;
    name: string;
    before: Assignment | null;
    after: Assignment;
    actorId: string | null;
  },
): Promise<void> {
  try {
    // Only a group that changed is read: an edit that leaves it alone tells its members nothing.
    const groupId = input.after.groupId && input.after.groupId !== input.before?.groupId ? input.after.groupId : null;
    const [members, group]: [{ userId: string }[], { name: string } | undefined] = groupId
      ? await Promise.all([
          db
            .select({ userId: userGroupMembers.userId })
            .from(userGroupMembers)
            .where(eq(userGroupMembers.groupId, groupId)),
          db
            .select({ name: userGroups.name })
            .from(userGroups)
            .where(eq(userGroups.id, groupId))
            .then((rows: { name: string }[]) => rows[0]),
        ])
      : [[], undefined];
    const to = assignmentRecipients({
      before: input.before,
      after: input.after,
      actorId: input.actorId,
      groupMembers: members.map((m) => m.userId),
    });
    const name = input.name.trim() || "—";
    const link = `/dashboard/leads/${input.leadId}`;
    const rows: NotificationInput[] = [
      ...(to.owner
        ? [{ userId: to.owner, type: "lead_assigned", key: "leadAssigned" as const, params: { name }, link }]
        : []),
      ...to.group.map((userId) => ({
        userId,
        type: "lead_assigned",
        key: "leadAssignedToGroup" as const,
        params: { name, group: group?.name ?? "—" },
        link,
      })),
    ];
    await notifyManyIn(db, rows);
  } catch (err) {
    console.error("[lead-assignment] assigned, but nobody was told:", err);
  }
}

/** One notification for a reassignment in bulk, not one per lead. */
export async function announceLeadsAssigned(
  db: AnyDb,
  input: { ownerId: string; count: number; actorId: string | null },
): Promise<void> {
  if (input.count === 0 || input.ownerId === input.actorId) return;
  try {
    await notifyManyIn(db, [
      {
        userId: input.ownerId,
        type: "lead_assigned",
        key: "leadsAssigned",
        params: { count: input.count },
        link: "/dashboard/leads",
      },
    ]);
  } catch (err) {
    console.error("[lead-assignment] reassigned, but nobody was told:", err);
  }
}

/** The leads among these whose owner a bulk reassignment actually changes. */
export async function leadsChangingOwner(db: AnyDb, ids: string[], ownerId: string): Promise<number> {
  const rows: { ownerId: string | null }[] = await db
    .select({ ownerId: leads.ownerId })
    .from(leads)
    .where(inArray(leads.id, ids));
  return rows.filter((r) => r.ownerId !== ownerId).length;
}
