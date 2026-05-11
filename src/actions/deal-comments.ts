"use server";

import { getDb } from "@/lib/tenant-context";
import { dealComments, users } from "@/db/schema";
import { eq, asc, and, or } from "drizzle-orm";
import { requireWriteAccess } from "@/lib/auth-guard";
import { revalidatePath } from "next/cache";

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

export async function getDealComments(dealId: string): Promise<DealComment[]> {
  await requireWriteAccess();
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
 const db = await getDb();
  if (!content.trim()) throw new Error("Comment cannot be empty");
  await db.insert(dealComments).values({
    dealId,
    userId: session.user.id!,
    content: content.trim(),
    parentId,
  });
  revalidatePath(`/dashboard/pipeline/${dealId}`);
}

export async function editDealComment(commentId: string, content: string, dealId: string) {
  const session = await requireWriteAccess();
 const db = await getDb();
  if (!content.trim()) throw new Error("Comment cannot be empty");
  const updated = await db
    .update(dealComments)
    .set({ content: content.trim(), editedAt: new Date() })
    .where(and(eq(dealComments.id, commentId), eq(dealComments.userId, session.user.id!)))
    .returning({ id: dealComments.id });
  if (updated.length === 0) throw new Error("Comment not found or unauthorized");
  revalidatePath(`/dashboard/pipeline/${dealId}`);
}

export async function deleteDealComment(commentId: string, dealId: string) {
  const session = await requireWriteAccess();
 const db = await getDb();
  const isPrivileged = session.user.role === "admin" || session.user.role === "owner";
  const deleted = await db
    .delete(dealComments)
    .where(
      isPrivileged
        ? eq(dealComments.id, commentId)
        : and(eq(dealComments.id, commentId), eq(dealComments.userId, session.user.id!)),
    )
    .returning({ id: dealComments.id });
  if (deleted.length === 0) throw new Error("Comment not found or unauthorized");
  revalidatePath(`/dashboard/pipeline/${dealId}`);
}
