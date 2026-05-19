"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

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
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadConversations = useCallback(async () => {
    try {
      const data = await getConversations();
      setConversations(data as unknown as Conversation[]);
    } catch {}
  }, []);

  useEffect(() => {
    loadConversations();
    const iv = setInterval(loadConversations, 10_000);
    return () => clearInterval(iv);
  }, [loadConversations]);

  const loadMessages = useCallback(async (convId: string) => {
    try {
      const data = await getMessages(convId);
      setMessages(data as unknown as Message[]);
      await markConversationRead(convId);
      setConversations((prev) => prev.map((c) => (c.id === convId ? { ...c, unread: 0 } : c)));
    } catch {}
  }, []);

  const selectConversation = useCallback(
    async (conv: Conversation) => {
      setActiveConv(conv);
      await loadMessages(conv.id);
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => loadMessages(conv.id), 5_000);
    },
    [loadMessages],
  );

  useEffect(
    () => () => {
      if (pollRef.current) clearInterval(pollRef.current);
    },
    [],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden rounded-lg border bg-background">
      {/* ── Left panel ───────────────────────────────────────────── */}
      <div className="w-72 shrink-0 flex flex-col border-r">
        <div className="flex items-center justify-between px-4 py-3 border-b">
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

        <div className="px-3 py-2 border-b">
          <div className="relative">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder={t("searchPlaceholder")}
              className="pl-8 h-7 text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="px-3 py-2 border-b">
          <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
            <TabsList className="w-full h-7">
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
            <div className="flex flex-col items-center justify-center h-32 gap-2 text-sm text-muted-foreground">
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
                <div
                  key={conv.id}
                  className={cn(
                    "group relative flex items-center gap-2.5 px-3 py-2.5 hover:bg-muted/50 transition-colors cursor-pointer",
                    isActive && "bg-muted",
                  )}
                  onClick={() => selectConversation(conv)}
                >
                  <Avatar className="h-9 w-9 shrink-0">
                    <AvatarFallback
                      className={cn(
                        "text-xs font-medium",
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

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span className={cn("truncate text-sm", conv.unread > 0 ? "font-semibold" : "font-medium")}>
                        {name}
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                        {last ? formatTime(last.createdAt, t("yesterday")) : ""}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-1 mt-0.5">
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
                        <Badge className="h-4 min-w-4 shrink-0 rounded-full px-1 text-[10px] bg-primary leading-none">
                          {conv.unread > 99 ? "99+" : conv.unread}
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="relative z-10 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
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
                        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground py-1">
                          {isGroup ? t("groupLabel") : t("directMessageLabel")}
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {conv.muted ? (
                          <DropdownMenuItem onClick={() => handleMute(conv.id, null)}>
                            <Volume2 className="h-3.5 w-3.5 mr-2" /> {t("unmute")}
                          </DropdownMenuItem>
                        ) : (
                          <>
                            <DropdownMenuLabel className="text-[11px] text-muted-foreground px-2 pt-1 pb-0">
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
                              <LogOut className="h-3.5 w-3.5 mr-2" /> {t("leaveGroup")}
                            </DropdownMenuItem>
                          </>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => handleDelete(conv.id)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-2" /> {t("delete")}
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
      <div className="flex-1 flex flex-col">
        {!activeConv ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <MessageCircle className="h-12 w-12 opacity-20" />
            <p className="text-sm font-medium">{t("selectConversation")}</p>
            <div className="flex gap-2 mt-1">
              <Button size="sm" variant="outline" onClick={openNewDm}>
                <Edit className="h-3.5 w-3.5 mr-1.5" /> {t("newMessageBtn")}
              </Button>
              <Button size="sm" variant="outline" onClick={openNewGroup}>
                <Users className="h-3.5 w-3.5 mr-1.5" /> {t("newGroupBtn")}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 px-4 py-3 border-b bg-background">
              <Avatar className="h-8 w-8">
                <AvatarFallback
                  className={cn(
                    "text-xs font-medium",
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
                  <p className="text-xs text-muted-foreground">
                    {t("membersCount", { count: activeConv.members.length })}
                  </p>
                )}
              </div>
            </div>

            <ScrollArea className="flex-1 px-4 py-4">
              <div className="space-y-3">
                {messages.length === 0 && (
                  <p className="text-center text-sm text-muted-foreground py-8">{t("noMessagesYet")}</p>
                )}
                {[...messages].reverse().map((msg) => {
                  const isMe = msg.senderId === myId;
                  return (
                    <div key={msg.id} className={cn("flex", isMe ? "justify-end" : "justify-start")}>
                      {!isMe && (
                        <Avatar className="h-7 w-7 mr-2 mt-1 shrink-0">
                          <AvatarFallback className="text-[10px] bg-muted">
                            {initials(msg.sender?.name ?? null, msg.sender?.email ?? null)}
                          </AvatarFallback>
                        </Avatar>
                      )}
                      <div className={cn("max-w-[65%]", isMe ? "items-end" : "items-start")}>
                        {!isMe && (
                          <p className="text-[10px] text-muted-foreground mb-0.5 ml-0.5">
                            {msg.sender?.name ?? msg.sender?.email ?? "Unknown"}
                          </p>
                        )}
                        <div
                          className={cn(
                            "rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                            isMe
                              ? "bg-primary text-primary-foreground rounded-tr-sm"
                              : "bg-muted text-foreground rounded-tl-sm",
                          )}
                        >
                          {msg.content}
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-0.5 px-0.5">
                          {formatTime(msg.createdAt, t("yesterday"))}
                        </p>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>
            </ScrollArea>

            <div className="flex items-center gap-2 px-4 py-3 border-t bg-background">
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
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted text-left transition-colors"
                    onClick={() => startDm(u.id)}
                  >
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="text-xs bg-primary/10 text-primary">
                        {initials(u.name, u.email)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium">{u.name ?? u.email}</p>
                      {u.name && <p className="text-xs text-muted-foreground">{u.email}</p>}
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
            <p className="text-xs font-medium text-muted-foreground uppercase">{t("selectMembers")}</p>
            <ScrollArea className="max-h-56">
              <div className="space-y-1">
                {chatUsers
                  .filter((u) => u.id !== myId)
                  .map((u) => (
                    <label
                      key={u.id}
                      className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted cursor-pointer"
                    >
                      <Checkbox
                        checked={selectedMembers.includes(u.id)}
                        onCheckedChange={(checked) =>
                          setSelectedMembers((prev) => (checked ? [...prev, u.id] : prev.filter((id) => id !== u.id)))
                        }
                      />
                      <Avatar className="h-7 w-7">
                        <AvatarFallback className="text-[10px] bg-violet-100 text-violet-700">
                          {initials(u.name, u.email)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm">{u.name ?? u.email}</span>
                    </label>
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
