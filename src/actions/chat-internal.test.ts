/**
 * The internal chat: what is unread, who is told, and who may erase what.
 *
 * ⚠️⚠️ Four things here were wrong without a sign:
 * - a notification per message, with an empty link, next to a badge already counting them;
 * - muted conversations still rang the bell;
 * - any member of a group could delete it for everyone;
 * - the people picker offered anyone ever seen in the workspace, former members included.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";
import * as schema from "@/db/schema";

const db = drizzle(new PGlite(), { schema });
let me = "anna";
let members = ["anna", "luca", "sara"];

vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: me, name: me === "anna" ? "Anna" : "Luca" } }) }));
vi.mock("@/lib/tenant-context", () => ({ getDb: async () => db, getCurrentTenantId: async () => "t1" }));
vi.mock("@/lib/workspace-members", () => ({ membersWith: async () => members }));
// The real notifier composes the text and pushes; here it only writes the row, which
// is what the collapsing below has to find.
vi.mock("@/lib/notify", () => ({
  notifyMany: async (rows: { userId: string; type: string; link?: string }[]) => {
    for (const r of rows) {
      await db.execute(
        sql`insert into notification (id, user_id, type, title, link) values (${crypto.randomUUID()}, ${r.userId}, ${r.type}, 'Nuovo messaggio', ${r.link ?? null})`,
      );
    }
  },
}));

// An in-memory store, and no plan to run out of: the routes below are about who
// may send and open a file, not about where it lives.
const stored = new Map<string, Uint8Array>();
vi.mock("@/lib/storage", async (actual) => ({
  ...(await actual<typeof import("@/lib/storage")>()),
  getStorage: async () => ({
    name: "memory",
    put: async (key: string, body: Uint8Array) => void stored.set(key, body),
    get: async (key: string) => stored.get(key) ?? null,
    delete: async (key: string) => void stored.delete(key),
  }),
}));
vi.mock("@/lib/auth-guard", () => ({
  EntitlementError: class extends Error {},
  requirePlanLimit: async () => undefined,
}));
vi.mock("@/lib/i18n-server", () => ({ serverT: async () => (key: string) => key }));

const chat = await import("./chat-internal");
const { POST: sendWithFile } = await import("@/app/api/chat/messages/route");
const { GET: openFile } = await import("@/app/api/chat/attachments/[id]/route");
const { NextRequest } = await import("next/server");

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function upload(conversationId: string, content = "", mentionIds: string[] = []) {
  const form = new FormData();
  form.set("conversationId", conversationId);
  form.set("content", content);
  form.set("mentionIds", JSON.stringify(mentionIds));
  form.set("file", new File([PNG], "foto.png", { type: "image/png" }));
  return sendWithFile(new NextRequest("http://flux.test/api/chat/messages", { method: "POST", body: form }));
}

function download(id: string) {
  return openFile(new NextRequest(`http://flux.test/api/chat/attachments/${id}`), {
    params: Promise.resolve({ id }),
  });
}

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  me = "anna";
  members = ["anna", "luca", "sara"];
  stored.clear();
  await db.execute(sql`delete from notification`);
  await db.execute(sql`delete from dm_conversation`);
  await db.execute(sql`delete from "user"`);
  await db.execute(
    sql`insert into "user" (id, name, email) values ('anna','Anna','a@x.it'), ('luca','Luca','l@x.it'), ('sara','Sara','s@x.it'), ('ex','Ex collega','ex@x.it')`,
  );
});

async function group(id: string, who: string[]) {
  await db.execute(sql`insert into dm_conversation (id, type, name) values (${id}, 'group', 'Vendite')`);
  for (const u of who) {
    await db.execute(
      sql`insert into dm_conversation_member (id, conversation_id, user_id) values (${crypto.randomUUID()}, ${id}, ${u})`,
    );
  }
}

async function bell(userId: string) {
  const rows = await db.execute(
    sql`select link, is_read from notification where user_id = ${userId} and type = 'chat_message'`,
  );
  return rows.rows as { link: string; is_read: boolean }[];
}

describe("unread counts", () => {
  it("counts the other people's messages since I last read, per conversation and in total", async () => {
    const conv = await chat.getOrCreateDirectConversation("luca");
    me = "luca";
    await chat.sendMessage(conv.id, "Ciao");
    await chat.sendMessage(conv.id, "Ci sei?");
    me = "anna";
    expect(await chat.getTotalUnreadCount()).toBe(2);
    expect((await chat.getConversations())[0].unread).toBe(2);
    await chat.markConversationRead(conv.id);
    expect(await chat.getTotalUnreadCount()).toBe(0);
  });

  it("does not count my own messages", async () => {
    const conv = await chat.getOrCreateDirectConversation("luca");
    await chat.sendMessage(conv.id, "Ciao");
    expect(await chat.getTotalUnreadCount()).toBe(0);
  });

  it("counts nothing in a muted conversation", async () => {
    const conv = await chat.getOrCreateDirectConversation("luca");
    await chat.muteConversation(conv.id, 60);
    me = "luca";
    await chat.sendMessage(conv.id, "Ciao");
    me = "anna";
    expect(await chat.getTotalUnreadCount()).toBe(0);
  });
});

describe("⚠️⚠️ the bell", () => {
  it("rings once per conversation, linked to it, however many messages arrive", async () => {
    const conv = await chat.getOrCreateDirectConversation("luca");
    await chat.sendMessage(conv.id, "Uno");
    await chat.sendMessage(conv.id, "Due");
    await chat.sendMessage(conv.id, "Tre");
    expect(await bell("luca")).toEqual([{ link: `/dashboard/chat?c=${conv.id}`, is_read: false }]);
    expect(await bell("anna")).toEqual([]);
  });

  it("is answered by reading the conversation", async () => {
    const conv = await chat.getOrCreateDirectConversation("luca");
    await chat.sendMessage(conv.id, "Uno");
    me = "luca";
    await chat.markConversationRead(conv.id);
    expect(await bell("luca")).toEqual([{ link: `/dashboard/chat?c=${conv.id}`, is_read: true }]);
  });

  it("stays silent for whoever muted the conversation", async () => {
    const conv = await chat.getOrCreateDirectConversation("luca");
    me = "luca";
    await chat.muteConversation(conv.id, 60);
    me = "anna";
    await chat.sendMessage(conv.id, "Uno");
    expect(await bell("luca")).toEqual([]);
  });
});

describe("⚠️⚠️ who may erase what", () => {
  it("refuses to delete a group: a member leaves it instead", async () => {
    await group("g1", ["anna", "luca", "sara"]);
    await expect(chat.deleteConversation("g1")).rejects.toThrow();
    await chat.leaveConversation("g1");
    const left = await db.execute(sql`select user_id from dm_conversation_member where conversation_id = 'g1'`);
    expect((left.rows as { user_id: string }[]).map((r) => r.user_id).sort()).toEqual(["luca", "sara"]);
  });

  it("deletes a group when its last member leaves", async () => {
    await group("g1", ["anna"]);
    await chat.leaveConversation("g1");
    const rows = await db.execute(sql`select id from dm_conversation where id = 'g1'`);
    expect(rows.rows).toEqual([]);
  });

  it("refuses to touch a conversation I am not in", async () => {
    await group("g1", ["luca", "sara"]);
    await expect(chat.leaveConversation("g1")).rejects.toThrow();
    await expect(chat.getMessages("g1")).rejects.toThrow();
    await expect(chat.sendMessage("g1", "Ciao")).rejects.toThrow();
  });
});

describe("⚠️ the people", () => {
  it("offers only the workspace's current members", async () => {
    const people = await chat.getChatUsers();
    expect(people.map((u) => u.id).sort()).toEqual(["luca", "sara"]);
  });

  it("will not open a conversation with someone who is not a member", async () => {
    await expect(chat.getOrCreateDirectConversation("ex")).rejects.toThrow();
  });

  it("reuses the direct conversation instead of opening a second one", async () => {
    const a = await chat.getOrCreateDirectConversation("luca");
    const b = await chat.getOrCreateDirectConversation("luca");
    expect(b.id).toBe(a.id);
  });
});

async function told(userId: string) {
  const rows = await db.execute(sql`select type from notification where user_id = ${userId}`);
  return (rows.rows as { type: string }[]).map((r) => r.type);
}

describe("⚠️⚠️ mentions", () => {
  it("reach the person named, through a mute, as a mention — and the others as a message", async () => {
    await group("g1", ["anna", "luca", "sara"]);
    me = "luca";
    await chat.muteConversation("g1", 60);
    me = "anna";
    await chat.sendMessage("g1", "@Luca guarda qui", ["luca"]);
    expect(await told("luca")).toEqual(["chat_mention"]);
    expect(await told("sara")).toEqual(["chat_message"]);
  });

  it("reach nobody outside the conversation, whatever id is sent", async () => {
    await group("g1", ["anna", "luca"]);
    await chat.sendMessage("g1", "@Ex ciao", ["ex", "sara"]);
    expect(await told("ex")).toEqual([]);
    expect(await told("sara")).toEqual([]);
    expect(await told("luca")).toEqual(["chat_message"]);
  });
});

describe("⚠️⚠️ files in the chat", () => {
  it("are sent as a message, told like one, and listed with it", async () => {
    await group("g1", ["anna", "luca"]);
    const res = await upload("g1", "", ["luca"]);
    expect(res.status).toBe(200);
    expect(await told("luca")).toEqual(["chat_mention"]);
    const [msg] = await chat.getMessages("g1");
    expect(msg.attachments.map((a) => [a.name, a.mimeType, a.size])).toEqual([["foto.png", "image/png", PNG.length]]);
    expect(stored.size).toBe(1);
  });

  it("open for the conversation's members and for nobody else, not even someone who left", async () => {
    await group("g1", ["anna", "luca", "sara"]);
    await upload("g1");
    const [msg] = await chat.getMessages("g1");
    const id = msg.attachments[0].id;

    expect((await download(id)).status).toBe(200);
    me = "ex";
    expect((await download(id)).status).toBe(404);
    me = "sara";
    await chat.leaveConversation("g1");
    expect((await download(id)).status).toBe(404);
    me = "luca";
    const res = await download(id);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment;/);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("are refused from someone outside the conversation, leaving no bytes behind", async () => {
    await group("g1", ["luca", "sara"]);
    expect((await upload("g1")).status).toBe(403);
    expect(stored.size).toBe(0);
  });

  it("take their bytes with them when the conversation goes", async () => {
    const conv = await chat.getOrCreateDirectConversation("luca");
    await upload(conv.id);
    expect(stored.size).toBe(1);
    await chat.deleteConversation(conv.id);
    expect(stored.size).toBe(0);
  });
});
