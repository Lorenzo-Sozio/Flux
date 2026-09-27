"use server";

import { and, desc, eq, inArray, lt, ne, sql } from "drizzle-orm";

import { auth } from "@/auth";
import { dmAttachments, dmConversationMembers, dmConversations, dmMessages, notifications, users } from "@/db/schema";
import { conversationLink, postChatMessage } from "@/lib/chat-send";
import { getStorage } from "@/lib/storage";
import { getCurrentTenantId, getDb } from "@/lib/tenant-context";
import { USER_SUMMARY_COLUMNS } from "@/lib/user-columns";
import { membersWith } from "@/lib/workspace-members";

/** The bell rows the chat writes: an ordinary message, and a mention by name. */
const CHAT_TYPES = ["chat_message", "chat_mention"];

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

/**
 * The people who belong to this workspace now.
 *
 * ⚠️ From the platform registry, not the workspace's own `user` table. That table
 * is a copy the dashboard writes on each visit and nothing prunes (see
 * src/lib/workspace-members.ts): the "new message" picker offered people who had
 * left the workspace, and a conversation could be opened with anyone whose id was
 * in it. `null` when there is no workspace to ask about — a script or a test —
 * which filters nothing.
 */
async function currentMemberIds(): Promise<Set<string> | null> {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) return null;
  return new Set(await membersWith(tenantId, "record:read"));
}

async function requireMembers(ids: string[]) {
  const members = await currentMemberIds();
  if (members && ids.some((id) => !members.has(id))) throw new Error("Not a member of this workspace");
}

/**
 * Unread messages per conversation for one person, in ONE statement.
 *
 * ⚠️ It was one count per conversation, run by the badge poll every thirty
 * seconds on every open tab: someone in twenty conversations cost twenty-one
 * queries a poll, and every query wakes the database (CLAUDE.md, "the frequency
 * of these is a database bill"). A muted conversation counts nothing, as before.
 */
async function unreadByConversation(db: Awaited<ReturnType<typeof getDb>>, userId: string) {
  const rows = await db
    .select({
      conversationId: dmConversationMembers.conversationId,
      unread: sql<number>`count(${dmMessages.id})::int`,
    })
    .from(dmConversationMembers)
    .leftJoin(
      dmMessages,
      and(
        eq(dmMessages.conversationId, dmConversationMembers.conversationId),
        sql`${dmMessages.senderId} IS DISTINCT FROM ${dmConversationMembers.userId}`,
        sql`(${dmConversationMembers.lastReadAt} IS NULL OR ${dmMessages.createdAt} > ${dmConversationMembers.lastReadAt})`,
      ),
    )
    .where(
      and(
        eq(dmConversationMembers.userId, userId),
        // Compared with the app's clock, which is the clock that wrote `mutedUntil`.
        sql`(${dmConversationMembers.mutedUntil} IS NULL OR ${dmConversationMembers.mutedUntil} <= ${new Date()})`,
      ),
    )
    .groupBy(dmConversationMembers.conversationId);
  return new Map(rows.map((r) => [r.conversationId, Number(r.unread)]));
}

// ── Conversations list ────────────────────────────────────────────────────────

export async function getConversations() {
  const db = await getDb();
  const me = await requireSession();

  const myMemberships = await db
    .select({
      conversationId: dmConversationMembers.conversationId,
      lastReadAt: dmConversationMembers.lastReadAt,
      mutedUntil: dmConversationMembers.mutedUntil,
    })
    .from(dmConversationMembers)
    .where(eq(dmConversationMembers.userId, me.id));

  if (myMemberships.length === 0) return [];

  const convIds = myMemberships.map((m) => m.conversationId);
  const memberMap = new Map(myMemberships.map((m) => [m.conversationId, m]));

  const [convos, unread] = await Promise.all([
    db.query.dmConversations.findMany({
      where: inArray(dmConversations.id, convIds),
      orderBy: desc(dmConversations.updatedAt),
      with: {
        members: { with: { user: { columns: USER_SUMMARY_COLUMNS } } },
        // The file's name is the preview of a message that is only a file.
        messages: {
          orderBy: desc(dmMessages.createdAt),
          limit: 1,
          with: { attachments: { columns: { name: true } } },
        },
      },
    }),
    unreadByConversation(db, me.id),
  ]);

  return convos.map((c) => {
    const m = memberMap.get(c.id);
    const mutedUntil = m?.mutedUntil ?? null;
    return { ...c, unread: unread.get(c.id) ?? 0, muted: isMuted(mutedUntil), mutedUntil };
  });
}

// ── Total unread badge ────────────────────────────────────────────────────────

export async function getTotalUnreadCount(): Promise<number> {
  const db = await getDb();
  const me = await requireSession();
  let total = 0;
  for (const n of (await unreadByConversation(db, me.id)).values()) total += n;
  return total;
}

// ── Get or create direct conversation ─────────────────────────────────────────

export async function getOrCreateDirectConversation(otherUserId: string) {
  const db = await getDb();
  const me = await requireSession();
  if (me.id === otherUserId) throw new Error("Cannot DM yourself");
  await requireMembers([otherUserId]);

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
        and(inArray(dmConversationMembers.conversationId, myConvIds), eq(dmConversationMembers.userId, otherUserId)),
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
  await requireMembers(allIds.filter((id) => id !== me.id));

  // The id is made here rather than read back, so the conversation and the people
  // in it are one commit. A group nobody belongs to cannot be opened, cannot be
  // left, and does not appear anywhere it could be deleted from (rilievo M-04).
  const id = crypto.randomUUID();
  const now = new Date();
  await db.batch([
    db.insert(dmConversations).values({ id, type: "group", name }),
    db.insert(dmConversationMembers).values(allIds.map((userId) => ({ conversationId: id, userId }))),
  ]);
  return { id, type: "group" as const, name, createdAt: now, updatedAt: now };
}

// ── Get messages ──────────────────────────────────────────────────────────────

/** The page size of a conversation's history: the newest fifty, then fifty more on request. */
const MESSAGE_PAGE = 50;

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
    limit: MESSAGE_PAGE,
    with: { sender: { columns: USER_SUMMARY_COLUMNS }, attachments: true },
  });

  return msgs.reverse();
}

// ── Send message ──────────────────────────────────────────────────────────────

export async function sendMessage(conversationId: string, content: string, mentionIds: string[] = []) {
  const db = await getDb();
  const me = await requireSession();
  // One path for every message, text or file: src/lib/chat-send.ts.
  return postChatMessage(db, me, conversationId, content, { mentionIds });
}

// ── Mark read ─────────────────────────────────────────────────────────────────

export async function markConversationRead(conversationId: string) {
  const db = await getDb();
  const me = await requireSession();
  // ⚠️ Read up to the newest message by the database's own timestamp, not up to
  // "now" on the app's clock: messages are stamped by the database, and a clock a
  // few milliseconds (or, between two machines, seconds) behind left the latest
  // ones counted as unread after the conversation had been read.
  await db
    .update(dmConversationMembers)
    .set({
      lastReadAt: sql`coalesce((select max(${dmMessages.createdAt}) from ${dmMessages} where ${dmMessages.conversationId} = ${conversationId}), ${new Date()})`,
    })
    .where(and(eq(dmConversationMembers.conversationId, conversationId), eq(dmConversationMembers.userId, me.id)));
  // Reading the conversation answers its notification too, so the bell and the
  // chat badge do not disagree about what is still unread.
  await db
    .update(notifications)
    .set({ isRead: true })
    .where(
      and(
        eq(notifications.userId, me.id),
        inArray(notifications.type, CHAT_TYPES),
        eq(notifications.link, conversationLink(conversationId)),
        eq(notifications.isRead, false),
      ),
    );
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

/**
 * The stored bytes of a conversation's attachments, removed before its rows go.
 * The rows cascade with the conversation; the objects in storage would not, and
 * unreferenced bytes are cost with nothing left that can reach them.
 */
async function deleteStoredAttachments(db: Awaited<ReturnType<typeof getDb>>, conversationId: string) {
  const files = await db
    .select({ key: dmAttachments.storageKey })
    .from(dmAttachments)
    .where(eq(dmAttachments.conversationId, conversationId));
  if (files.length === 0) return;
  try {
    const storage = await getStorage();
    await Promise.all(files.map((f) => storage.delete(f.key).catch(() => undefined)));
  } catch (err) {
    console.error("[chat] could not remove attachment bytes", err);
  }
}

// ── Leave / delete ────────────────────────────────────────────────────────────

/**
 * Leaving a group takes it out of MY list; the group is deleted only when the last
 * person leaves.
 */
export async function leaveConversation(conversationId: string) {
  const db = await getDb();
  const me = await requireSession();

  const membership = await db.query.dmConversationMembers.findFirst({
    where: and(eq(dmConversationMembers.conversationId, conversationId), eq(dmConversationMembers.userId, me.id)),
  });
  if (!membership) throw new Error("Not a member");

  await db
    .delete(dmConversationMembers)
    .where(and(eq(dmConversationMembers.conversationId, conversationId), eq(dmConversationMembers.userId, me.id)));
  await db
    .delete(notifications)
    .where(
      and(
        eq(notifications.userId, me.id),
        inArray(notifications.type, CHAT_TYPES),
        eq(notifications.link, conversationLink(conversationId)),
      ),
    );

  const [left] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(dmConversationMembers)
    .where(eq(dmConversationMembers.conversationId, conversationId));
  // Messages and memberships cascade with the conversation.
  if (Number(left?.n ?? 0) === 0) {
    await deleteStoredAttachments(db, conversationId);
    await db.delete(dmConversations).where(eq(dmConversations.id, conversationId));
  }
}

/**
 * Deletes a DIRECT conversation, for both people in it — which the confirmation says.
 *
 * ⚠️⚠️ Never a group. "Delete" used to work on groups too, so any member could erase
 * a whole group's history for everyone else in it. A group is left, not deleted,
 * and it disappears when its last member leaves.
 */
export async function deleteConversation(conversationId: string) {
  const db = await getDb();
  const me = await requireSession();

  const membership = await db.query.dmConversationMembers.findFirst({
    where: and(eq(dmConversationMembers.conversationId, conversationId), eq(dmConversationMembers.userId, me.id)),
  });
  if (!membership) throw new Error("Not a member");

  const [conv] = await db
    .select({ type: dmConversations.type })
    .from(dmConversations)
    .where(eq(dmConversations.id, conversationId));
  if (conv?.type !== "direct") throw new Error("A group is left, not deleted");

  await db
    .delete(notifications)
    .where(and(inArray(notifications.type, CHAT_TYPES), eq(notifications.link, conversationLink(conversationId))));
  // Members, messages and attachment rows cascade with the conversation.
  await deleteStoredAttachments(db, conversationId);
  await db.delete(dmConversations).where(eq(dmConversations.id, conversationId));
}

// ── Users picker ──────────────────────────────────────────────────────────────

export async function getChatUsers() {
  const db = await getDb();
  const me = await requireSession();
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(ne(users.id, me.id))
    .orderBy(users.name);
  const members = await currentMemberIds();
  return members ? rows.filter((u) => members.has(u.id)) : rows;
}
