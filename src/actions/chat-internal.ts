"use server";

import { auth } from "@/auth";
import { getDb } from "@/lib/tenant-context";
import {
  dmConversations,
  dmConversationMembers,
  dmMessages,
  users,
} from "@/db/schema";
import { and, desc, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";
import { createNotificationAction } from "@/actions/auth";

type SessionUser = { id: string; name?: string | null; email?: string | null };

async function requireSession(): Promise<SessionUser> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  return session.user as SessionUser;
}

function isMuted(mutedUntil: Date | null): boolean {
  if (!mutedUntil) return false;
  return mutedUntil.getTime() > Date.now();
}

// ── Conversations list ────────────────────────────────────────────────────────

export async function getConversations() {
  const db = await getDb();
  const me = await requireSession();

  const myMemberships = await db
    .select({
      conversationId: dmConversationMembers.conversationId,
      lastReadAt:     dmConversationMembers.lastReadAt,
      mutedUntil:     dmConversationMembers.mutedUntil,
    })
    .from(dmConversationMembers)
    .where(eq(dmConversationMembers.userId, me.id));

  if (myMemberships.length === 0) return [];

  const convIds = myMemberships.map((m) => m.conversationId);
  const memberMap = new Map(myMemberships.map((m) => [m.conversationId, m]));

  const convos = await db.query.dmConversations.findMany({
    where:   inArray(dmConversations.id, convIds),
    orderBy: desc(dmConversations.updatedAt),
    with: {
      members:  { with: { user: true } },
      messages: { orderBy: desc(dmMessages.createdAt), limit: 1 },
    },
  });

  const result = await Promise.all(
    convos.map(async (c) => {
      const m = memberMap.get(c.id)!;
      const muted = isMuted(m.mutedUntil ?? null);

      let unread = 0;
      if (!muted) {
        const baseWhere = and(
          eq(dmMessages.conversationId, c.id),
          sql`${dmMessages.senderId} IS DISTINCT FROM ${me.id}`,
        );
        const where = m.lastReadAt ? and(baseWhere, gt(dmMessages.createdAt, m.lastReadAt)) : baseWhere;
        const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(dmMessages).where(where);
        unread = row?.count ?? 0;
      }

      return { ...c, unread, muted, mutedUntil: m.mutedUntil ?? null };
    }),
  );

  return result;
}

// ── Total unread badge ────────────────────────────────────────────────────────

export async function getTotalUnreadCount(): Promise<number> {
  const db = await getDb();
  const me = await requireSession();

  const memberships = await db
    .select({
      conversationId: dmConversationMembers.conversationId,
      lastReadAt:     dmConversationMembers.lastReadAt,
      mutedUntil:     dmConversationMembers.mutedUntil,
    })
    .from(dmConversationMembers)
    .where(eq(dmConversationMembers.userId, me.id));

  let total = 0;
  for (const m of memberships) {
    if (isMuted(m.mutedUntil ?? null)) continue;
    const baseWhere = and(
      eq(dmMessages.conversationId, m.conversationId),
      sql`${dmMessages.senderId} IS DISTINCT FROM ${me.id}`,
    );
    const where = m.lastReadAt ? and(baseWhere, gt(dmMessages.createdAt, m.lastReadAt)) : baseWhere;
    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(dmMessages).where(where);
    total += row?.count ?? 0;
  }
  return total;
}

// ── Get or create direct conversation ─────────────────────────────────────────

export async function getOrCreateDirectConversation(otherUserId: string) {
  const db = await getDb();
  const me = await requireSession();
  if (me.id === otherUserId) throw new Error("Cannot DM yourself");

  const myConvIds = await db
    .select({ conversationId: dmConversationMembers.conversationId })
    .from(dmConversationMembers)
    .where(eq(dmConversationMembers.userId, me.id))
    .then((r) => r.map((x) => x.conversationId));

  if (myConvIds.length > 0) {
    const shared = await db
      .select({ conversationId: dmConversationMembers.conversationId })
      .from(dmConversationMembers)
      .where(
        and(
          inArray(dmConversationMembers.conversationId, myConvIds),
          eq(dmConversationMembers.userId, otherUserId),
        ),
      );

    for (const { conversationId } of shared) {
      const conv = await db.query.dmConversations.findFirst({
        where: and(eq(dmConversations.id, conversationId), eq(dmConversations.type, "direct")),
        with: { members: true },
      });
      if (conv && conv.members.length === 2) return conv;
    }
  }

  const [conv] = await db.insert(dmConversations).values({ type: "direct" }).returning();
  await db.insert(dmConversationMembers).values([
    { conversationId: conv.id, userId: me.id },
    { conversationId: conv.id, userId: otherUserId },
  ]);
  return conv;
}

// ── Create group conversation ─────────────────────────────────────────────────

export async function createGroupConversation(name: string, memberIds: string[]) {
  const db = await getDb();
  const me = await requireSession();
  const allIds = Array.from(new Set([me.id, ...memberIds]));
  if (allIds.length < 2) throw new Error("Group needs at least 2 members");

  const [conv] = await db.insert(dmConversations).values({ type: "group", name }).returning();
  await db.insert(dmConversationMembers).values(
    allIds.map((userId) => ({ conversationId: conv.id, userId })),
  );
  return conv;
}

// ── Get messages ──────────────────────────────────────────────────────────────

export async function getMessages(conversationId: string, before?: string) {
  const db = await getDb();
  const me = await requireSession();

  const membership = await db.query.dmConversationMembers.findFirst({
    where: and(eq(dmConversationMembers.conversationId, conversationId), eq(dmConversationMembers.userId, me.id)),
  });
  if (!membership) throw new Error("Not a member");

  const msgs = await db.query.dmMessages.findMany({
    where: before
      ? and(eq(dmMessages.conversationId, conversationId), lt(dmMessages.createdAt, new Date(before)))
      : eq(dmMessages.conversationId, conversationId),
    orderBy: desc(dmMessages.createdAt),
    limit: 50,
    with: { sender: true },
  });

  return msgs.reverse();
}

// ── Send message ──────────────────────────────────────────────────────────────

export async function sendMessage(conversationId: string, content: string) {
  const db = await getDb();
  const me = await requireSession();
  const trimmed = content.trim();
  if (!trimmed) throw new Error("Empty message");

  const membership = await db.query.dmConversationMembers.findFirst({
    where: and(eq(dmConversationMembers.conversationId, conversationId), eq(dmConversationMembers.userId, me.id)),
  });
  if (!membership) throw new Error("Not a member");

  const now = new Date();
  const [msg] = await db.insert(dmMessages).values({ conversationId, senderId: me.id, content: trimmed }).returning();

  await db.update(dmConversations).set({ updatedAt: now }).where(eq(dmConversations.id, conversationId));
  await db
    .update(dmConversationMembers)
    .set({ lastReadAt: now })
    .where(and(eq(dmConversationMembers.conversationId, conversationId), eq(dmConversationMembers.userId, me.id)));

  const otherMembers = await db
    .select({ userId: dmConversationMembers.userId })
    .from(dmConversationMembers)
    .where(and(eq(dmConversationMembers.conversationId, conversationId), ne(dmConversationMembers.userId, me.id)));

  const senderName = me.name ?? me.email ?? "Someone";
  const preview    = trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed;

  for (const { userId } of otherMembers) {
    createNotificationAction({
      userId,
      type:    "chat_message",
      title:   `New message from ${senderName}`,
      message: preview,
      link:    undefined,
    }).catch(() => {});
  }

  return msg;
}

// ── Mark read ─────────────────────────────────────────────────────────────────

export async function markConversationRead(conversationId: string) {
  const db = await getDb();
  const me = await requireSession();
  await db
    .update(dmConversationMembers)
    .set({ lastReadAt: new Date() })
    .where(and(eq(dmConversationMembers.conversationId, conversationId), eq(dmConversationMembers.userId, me.id)));
}

// ── Mute / unmute ─────────────────────────────────────────────────────────────

export async function muteConversation(conversationId: string, minutes: number | null) {
  const db = await getDb();
  const me = await requireSession();
  const mutedUntil = minutes === null ? null : new Date(Date.now() + minutes * 60_000);
  await db
    .update(dmConversationMembers)
    .set({ mutedUntil })
    .where(and(eq(dmConversationMembers.conversationId, conversationId), eq(dmConversationMembers.userId, me.id)));
}

// ── Leave group ───────────────────────────────────────────────────────────────

export async function leaveConversation(conversationId: string) {
  const db = await getDb();
  const me = await requireSession();
  await db
    .delete(dmConversationMembers)
    .where(and(eq(dmConversationMembers.conversationId, conversationId), eq(dmConversationMembers.userId, me.id)));
}

// ── Delete conversation ───────────────────────────────────────────────────────

export async function deleteConversation(conversationId: string) {
  const db = await getDb();
  const me = await requireSession();

  // Verify membership before deleting
  const membership = await db.query.dmConversationMembers.findFirst({
    where: and(eq(dmConversationMembers.conversationId, conversationId), eq(dmConversationMembers.userId, me.id)),
  });
  if (!membership) throw new Error("Not a member");

  // Cascade deletes members + messages automatically
  await db.delete(dmConversations).where(eq(dmConversations.id, conversationId));
}

// ── Users picker ──────────────────────────────────────────────────────────────

export async function getChatUsers() {
  const db = await getDb();
  const me = await requireSession();
  return db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(ne(users.id, me.id))
    .orderBy(users.name);
}
