"use server";

import { revalidatePath } from "next/cache";

import { and, asc, eq } from "drizzle-orm";

import { dealComments, users } from "@/db/schema";
import { requireCapability, requireWriteAccess } from "@/lib/auth-guard";
import { can } from "@/lib/permissions";
import { assertCanSee } from "@/lib/record-visibility";
import { getDb } from "@/lib/tenant-context";

export type DealComment = {
  id: string;
  dealId: string;
  userId: string;
  content: string;
  parentId: string | null;
  editedAt: Date | null;
  createdAt: Date;
  userName: string | null;
  userImage: string | null;
};

/** A comment is the deal's: refused on a deal the person cannot see, whatever `dealId` the caller named. */
async function assertCommentVisible(db: Awaited<ReturnType<typeof getDb>>, commentId: string): Promise<void> {
  const [row] = await db
    .select({ dealId: dealComments.dealId })
    .from(dealComments)
    .where(eq(dealComments.id, commentId));
  if (row) await assertCanSee("deal", row.dealId);
}

export async function getDealComments(dealId: string): Promise<DealComment[]> {
  // Reading a discussion is not writing to it. Demanding write here meant a
  // viewer opening any deal met a raw error, on a page the guard admits them to.
  await requireCapability("record:read");
  await assertCanSee("deal", dealId);
  const db = await getDb();
  const rows = await db
    .select({
      id: dealComments.id,
      dealId: dealComments.dealId,
      userId: dealComments.userId,
      content: dealComments.content,
      parentId: dealComments.parentId,
      editedAt: dealComments.editedAt,
      createdAt: dealComments.createdAt,
      userName: users.name,
      userImage: users.image,
    })
    .from(dealComments)
    .leftJoin(users, eq(dealComments.userId, users.id))
    .where(eq(dealComments.dealId, dealId))
    .orderBy(asc(dealComments.createdAt));
  return rows;
}

export async function addDealComment(dealId: string, content: string, parentId?: string) {
  const session = await requireWriteAccess();
  await assertCanSee("deal", dealId);
  const db = await getDb();
  if (!content.trim()) throw new Error("Comment cannot be empty");
  await db.insert(dealComments).values({
    dealId,
    userId: session.user.id,
    content: content.trim(),
    parentId,
  });
  revalidatePath(`/dashboard/pipeline/${dealId}`);
}

export async function editDealComment(commentId: string, content: string, dealId: string) {
  const session = await requireWriteAccess();
  const db = await getDb();
  await assertCommentVisible(db, commentId);
  if (!content.trim()) throw new Error("Comment cannot be empty");
  const updated = await db
    .update(dealComments)
    .set({ content: content.trim(), editedAt: new Date() })
    .where(and(eq(dealComments.id, commentId), eq(dealComments.userId, session.user.id)))
    .returning({ id: dealComments.id });
  if (updated.length === 0) throw new Error("Comment not found or unauthorized");
  revalidatePath(`/dashboard/pipeline/${dealId}`);
}

export async function deleteDealComment(commentId: string, dealId: string) {
  const session = await requireWriteAccess();
  const db = await getDb();
  await assertCommentVisible(db, commentId);
  // The workspace role, not the platform staff field: `session.user.role` is
  // "user" for every customer, so a workspace admin could never remove anybody
  // else's comment (audit rilievo P-01, in a corner the fix did not reach).
  const isPrivileged = can(session.user.role, "user:read");
  const deleted = await db
    .delete(dealComments)
    .where(
      isPrivileged
        ? eq(dealComments.id, commentId)
        : and(eq(dealComments.id, commentId), eq(dealComments.userId, session.user.id)),
    )
    .returning({ id: dealComments.id });
  if (deleted.length === 0) throw new Error("Comment not found or unauthorized");
  revalidatePath(`/dashboard/pipeline/${dealId}`);
}
