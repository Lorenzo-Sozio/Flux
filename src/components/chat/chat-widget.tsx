"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

import {
  ArrowLeft,
  BellOff,
  Check,
  Edit,
  LogOut,
  MessageCircle,
  MoreVertical,
  Plus,
  Search,
  Send,
  Trash2,
  User,
  Users,
  Volume2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  createGroupConversation,
  deleteConversation,
  getChatUsers,
  getConversations,
  getMessages,
  getOrCreateDirectConversation,
  getTotalUnreadCount,
  leaveConversation,
  markConversationRead,
  muteConversation,
  sendMessage,
} from "@/actions/chat-internal";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
type View = { kind: "list" } | { kind: "thread"; conv: Conversation } | { kind: "new-dm" } | { kind: "new-group" };

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

function formatTime(date: Date | string) {
  const d = new Date(date);
  const diffMs = Date.now() - d.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function muteLabel(mutedUntil: Date | null) {
  if (!mutedUntil) return null;
  const diff = mutedUntil.getTime() - Date.now();
  if (diff > 365 * 24 * 60 * 60_000) return "Muted forever";
  const h = Math.round(diff / 3_600_000);
  if (h >= 24) return `Muted ${Math.round(h / 24)}d`;
  return `Muted ${h}h`;
}

// ── Conversation item ─────────────────────────────────────────────────────────

function ConvItem({
  conv,
  myId,
  onClick,
  onMute,
  onLeave,
  onDelete,
}: {
  conv: Conversation;
  myId: string;
  onClick: () => void;
  onMute: (convId: string, minutes: number | null) => void;
  onLeave: (convId: string) => void;
  onDelete: (convId: string) => void;
}) {
  const isGroup = conv.type === "group";
  const last = conv.messages[0];
  const name = convName(conv, myId);
  const muteText = muteLabel(conv.mutedUntil);
  const other = !isGroup ? conv.members.find((m) => m.userId !== myId) : null;

  return (
    <div className="group relative mx-1 flex items-center gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-muted/50">
      {/* Clickable area */}
      <button type="button" onClick={onClick} className="absolute inset-0 rounded-md" aria-label={`Open ${name}`} />

      {/* Avatar */}
      <Avatar className="h-9 w-9 shrink-0">
        <AvatarFallback
          className={cn(
            "font-medium text-xs",
            isGroup
              ? "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
              : "bg-primary/10 text-primary",
          )}
        >
          {isGroup ? <Users className="h-4 w-4" /> : initials(other?.user?.name ?? null, other?.user?.email ?? null)}
        </AvatarFallback>
      </Avatar>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1">
          <span className={cn("truncate text-sm", conv.unread > 0 ? "font-semibold" : "font-medium")}>{name}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
            {last ? formatTime(last.createdAt) : ""}
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-1">
          <span
            className={cn("truncate text-xs leading-4", conv.unread > 0 ? "text-foreground" : "text-muted-foreground")}
          >
            {muteText ? (
              <span className="flex items-center gap-1">
                <BellOff className="h-2.5 w-2.5 shrink-0" />
                {muteText}
              </span>
            ) : (
              (last?.content ?? "No messages yet")
            )}
          </span>
          {conv.unread > 0 && (
            <Badge className="h-4 min-w-4 shrink-0 rounded-full bg-primary px-1 text-[10px] leading-none">
              {conv.unread > 99 ? "99+" : conv.unread}
            </Badge>
          )}
        </div>

        {/* Group members preview */}
        {isGroup && (
          <p className="mt-0.5 truncate text-[10px] text-muted-foreground/70">
            {conv.members
              .map((m) => m.user?.name ?? m.user?.email)
              .filter(Boolean)
              .slice(0, 4)
              .join(", ")}
            {conv.members.length > 4 ? ` +${conv.members.length - 4}` : ""}
          </p>
        )}
      </div>

      {/* Quick actions — visible on hover */}
      <div className="relative z-10 shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
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
              {isGroup ? "Group" : "Direct message"}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onClick}>
              <MessageCircle className="mr-2 h-3.5 w-3.5" />
              Open chat
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {conv.muted ? (
              <DropdownMenuItem onClick={() => onMute(conv.id, null)}>
                <Volume2 className="mr-2 h-3.5 w-3.5" />
                Unmute
              </DropdownMenuItem>
            ) : (
              <>
                <DropdownMenuLabel className="px-2 pt-1 pb-0 text-[11px] text-muted-foreground">
                  Mute for…
                </DropdownMenuLabel>
                <DropdownMenuItem onClick={() => onMute(conv.id, 60)}>1 hour</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onMute(conv.id, 8 * 60)}>8 hours</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onMute(conv.id, 24 * 60)}>24 hours</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onMute(conv.id, 999_999_999)}>Forever</DropdownMenuItem>
              </>
            )}
            {isGroup && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onLeave(conv.id)} className="text-destructive focus:text-destructive">
                  <LogOut className="mr-2 h-3.5 w-3.5" />
                  Leave group
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onDelete(conv.id)} className="text-destructive focus:text-destructive">
              <Trash2 className="mr-2 h-3.5 w-3.5" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

// ── Group badge in header ─────────────────────────────────────────────────────

function GroupHeader({ conv, myId }: { conv: Conversation; myId: string }) {
  const memberCount = conv.members.length;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <Avatar className="h-7 w-7 shrink-0">
        <AvatarFallback className="bg-violet-100 text-[10px] text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
          <Users className="h-3.5 w-3.5" />
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate font-semibold text-sm leading-4">{convName(conv, myId)}</p>
        <p className="text-[10px] text-muted-foreground">
          {memberCount} member{memberCount !== 1 ? "s" : ""}
        </p>
      </div>
    </div>
  );
}

// ── Main widget ───────────────────────────────────────────────────────────────

export function ChatWidget({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>({ kind: "list" });
  const [tab, setTab] = useState<TabValue>("all");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [chatUsers, setChatUsers] = useState<ChatUser[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [groupName, setGroupName] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Loaders ───────────────────────────────────────────────────────────────

  // Each loader reports whether anything actually changed. That is what lets the
  // poll slow down when the workspace is quiet instead of asking at a fixed rate
  // for ever (audit rilievo U-11).

  const loadConvs = useCallback(async () => {
    const data = (await getConversations()) as Conversation[];
    let changed = false;
    setConversations((prev) => {
      changed =
        prev.length !== data.length || data.some((c, i) => c.id !== prev[i]?.id || c.unread !== prev[i]?.unread);
      return changed ? data : prev;
    });
    return changed;
  }, []);

  const loadUnread = useCallback(async () => {
    const total = await getTotalUnreadCount();
    let changed = false;
    setUnreadTotal((prev) => {
      changed = prev !== total;
      return total;
    });
    return changed;
  }, []);

  const loadMessages = useCallback(async (convId: string) => {
    const data = (await getMessages(convId)) as Message[];
    let arrived = false;
    setMessages((prev) => {
      arrived = prev.length !== data.length || data.at(-1)?.id !== prev.at(-1)?.id;
      return arrived ? data : prev;
    });
    return arrived;
  }, []);

  // ── Polling ───────────────────────────────────────────────────────────────
  //
  // This widget is mounted on every dashboard page, so its timers ran wherever the
  // user was and whether or not the tab was in front of anyone: the unread badge
  // every 30 seconds always, the conversation list every 5 while open, and the
  // open thread every 3. `useLivePoll` stops while the tab is hidden, answers
  // immediately when it comes back, and backs off while nothing is happening.

  const threadId = view.kind === "thread" ? view.conv.id : null;

  useEffect(() => {
    loadUnread().catch(() => undefined);
  }, [loadUnread]);

  // The badge only has to be roughly current: it is a dot on a button.
  useLivePoll(loadUnread, { baseMs: 30_000, maxMs: 5 * 60_000, enabled: !open });

  useEffect(() => {
    if (open) loadConvs().catch(() => undefined);
  }, [open, loadConvs]);

  useLivePoll(loadConvs, { baseMs: 10_000, maxMs: 90_000, enabled: open });

  useEffect(() => {
    if (threadId) loadMessages(threadId).catch(() => undefined);
  }, [threadId, loadMessages]);

  const pollThread = useCallback(async () => {
    if (!threadId) return false;
    return loadMessages(threadId);
  }, [threadId, loadMessages]);

  useLivePoll(pollThread, { baseMs: 4_000, maxMs: 45_000, enabled: threadId !== null });

  // ── Auto-scroll + mark read ───────────────────────────────────────────────

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (view.kind !== "thread") return;
    markConversationRead(view.conv.id).catch(() => {
      // Failing to mark a conversation read is not worth interrupting anyone
      // for: the next poll writes it again.
    });
    setUnreadTotal((n) => Math.max(0, n - (view.conv.unread ?? 0)));
  }, [view]);

  // ── Load users when pickers open ─────────────────────────────────────────

  useEffect(() => {
    if (view.kind === "new-dm" || view.kind === "new-group") {
      getChatUsers()
        .then((d) => setChatUsers(d as ChatUser[]))
        .catch(() => {
          // An empty picker is the visible result; a toast on top of it says
          // nothing the user cannot already see.
        });
      setUserSearch("");
      setSelectedIds([]);
      setGroupName("");
    }
  }, [view]);

  // ── Filtered lists ────────────────────────────────────────────────────────

  const filtered = conversations.filter((c) =>
    tab === "all" ? true : tab === "groups" ? c.type === "group" : c.type === "direct",
  );

  const filteredUsers = chatUsers.filter((u) => {
    const q = userSearch.toLowerCase();
    return (u.name ?? "").toLowerCase().includes(q) || (u.email ?? "").toLowerCase().includes(q);
  });

  const groupCount = conversations.filter((c) => c.type === "group").length;
  const directCount = conversations.filter((c) => c.type === "direct").length;
  const groupUnread = conversations.filter((c) => c.type === "group").reduce((s, c) => s + c.unread, 0);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const openThread = (conv: Conversation) => {
    setView({ kind: "thread", conv });
    setInput("");
  };

  const handleSend = async () => {
    if (!input.trim() || sending || view.kind !== "thread") return;
    setSending(true);
    const text = input.trim();
    try {
      await sendMessage(view.conv.id, text);
      setInput("");
      await loadMessages(view.conv.id);
      loadConvs();
    } catch {
      // The message did not go. Putting the text back in the box is the only
      // honest outcome: it used to vanish and look sent.
      setInput(text);
      toast.error("The message could not be sent.");
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleStartDM = async (otherUserId: string) => {
    try {
      const conv = await getOrCreateDirectConversation(otherUserId);
      const fresh = (await getConversations()) as Conversation[];
      setConversations(fresh);
      const found = fresh.find((c) => c.id === conv.id);
      if (found) openThread(found);
      else setView({ kind: "list" });
    } catch {
      toast.error("The conversation could not be started.");
    }
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim() || selectedIds.length === 0) return;
    try {
      const conv = await createGroupConversation(groupName.trim(), selectedIds);
      const fresh = (await getConversations()) as Conversation[];
      setConversations(fresh);
      const found = fresh.find((c) => c.id === conv.id);
      setTab("groups");
      if (found) openThread(found);
      else setView({ kind: "list" });
    } catch {
      toast.error("The group could not be created.");
    }
  };

  const handleMute = async (convId: string, minutes: number | null) => {
    try {
      await muteConversation(convId, minutes);
      loadConvs();
      loadUnread();
    } catch {
      toast.error("The mute setting could not be saved.");
    }
  };

  const handleLeave = async (convId: string) => {
    if (!confirm("Leave this group?")) return;
    try {
      await leaveConversation(convId);
      setConversations((prev) => prev.filter((c) => c.id !== convId));
      if (view.kind === "thread" && view.conv.id === convId) setView({ kind: "list" });
    } catch {
      // The row was already removed from the list, so say it did not stick.
      toast.error("Could not leave the group.");
      loadConvs();
    }
  };

  const handleDelete = async (convId: string) => {
    if (!confirm("Delete this conversation? All messages will be permanently removed.")) return;
    try {
      await deleteConversation(convId);
      setConversations((prev) => prev.filter((c) => c.id !== convId));
      if (view.kind === "thread" && view.conv.id === convId) setView({ kind: "list" });
      loadUnread();
    } catch {
      toast.error("The conversation could not be deleted.");
      loadConvs();
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const panelClass = cn(
    "fixed z-50 flex flex-col overflow-hidden border bg-background shadow-2xl transition-all duration-200",
    // Mobile: full screen overlay
    "max-sm:inset-0 max-sm:rounded-none max-sm:pt-[var(--safe-top)] max-sm:pb-[var(--safe-bottom)]",
    // Desktop: floating panel bottom-right
    "sm:bottom-20 sm:right-5 sm:w-[400px] sm:h-[580px] sm:rounded-2xl",
  );

  return (
    <>
      {/* ── Floating button ── */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        // Below md the tab bar owns the bottom of the screen; the button sits
        // above it rather than on top of the last two tabs.
        className="fixed right-4 bottom-[calc(var(--mobile-nav-height)+var(--safe-bottom)+0.75rem)] z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-all duration-200 hover:scale-105 hover:bg-primary/90 active:scale-95 md:right-5 md:bottom-5 md:z-50"
      >
        {open ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
        {!open && unreadTotal > 0 && (
          <span className="-top-1 -right-1 absolute flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 font-bold text-[10px] text-white leading-none">
            {unreadTotal > 99 ? "99+" : unreadTotal}
          </span>
        )}
      </button>

      {/* ── Chat panel ── */}
      {open && (
        <div className={panelClass}>
          {/* ─ Header ─ */}
          <div className="shrink-0 border-b bg-muted/20">
            {/* Title row */}
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              {view.kind === "list" ? (
                <>
                  <span className="font-semibold text-sm">Messages</span>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => setView({ kind: "new-dm" })}
                      title="New direct message"
                    >
                      <Edit className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => setView({ kind: "new-group" })}
                      title="New group"
                    >
                      <Users className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setOpen(false)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </>
              ) : view.kind === "thread" ? (
                <>
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 shrink-0"
                      onClick={() => setView({ kind: "list" })}
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                    {view.conv.type === "group" ? (
                      <GroupHeader conv={view.conv} myId={userId} />
                    ) : (
                      <div className="flex min-w-0 items-center gap-2">
                        <Avatar className="h-7 w-7 shrink-0">
                          <AvatarFallback className="bg-primary/10 text-[10px] text-primary">
                            {initials(
                              view.conv.members.find((m) => m.userId !== userId)?.user?.name ?? null,
                              view.conv.members.find((m) => m.userId !== userId)?.user?.email ?? null,
                            )}
                          </AvatarFallback>
                        </Avatar>
                        <span className="truncate font-semibold text-sm">{convName(view.conv, userId)}</span>
                      </div>
                    )}
                  </div>
                  {/* Thread quick actions */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      {view.conv.muted ? (
                        <DropdownMenuItem onClick={() => handleMute(view.conv.id, null)}>
                          <Volume2 className="mr-2 h-3.5 w-3.5" /> Unmute
                        </DropdownMenuItem>
                      ) : (
                        <>
                          <DropdownMenuLabel className="text-[11px] text-muted-foreground">Mute for…</DropdownMenuLabel>
                          <DropdownMenuItem onClick={() => handleMute(view.conv.id, 60)}>1 hour</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleMute(view.conv.id, 8 * 60)}>8 hours</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleMute(view.conv.id, 24 * 60)}>
                            24 hours
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleMute(view.conv.id, 999_999_999)}>
                            Forever
                          </DropdownMenuItem>
                        </>
                      )}
                      {view.conv.type === "group" && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => handleLeave(view.conv.id)}
                            className="text-destructive focus:text-destructive"
                          >
                            <LogOut className="mr-2 h-3.5 w-3.5" /> Leave group
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setView({ kind: "list" })}>
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <span className="font-semibold text-sm">
                      {view.kind === "new-dm" ? "New Message" : "New Group"}
                    </span>
                  </div>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setOpen(false)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </div>

            {/* Tabs (only on list view) */}
            {view.kind === "list" && (
              <div className="px-3 pb-2">
                <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
                  <TabsList className="h-8 w-full">
                    <TabsTrigger value="all" className="h-6 flex-1 gap-1 text-xs">
                      All
                      {unreadTotal > 0 && (
                        <span className="rounded-full bg-primary/20 px-1 font-semibold text-[10px] text-primary leading-4">
                          {unreadTotal}
                        </span>
                      )}
                    </TabsTrigger>
                    <TabsTrigger value="direct" className="h-6 flex-1 gap-1 text-xs">
                      <User className="h-3 w-3" /> Direct
                      {directCount > 0 && <span className="text-[10px] text-muted-foreground">({directCount})</span>}
                    </TabsTrigger>
                    <TabsTrigger value="groups" className="h-6 flex-1 gap-1 text-xs">
                      <Users className="h-3 w-3" /> Groups
                      {groupCount > 0 && (
                        <span
                          className={cn(
                            "rounded-full px-1 font-semibold text-[10px] leading-4",
                            groupUnread > 0 ? "bg-primary/20 text-primary" : "text-muted-foreground",
                          )}
                        >
                          {groupCount}
                        </span>
                      )}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            )}
          </div>

          {/* ─ Body ─ */}

          {/* Conversation list */}
          {view.kind === "list" && (
            <ScrollArea className="flex-1">
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
                  {tab === "groups" ? (
                    <>
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/30">
                        <Users className="h-6 w-6 text-violet-600 dark:text-violet-400" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">No groups yet</p>
                        <p className="mt-1 text-muted-foreground text-xs">Create a group to start collaborating</p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 text-xs"
                        onClick={() => setView({ kind: "new-group" })}
                      >
                        <Plus className="h-3.5 w-3.5" /> New Group
                      </Button>
                    </>
                  ) : tab === "direct" ? (
                    <>
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                        <MessageCircle className="h-6 w-6 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">No direct messages</p>
                        <p className="mt-1 text-muted-foreground text-xs">Start a conversation with a colleague</p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 text-xs"
                        onClick={() => setView({ kind: "new-dm" })}
                      >
                        <Edit className="h-3.5 w-3.5" /> New Message
                      </Button>
                    </>
                  ) : (
                    <>
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                        <MessageCircle className="h-6 w-6 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">No conversations</p>
                        <p className="mt-1 text-muted-foreground text-xs">Message a colleague or create a group</p>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="py-1">
                  {/* Groups section heading when viewing "all" */}
                  {tab === "all" &&
                    filtered.some((c) => c.type === "group") &&
                    filtered.some((c) => c.type === "direct") && (
                      <>
                        {filtered[0]?.type !== "group" && (
                          <p className="px-4 py-1.5 font-semibold text-[10px] text-muted-foreground uppercase tracking-wider">
                            Direct
                          </p>
                        )}
                        {filtered.map((conv, i) => {
                          const prevType = i > 0 ? filtered[i - 1]?.type : null;
                          const showGroupDivider = conv.type === "group" && prevType === "direct";
                          return (
                            <React.Fragment key={conv.id}>
                              {showGroupDivider && (
                                <p className="px-4 pt-3 pb-1.5 font-semibold text-[10px] text-muted-foreground uppercase tracking-wider">
                                  Groups
                                </p>
                              )}
                              <ConvItem
                                conv={conv}
                                myId={userId}
                                onClick={() => openThread(conv)}
                                onMute={handleMute}
                                onLeave={handleLeave}
                                onDelete={handleDelete}
                              />
                            </React.Fragment>
                          );
                        })}
                      </>
                    )}
                  {(tab !== "all" ||
                    !filtered.some((c) => c.type === "group") ||
                    !filtered.some((c) => c.type === "direct")) &&
                    filtered.map((conv) => (
                      <ConvItem
                        key={conv.id}
                        conv={conv}
                        myId={userId}
                        onClick={() => openThread(conv)}
                        onMute={handleMute}
                        onLeave={handleLeave}
                        onDelete={handleDelete}
                      />
                    ))}
                </div>
              )}
            </ScrollArea>
          )}

          {/* Thread view */}
          {view.kind === "thread" && (
            <>
              <ScrollArea className="flex-1 px-3 py-3">
                {messages.length === 0 && (
                  <div className="flex justify-center py-8">
                    <p className="text-muted-foreground text-xs">No messages yet. Say hello!</p>
                  </div>
                )}
                <div className="space-y-2">
                  {messages.map((msg, i) => {
                    const isMe = msg.senderId === userId;
                    const prevMsg = messages[i - 1];
                    const sameAuthor = prevMsg?.senderId === msg.senderId;
                    const showName = !isMe && !sameAuthor && view.conv.type === "group";
                    return (
                      <div key={msg.id} className={cn("flex gap-2", isMe && "flex-row-reverse", !sameAuthor && "mt-3")}>
                        {!isMe && (
                          <Avatar className={cn("mt-0.5 h-6 w-6 shrink-0", sameAuthor && "invisible")}>
                            <AvatarFallback className="bg-primary/10 text-[9px] text-primary">
                              {initials(msg.sender?.name ?? null, msg.sender?.email ?? null)}
                            </AvatarFallback>
                          </Avatar>
                        )}
                        <div className={cn("flex max-w-[78%] flex-col gap-0.5", isMe && "items-end")}>
                          {showName && (
                            <span className="px-1 font-medium text-[10px] text-muted-foreground">
                              {msg.sender?.name ?? msg.sender?.email}
                            </span>
                          )}
                          <div
                            className={cn(
                              "whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm leading-relaxed",
                              isMe
                                ? "rounded-tr-sm bg-primary text-primary-foreground"
                                : "rounded-tl-sm bg-muted text-foreground",
                            )}
                          >
                            {msg.content}
                          </div>
                          {(!sameAuthor || i === messages.length - 1) && (
                            <span className="px-1 text-[9px] text-muted-foreground">{formatTime(msg.createdAt)}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div ref={messagesEndRef} />
              </ScrollArea>

              <div className="flex shrink-0 items-center gap-2 border-t px-3 py-2">
                <Input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Write a message…"
                  className="h-9 text-sm"
                  disabled={sending}
                  autoFocus
                />
                <Button
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  onClick={handleSend}
                  disabled={!input.trim() || sending}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </>
          )}

          {/* New DM */}
          {view.kind === "new-dm" && (
            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="shrink-0 border-b px-3 pt-2 pb-2">
                <div className="relative">
                  <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="Search people…"
                    className="h-8 pl-8 text-sm"
                    autoFocus
                  />
                </div>
              </div>
              <ScrollArea className="flex-1">
                {filteredUsers.length === 0 ? (
                  <p className="py-10 text-center text-muted-foreground text-xs">No users found</p>
                ) : (
                  filteredUsers.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => handleStartDM(u.id)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/50"
                    >
                      <Avatar className="h-8 w-8 shrink-0">
                        <AvatarFallback className="bg-primary/10 text-primary text-xs">
                          {initials(u.name, u.email)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-sm">{u.name ?? u.email}</p>
                        {u.name && <p className="truncate text-muted-foreground text-xs">{u.email}</p>}
                      </div>
                    </button>
                  ))
                )}
              </ScrollArea>
            </div>
          )}

          {/* New Group */}
          {view.kind === "new-group" && (
            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="shrink-0 space-y-2 border-b px-3 pt-2 pb-2">
                <Input
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="Group name…"
                  className="h-8 text-sm"
                  autoFocus
                />
                <div className="relative">
                  <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="Add members…"
                    className="h-8 pl-8 text-sm"
                  />
                </div>
                {selectedIds.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {selectedIds.map((id) => {
                      const u = chatUsers.find((x) => x.id === id);
                      return (
                        <Badge key={id} variant="secondary" className="h-5 gap-1 rounded-full pr-1 pl-2 text-xs">
                          {u?.name ?? u?.email ?? id}
                          <button type="button" onClick={() => setSelectedIds((s) => s.filter((x) => x !== id))}>
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </Badge>
                      );
                    })}
                  </div>
                )}
              </div>
              <ScrollArea className="flex-1">
                {filteredUsers.map((u) => {
                  const sel = selectedIds.includes(u.id);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => setSelectedIds((s) => (sel ? s.filter((x) => x !== u.id) : [...s, u.id]))}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/50"
                    >
                      <Avatar className="h-7 w-7 shrink-0">
                        <AvatarFallback
                          className={cn(
                            "text-[10px]",
                            sel ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary",
                          )}
                        >
                          {sel ? <Check className="h-3.5 w-3.5" /> : initials(u.name, u.email)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-sm">{u.name ?? u.email}</p>
                        {u.name && <p className="truncate text-muted-foreground text-xs">{u.email}</p>}
                      </div>
                      {sel && <Check className="h-4 w-4 shrink-0 text-primary" />}
                    </button>
                  );
                })}
              </ScrollArea>
              <div className="shrink-0 border-t px-3 py-2.5">
                <Button
                  className="h-9 w-full gap-2"
                  onClick={handleCreateGroup}
                  disabled={!groupName.trim() || selectedIds.length === 0}
                >
                  <Plus className="h-4 w-4" />
                  Create Group ({selectedIds.length} member{selectedIds.length !== 1 ? "s" : ""})
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
