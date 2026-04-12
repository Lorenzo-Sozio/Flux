"use server"

import { db } from "@/db"
import { userGroups, userGroupMembers, users } from "@/db/schema"
import { eq, desc, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { requireAdminAccess, requireWriteAccess } from "@/lib/auth-guard"
import { z } from "zod"

// ─── Schemas ──────────────────────────────────────────────────────────────────

const UserGroupFormSchema = z.object({
  name:        z.string().min(1, "Name is required").max(100),
  description: z.string().max(255).optional(),
  color:       z.string().regex(/^#[0-9a-fA-F]{6}$/, "Invalid color").default("#6366f1"),
  memberIds:   z.array(z.string()).default([]),
})

export type UserGroupFormData = z.infer<typeof UserGroupFormSchema>

// ─── Read ──────────────────────────────────────────────────────────────────────

/**
 * Full group list with member details (for management UI)
 */
export async function getUserGroups() {
  await requireWriteAccess()

  const groups = await db.select().from(userGroups).orderBy(desc(userGroups.createdAt))

  const membersRows = await db
    .select({
      groupId:  userGroupMembers.groupId,
      userId:   users.id,
      userName: users.name,
      userEmail: users.email,
    })
    .from(userGroupMembers)
    .innerJoin(users, eq(userGroupMembers.userId, users.id))

  const membersByGroup: Record<string, { id: string; name: string | null; email: string | null }[]> = {}
  for (const row of membersRows) {
    if (!membersByGroup[row.groupId]) membersByGroup[row.groupId] = []
    membersByGroup[row.groupId].push({ id: row.userId, name: row.userName, email: row.userEmail })
  }

  return groups.map((g) => ({
    ...g,
    members: membersByGroup[g.id] ?? [],
    memberCount: (membersByGroup[g.id] ?? []).length,
  }))
}

/**
 * Lightweight list for dropdowns — includes memberCount but not full member data.
 */
export async function getGroupsForSelect() {
  await requireWriteAccess()

  const rows = await db
    .select({
      id:    userGroups.id,
      name:  userGroups.name,
      color: userGroups.color,
      memberCount: sql<number>`(
        SELECT COUNT(*)::int FROM user_group_member
        WHERE user_group_member.group_id = ${userGroups.id}
      )`,
    })
    .from(userGroups)
    .orderBy(userGroups.name)

  return rows
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createUserGroup(data: UserGroupFormData) {
  await requireAdminAccess()

  const parsed = UserGroupFormSchema.safeParse(data)
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? "Invalid data" }
  }

  const { name, description, color, memberIds } = parsed.data

  const [group] = await db
    .insert(userGroups)
    .values({ name, description: description ?? null, color })
    .returning()

  if (memberIds.length > 0) {
    await db.insert(userGroupMembers).values(
      memberIds.map((userId) => ({ groupId: group.id, userId })),
    )
  }

  revalidatePath("/dashboard/users")
  return { success: true, id: group.id }
}

// ─── Update ───────────────────────────────────────────────────────────────────

export async function updateUserGroup(id: string, data: UserGroupFormData) {
  await requireAdminAccess()

  const parsed = UserGroupFormSchema.safeParse(data)
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? "Invalid data" }
  }

  const { name, description, color, memberIds } = parsed.data

  await db
    .update(userGroups)
    .set({ name, description: description ?? null, color, updatedAt: new Date() })
    .where(eq(userGroups.id, id))

  // Sync members: delete all, re-insert current
  await db.delete(userGroupMembers).where(eq(userGroupMembers.groupId, id))

  if (memberIds.length > 0) {
    await db.insert(userGroupMembers).values(
      memberIds.map((userId) => ({ groupId: id, userId })),
    )
  }

  revalidatePath("/dashboard/users")
  return { success: true }
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function deleteUserGroup(id: string) {
  await requireAdminAccess()
  await db.delete(userGroups).where(eq(userGroups.id, id))
  revalidatePath("/dashboard/users")
  return { success: true }
}
