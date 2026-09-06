"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  BellOff,
  Edit,
  LogOut,
  MessageCircle,
  MoreVertical,
  Plus,
  Search,
  Send,
  Trash2,
  Users,
  Volume2,
} from "lucide-react";
import { useTranslations } from "next-intl";

import {
  createGroupConversation,
  deleteConversation,
  getChatUsers,
  getConversations,
  getMessages,
  getOrCreateDirectConversation,
  leaveConversation,
  markConversationRead,
  muteConversation,
  sendMessage,
} from "@/actions/chat-internal";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLivePoll } from "@/hooks/use-live-poll";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type ConvMember = {
  id: string;
  userId: string;
  user: { id: string; name: string | null; email: string | null };
};

type Conversation = {
  id: string;
  type: string;
  name: string | null;
  updatedAt: Date;
  members: ConvMember[];
  messages: { id: string; content: string; senderId: string | null; createdAt: Date }[];
  unread: number;
  muted: boolean;
  mutedUntil: Date | null;
};

type Message = {
  id: string;
  content: string;
  senderId: string | null;
  createdAt: Date;
  sender: { id: string; name: string | null; email: string | null } | null;
};

type ChatUser = { id: string; name: string | null; email: string | null };
type TabValue = "all" | "direct" | "groups";

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string | null, email: string | null) {
  return (name ?? email ?? "?")
    .split(/[\s@.]/)
    .filter(Boolean)
    .map((p) => p[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function convName(conv: Conversation, myId: string) {
  if (conv.name) return conv.name;
  const other = conv.members.find((m) => m.userId !== myId);
  return other?.user?.name ?? other?.user?.email ?? "Unknown";
}

function formatTime(date: Date | string, yesterday: string) {
  const d = new Date(date);
  const diffMs = Date.now() - d.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return yesterday;
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

// ── Main Component ────────────────────────────────────────────────────────────

export function ChatClient({ userId }: { userId: string }) {
  const t = useTranslations("chat");
  const myId = userId;

  const muteLabel = (mutedUntil: Date | null) => {
    if (!mutedUntil) return null;
    const diff = mutedUntil.getTime() - Date.now();
    if (diff > 365 * 24 * 60 * 60_000) return t("mutedForever");
    const h = Math.round(diff / 3_600_000);
    if (h >= 24) return t("mutedDays", { count: Math.round(h / 24) });
    return t("mutedHours", { count: h });
  };

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageInput, setMessageInput] = useState("");
  const [tab, setTab] = useState<TabValue>("all");
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState(false);

  const [showNewDm, setShowNewDm] = useState(false);
  const [chatUsers, setChatUsers] = useState<ChatUser[]>([]);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);

  const bottomRef = useRef<HTMLDivElement>(null);

  /**
   * The conversation list.
   *
   * Reloaded on a timer that backs off when nothing arrives and stops entirely
   * while the tab is in the background, instead of every ten seconds for ever
   * (audit rilievo U-11). It reports whether anything changed, which is what
   * decides how soon to ask again.
   */
  const loadConversations = useCallback(async () => {
    const data = (await getConversations()) as unknown as Conversation[];
    let changed = false;
    setConversations((prev) => {
      changed =
        prev.length !== data.length || data.some((c, i) => c.id !== prev[i]?.id || c.unread !== prev[i]?.unread);
      return changed ? data : prev;
    });
    return changed;
  }, []);

  useEffect(() => {
    loadConversations().catch(() => undefined);
  }, [loadConversations]);

  useLivePoll(loadConversations, { baseMs: 15_000, maxMs: 120_000 });

  const loadMessages = useCallback(async (convId: string) => {
    const data = (await getMessages(convId)) as unknown as Message[];
    let arrived = false;
    setMessages((prev) => {
      arrived = prev.length !== data.length || data.at(-1)?.id !== prev.at(-1)?.id;
      return arrived ? data : prev;
    });

    // Marking the conversation read is a write, and it used to happen on every
    // poll — a database write every five seconds per open conversation, saying
    // the same thing each time. Only new messages can change the answer.
    if (arrived) {
      await markConversationRead(convId);
      setConversations((prev) => prev.map((c) => (c.id === convId ? { ...c, unread: 0 } : c)));
    }
    return arrived;
  }, []);

  const activeConvId = activeConv?.id ?? null;

  const pollActiveConversation = useCallback(async () => {
    if (!activeConvId) return false;
    return loadMessages(activeConvId);
  }, [activeConvId, loadMessages]);

  // The open conversation is the one place worth asking often — but only while
  // there is one open and somebody is looking at it.
  useLivePoll(pollActiveConversation, { baseMs: 5_000, maxMs: 60_000, enabled: activeConvId !== null });

  const selectConversation = useCallback(
    async (conv: Conversation) => {
      setActiveConv(conv);
      setMessages([]);
      await loadMessages(conv.id).catch(() => undefined);
    },
    [loadMessages],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const handleSend = async () => {
    if (!messageInput.trim() || !activeConv) return;
    setSending(true);
    try {
      await sendMessage(activeConv.id, messageInput.trim());
      setMessageInput("");
      await loadMessages(activeConv.id);
    } finally {
      setSending(false);
    }
  };

  const openNewDm = async () => {
    const users = await getChatUsers();
    setChatUsers(users as unknown as ChatUser[]);
    setShowNewDm(true);
  };

  const startDm = async (targetUserId: string) => {
    setShowNewDm(false);
    const conv = await getOrCreateDirectConversation(targetUserId);
    await loadConversations();
    await selectConversation(conv as unknown as Conversation);
  };

  const openNewGroup = async () => {
    const users = await getChatUsers();
    setChatUsers(users as unknown as ChatUser[]);
    setGroupName("");
    setSelectedMembers([]);
    setShowNewGroup(true);
  };

  const createGroup = async () => {
    if (!groupName.trim() || selectedMembers.length === 0) return;
    setShowNewGroup(false);
    const conv = await createGroupConversation(groupName.trim(), selectedMembers);
    await loadConversations();
    await selectConversation(conv as unknown as Conversation);
  };

  const handleMute = async (convId: string, minutes: number | null) => {
    await muteConversation(convId, minutes);
    await loadConversations();
  };

  const handleLeave = async (convId: string) => {
    if (!confirm(t("leaveGroupConfirm"))) return;
    await leaveConversation(convId);
    if (activeConv?.id === convId) setActiveConv(null);
    await loadConversations();
  };

  const handleDelete = async (convId: string) => {
    if (!confirm(t("deleteConvConfirm"))) return;
    await deleteConversation(convId);
    if (activeConv?.id === convId) {
      setActiveConv(null);
      setMessages([]);
    }
    setConversations((prev) => prev.filter((c) => c.id !== convId));
  };

  const filtered = conversations.filter((c) => {
    const matchTab =
      tab === "all" || (tab === "direct" && c.type === "direct") || (tab === "groups" && c.type === "group");
    const name = convName(c, myId).toLowerCase();
    return matchTab && (!search || name.includes(search.toLowerCase()));
  });

  return (
    <div className="flex h-[calc(100dvh-4rem)] overflow-hidden rounded-lg border bg-background">
      {/* ── Left panel ───────────────────────────────────────────── */}
      <div className="flex w-72 shrink-0 flex-col border-r">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-semibold text-base">{t("messages")}</h2>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={openNewDm} title={t("newDmTitle")}>
              <Edit className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={openNewGroup} title={t("newGroupTitle")}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div className="border-b px-3 py-2">
          <div className="relative">
            <Search className="absolute top-2 left-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder={t("searchPlaceholder")}
              className="h-7 pl-8 text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="border-b px-3 py-2">
          <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
            <TabsList className="h-7 w-full">
              <TabsTrigger value="all" className="flex-1 text-xs">
                {t("allTab")}
              </TabsTrigger>
              <TabsTrigger value="direct" className="flex-1 text-xs">
                {t("dmTab")}
              </TabsTrigger>
              <TabsTrigger value="groups" className="flex-1 text-xs">
                {t("groupsTab")}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <ScrollArea className="flex-1">
          {filtered.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center gap-2 text-muted-foreground text-sm">
              <MessageCircle className="h-8 w-8 opacity-30" />
              <p>{t("noConversationsPanel")}</p>
            </div>
          ) : (
            filtered.map((conv) => {
              const isGroup = conv.type === "group";
              const last = conv.messages[0];
              const name = convName(conv, myId);
              const muteText = muteLabel(conv.mutedUntil);
              const other = !isGroup ? conv.members.find((m) => m.userId !== myId) : null;
              const isActive = activeConv?.id === conv.id;

              return (
                // The row opens a conversation, so it is a button — as a plain
                // div it could not be reached or activated from the keyboard at
                // all. The mute menu sits beside it rather than inside it,
                // because a button within a button is invalid markup.
                <div
                  key={conv.id}
                  className={cn(
                    "group relative flex items-center transition-colors hover:bg-muted/50",
                    isActive && "bg-muted",
                  )}
                >
                  <button
                    type="button"
                    aria-current={isActive}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 px-3 py-2.5 text-left focus-visible:outline-none"
                    onClick={() => selectConversation(conv)}
                  >
                    <Avatar className="h-9 w-9 shrink-0">
                      <AvatarFallback
                        className={cn(
                          "font-medium text-xs",
                          isGroup
                            ? "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
                            : "bg-primary/10 text-primary",
                        )}
                      >
                        {isGroup ? (
                          <Users className="h-4 w-4" />
                        ) : (
                          initials(other?.user?.name ?? null, other?.user?.email ?? null)
                        )}
                      </AvatarFallback>
                    </Avatar>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className={cn("truncate text-sm", conv.unread > 0 ? "font-semibold" : "font-medium")}>
                          {name}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                          {last ? formatTime(last.createdAt, t("yesterday")) : ""}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-1">
                        <span
                          className={cn(
                            "truncate text-xs leading-4",
                            conv.unread > 0 ? "text-foreground" : "text-muted-foreground",
                          )}
                        >
                          {muteText ? (
                            <span className="flex items-center gap-1">
                              <BellOff className="h-2.5 w-2.5 shrink-0" />
                              {muteText}
                            </span>
                          ) : (
                            (last?.content ?? t("noMessagesConv"))
                          )}
                        </span>
                        {conv.unread > 0 && (
                          <Badge className="h-4 min-w-4 shrink-0 rounded-full bg-primary px-1 text-[10px] leading-none">
                            {conv.unread > 99 ? "99+" : conv.unread}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </button>

                  <div className="relative z-10 mr-2 shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-foreground"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreVertical className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenuLabel className="py-1 font-normal text-muted-foreground text-xs">
                          {isGroup ? t("groupLabel") : t("directMessageLabel")}
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {conv.muted ? (
                          <DropdownMenuItem onClick={() => handleMute(conv.id, null)}>
                            <Volume2 className="mr-2 h-3.5 w-3.5" /> {t("unmute")}
                          </DropdownMenuItem>
                        ) : (
                          <>
                            <DropdownMenuLabel className="px-2 pt-1 pb-0 text-[11px] text-muted-foreground">
                              {t("muteFor")}
                            </DropdownMenuLabel>
                            <DropdownMenuItem onClick={() => handleMute(conv.id, 60)}>{t("mute1h")}</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleMute(conv.id, 8 * 60)}>
                              {t("mute8h")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleMute(conv.id, 24 * 60)}>
                              {t("mute24h")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleMute(conv.id, 999_999_999)}>
                              {t("muteForever")}
                            </DropdownMenuItem>
                          </>
                        )}
                        {isGroup && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => handleLeave(conv.id)}
                              className="text-destructive focus:text-destructive"
                            >
                              <LogOut className="mr-2 h-3.5 w-3.5" /> {t("leaveGroup")}
                            </DropdownMenuItem>
                          </>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => handleDelete(conv.id)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="mr-2 h-3.5 w-3.5" /> {t("delete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              );
            })
          )}
        </ScrollArea>
      </div>

      {/* ── Right panel ──────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col">
        {!activeConv ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <MessageCircle className="h-12 w-12 opacity-20" />
            <p className="font-medium text-sm">{t("selectConversation")}</p>
            <div className="mt-1 flex gap-2">
              <Button size="sm" variant="outline" onClick={openNewDm}>
                <Edit className="mr-1.5 h-3.5 w-3.5" /> {t("newMessageBtn")}
              </Button>
              <Button size="sm" variant="outline" onClick={openNewGroup}>
                <Users className="mr-1.5 h-3.5 w-3.5" /> {t("newGroupBtn")}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 border-b bg-background px-4 py-3">
              <Avatar className="h-8 w-8">
                <AvatarFallback
                  className={cn(
                    "font-medium text-xs",
                    activeConv.type === "group" ? "bg-violet-100 text-violet-700" : "bg-primary/10 text-primary",
                  )}
                >
                  {activeConv.type === "group" ? (
                    <Users className="h-4 w-4" />
                  ) : (
                    initials(
                      activeConv.members.find((m) => m.userId !== myId)?.user?.name ?? null,
                      activeConv.members.find((m) => m.userId !== myId)?.user?.email ?? null,
                    )
                  )}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="font-semibold text-sm leading-tight">{convName(activeConv, myId)}</p>
                {activeConv.type === "group" && (
                  <p className="text-muted-foreground text-xs">
                    {t("membersCount", { count: activeConv.members.length })}
                  </p>
                )}
              </div>
            </div>

            <ScrollArea className="flex-1 px-4 py-4">
              <div className="space-y-3">
                {messages.length === 0 && (
                  <p className="py-8 text-center text-muted-foreground text-sm">{t("noMessagesYet")}</p>
                )}
                {[...messages].reverse().map((msg) => {
                  const isMe = msg.senderId === myId;
                  return (
                    <div key={msg.id} className={cn("flex", isMe ? "justify-end" : "justify-start")}>
                      {!isMe && (
                        <Avatar className="mt-1 mr-2 h-7 w-7 shrink-0">
                          <AvatarFallback className="bg-muted text-[10px]">
                            {initials(msg.sender?.name ?? null, msg.sender?.email ?? null)}
                          </AvatarFallback>
                        </Avatar>
                      )}
                      <div className={cn("max-w-[65%]", isMe ? "items-end" : "items-start")}>
                        {!isMe && (
                          <p className="mb-0.5 ml-0.5 text-[10px] text-muted-foreground">
                            {msg.sender?.name ?? msg.sender?.email ?? "Unknown"}
                          </p>
                        )}
                        <div
                          className={cn(
                            "rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                            isMe
                              ? "rounded-tr-sm bg-primary text-primary-foreground"
                              : "rounded-tl-sm bg-muted text-foreground",
                          )}
                        >
                          {msg.content}
                        </div>
                        <p className="mt-0.5 px-0.5 text-[10px] text-muted-foreground">
                          {formatTime(msg.createdAt, t("yesterday"))}
                        </p>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>
            </ScrollArea>

            <div className="flex items-center gap-2 border-t bg-background px-4 py-3">
              <Input
                placeholder={t("typeMessage")}
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                className="flex-1"
                disabled={sending}
              />
              <Button size="icon" onClick={handleSend} disabled={sending || !messageInput.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </>
        )}
      </div>

      {/* ── New DM dialog ────────────────────────────────────────── */}
      <Dialog open={showNewDm} onOpenChange={setShowNewDm}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("newDmTitle")}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-72">
            <div className="space-y-1">
              {chatUsers
                .filter((u) => u.id !== myId)
                .map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-muted"
                    onClick={() => startDm(u.id)}
                  >
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="bg-primary/10 text-primary text-xs">
                        {initials(u.name, u.email)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium text-sm">{u.name ?? u.email}</p>
                      {u.name && <p className="text-muted-foreground text-xs">{u.email}</p>}
                    </div>
                  </button>
                ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* ── New Group dialog ─────────────────────────────────────── */}
      <Dialog open={showNewGroup} onOpenChange={setShowNewGroup}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("newGroupTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              placeholder={t("groupNamePlaceholder")}
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
            />
            <p className="font-medium text-muted-foreground text-xs uppercase">{t("selectMembers")}</p>
            <ScrollArea className="max-h-56">
              <div className="space-y-1">
                {chatUsers
                  .filter((u) => u.id !== myId)
                  .map((u) => (
                    // A `label` with no form control inside names nothing: the
                    // Checkbox here renders a button, not an input.
                    <div
                      key={u.id}
                      className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 hover:bg-muted"
                    >
                      <Checkbox
                        checked={selectedMembers.includes(u.id)}
                        onCheckedChange={(checked) =>
                          setSelectedMembers((prev) => (checked ? [...prev, u.id] : prev.filter((id) => id !== u.id)))
                        }
                      />
                      <Avatar className="h-7 w-7">
                        <AvatarFallback className="bg-violet-100 text-[10px] text-violet-700">
                          {initials(u.name, u.email)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm">{u.name ?? u.email}</span>
                    </div>
                  ))}
              </div>
            </ScrollArea>
            <Button
              className="w-full"
              onClick={createGroup}
              disabled={!groupName.trim() || selectedMembers.length === 0}
            >
              {t("createGroup")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
