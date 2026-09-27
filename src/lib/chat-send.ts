/**
 * Posting a chat message: the one path both the text box and the attachment upload
 * take, so a message with a file is told, counted and marked read exactly like one
 * without.
 *
 * Not a server action on purpose. It trusts its caller for the sender's identity
 * (the action and the upload route both take it from the session), so it must not
 * be callable from a browser with a user id of the caller's choosing.
 */
import { and, eq, inArray, ne } from "drizzle-orm";

import { dmAttachments, dmConversationMembers, dmConversations, dmMessages, notifications } from "@/db/schema";
import { notifyMany } from "@/lib/notify";

// biome-ignore lint/suspicious/noExplicitAny: a tenant handle from getDb or a test database
type Db = any;

export type ChatSender = { id: string; name?: string | null; email?: string | null };

export type ChatAttachmentInput = { storageKey: string; name: string; mimeType: string; size: number };

/** Where a chat notification leads: the conversation itself, opened on the chat page. */
export function conversationLink(conversationId: string) {
  return `/dashboard/chat?c=${conversationId}`;
}

export class NotAMemberError extends Error {
  constructor() {
    super("Not a member");
  }
}

function isMuted(mutedUntil: Date | null): boolean {
  return mutedUntil ? mutedUntil.getTime() > Date.now() : false;
}

export async function postChatMessage(
  db: Db,
  me: ChatSender,
  conversationId: string,
  content: string,
  options: { attachment?: ChatAttachmentInput; mentionIds?: string[] } = {},
) {
  const trimmed = content.trim();
  if (!trimmed && !options.attachment) throw new Error("Empty message");

  const [membership] = await db
    .select({ id: dmConversationMembers.id })
    .from(dmConversationMembers)
    .where(and(eq(dmConversationMembers.conversationId, conversationId), eq(dmConversationMembers.userId, me.id)));
  if (!membership) throw new NotAMemberError();

  const [conv] = await db
    .select({ type: dmConversations.type, name: dmConversations.name })
    .from(dmConversations)
    .where(eq(dmConversations.id, conversationId));

  const now = new Date();
  const [msg] = await db.insert(dmMessages).values({ conversationId, senderId: me.id, content: trimmed }).returning();
  let attachment: typeof dmAttachments.$inferSelect | null = null;
  if (options.attachment) {
    [attachment] = await db
      .insert(dmAttachments)
      .values({ ...options.attachment, messageId: msg.id, conversationId })
      .returning();
  }

  await db.update(dmConversations).set({ updatedAt: now }).where(eq(dmConversations.id, conversationId));
  // ⚠️ Read up to the message just written, by its own timestamp: the database
  // stamped it, and a read mark taken from the app's clock could fall a moment
  // before it and count the sender's own message as unread.
  await db
    .update(dmConversationMembers)
    .set({ lastReadAt: msg.createdAt })
    .where(and(eq(dmConversationMembers.conversationId, conversationId), eq(dmConversationMembers.userId, me.id)));

  const others: { userId: string; mutedUntil: Date | null }[] = await db
    .select({ userId: dmConversationMembers.userId, mutedUntil: dmConversationMembers.mutedUntil })
    .from(dmConversationMembers)
    .where(and(eq(dmConversationMembers.conversationId, conversationId), ne(dmConversationMembers.userId, me.id)));

  // A mention counts only for people actually in the conversation: an id typed
  // into the request by hand cannot reach anybody outside it.
  const inConversation = new Set(others.map((o) => o.userId));
  const mentioned = [...new Set(options.mentionIds ?? [])].filter((id) => inConversation.has(id));
  const mentionedSet = new Set(mentioned);
  // ⚠️ Nobody who muted the conversation is told of an ordinary message — muting
  // hid the badge and still rang the bell on every one. A mention is addressed to
  // one person by name, and reaches them through the mute: that is its purpose.
  const plain = others.filter((o) => !mentionedSet.has(o.userId) && !isMuted(o.mutedUntil)).map((o) => o.userId);

  const told = [...plain, ...mentioned];
  if (told.length > 0) {
    const link = conversationLink(conversationId);
    const senderName = me.name ?? me.email ?? "Someone";
    const text = trimmed || attachment?.name || "";
    const preview = text.length > 60 ? `${text.slice(0, 60)}…` : text;
    try {
      // ⚠️ One notification per conversation, not per message: the previous unread
      // one is replaced by the newest. Ten messages in a row used to be ten rows in
      // the bell, next to a chat badge already counting them, and none of them
      // opened the conversation — the link was empty.
      await db
        .delete(notifications)
        .where(
          and(
            inArray(notifications.userId, told),
            inArray(notifications.type, ["chat_message", "chat_mention"]),
            eq(notifications.link, link),
            eq(notifications.isRead, false),
          ),
        );
      await notifyMany([
        ...plain.map((userId) => ({
          userId,
          type: "chat_message",
          key: "chatMessage" as const,
          params: { sender: senderName, preview },
          link,
        })),
        ...mentioned.map((userId) => ({
          userId,
          type: "chat_mention",
          key: "chatMention" as const,
          params: { sender: senderName, preview, conversation: conv?.name ?? senderName },
          link,
        })),
      ]);
    } catch {
      // The message is sent; a bell that did not ring is not a reason to say otherwise.
    }
  }

  return { ...msg, attachments: attachment ? [attachment] : [] };
}
