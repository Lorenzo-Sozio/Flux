"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

import { usePathname } from "next/navigation";

import {
  ArrowLeft,
  BellOff,
  Check,
  ChevronUp,
  Edit,
  LogOut,
  MessageCircle,
  MoreVertical,
  Paperclip,
  Plus,
  Search,
  Trash2,
  User,
  Users,
  Volume2,
  X,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
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
} from "@/actions/chat-internal";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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

import { ChatComposer } from "./chat-composer";
import { type ChatAttachment, ChatMessageBody, type ChatPerson } from "./chat-message-body";

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
  messages: {
    id: string;
    content: string;
    senderId: string | null;
    createdAt: Date;
    attachments?: { name: string }[];
  }[];
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
  attachments?: ChatAttachment[];
};

type ChatUser = { id: string; name: string | null; email: string | null };
type TabValue = "all" | "direct" | "groups";
type View = { kind: "list" } | { kind: "thread"; conv: Conversation } | { kind: "new-dm" } | { kind: "new-group" };

/**
 * The chat's unread count, broadcast for the menus: the sidebar's "Chat" entry and
 * the phone's Menu hub show it without polling the server a second time.
 */
export const CHAT_UNREAD_EVENT = "flux:chat-unread";

/** A page of history, as `getMessages` returns it. */
const MESSAGE_PAGE = 50;

/** The newest page merged into what is on screen, keeping any older pages loaded. */
function mergeMessages(prev: Message[], newest: Message[]): Message[] {
  if (newest.length === 0) return prev.length === 0 ? prev : [];
  const firstNew = new Date(newest[0].createdAt).getTime();
  const older = prev.filter((m) => new Date(m.createdAt).getTime() < firstNew && !newest.some((n) => n.id === m.id));
  return [...older, ...newest];
}

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

type Translate = ReturnType<typeof useTranslations>;
type Formatter = ReturnType<typeof useFormatter>;

function convName(conv: Conversation, myId: string, unknown: string) {
  if (conv.name) return conv.name;
  const other = conv.members.find((m) => m.userId !== myId);
  return other?.user?.name ?? other?.user?.email ?? unknown;
}

function formatTime(date: Date | string, format: Formatter, t: Translate) {
  const d = new Date(date);
  const diffMs = Date.now() - d.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays === 0) return format.dateTime(d, { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return t("yesterday");
  if (diffDays < 7) return format.dateTime(d, { weekday: "short" });
  return format.dateTime(d, { month: "short", day: "numeric" });
}

function muteLabel(mutedUntil: Date | null, t: Translate) {
  if (!mutedUntil) return null;
  const diff = mutedUntil.getTime() - Date.now();
  if (diff > 365 * 24 * 60 * 60_000) return t("mutedForever");
  const h = Math.round(diff / 3_600_000);
  if (h >= 24) return t("mutedDays", { count: Math.round(h / 24) });
  return t("mutedHours", { count: h });
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
  const t = useTranslations("chat");
  const tc = useTranslations("common");
  const format = useFormatter();
  const isGroup = conv.type === "group";
  const last = conv.messages[0];
  const name = convName(conv, myId, t("widget.unknown"));
  const muteText = muteLabel(conv.mutedUntil, t);
  const other = !isGroup ? conv.members.find((m) => m.userId !== myId) : null;

  return (
    <div className="group relative mx-1 flex items-center gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-muted/50">
      {/* Clickable area */}
      <button
        type="button"
        onClick={onClick}
        className="absolute inset-0 rounded-md"
        aria-label={t("widget.openConversation", { name })}
      />

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
            {last ? formatTime(last.createdAt, format, t) : ""}
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
            ) : last && !last.content && last.attachments?.[0] ? (
              <span className="flex items-center gap-1">
                <Paperclip className="h-2.5 w-2.5 shrink-0" aria-hidden />
                <span className="truncate">{last.attachments[0].name}</span>
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
              aria-label={tc("more")}
              className="size-9 text-muted-foreground hover:text-foreground md:size-6"
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
            <DropdownMenuItem onClick={onClick}>
              <MessageCircle className="mr-2 h-3.5 w-3.5" />
              {t("widget.openChat")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {conv.muted ? (
              <DropdownMenuItem onClick={() => onMute(conv.id, null)}>
                <Volume2 className="mr-2 h-3.5 w-3.5" />
                {t("unmute")}
              </DropdownMenuItem>
            ) : (
              <>
                <DropdownMenuLabel className="px-2 pt-1 pb-0 text-[11px] text-muted-foreground">
                  {t("muteFor")}
                </DropdownMenuLabel>
                <DropdownMenuItem onClick={() => onMute(conv.id, 60)}>{t("mute1h")}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onMute(conv.id, 8 * 60)}>{t("mute8h")}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onMute(conv.id, 24 * 60)}>{t("mute24h")}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onMute(conv.id, 999_999_999)}>{t("muteForever")}</DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            {/* A group is left; only a direct conversation is deleted, and then for
                both people, which the confirmation says. */}
            {isGroup ? (
              <DropdownMenuItem onClick={() => onLeave(conv.id)} className="text-destructive focus:text-destructive">
                <LogOut className="mr-2 h-3.5 w-3.5" />
                {t("leaveGroup")}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => onDelete(conv.id)} className="text-destructive focus:text-destructive">
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                {t("delete")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

// ── Group badge in header ─────────────────────────────────────────────────────

function GroupHeader({ conv, myId }: { conv: Conversation; myId: string }) {
  const t = useTranslations("chat");
  const memberCount = conv.members.length;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <Avatar className="h-7 w-7 shrink-0">
        <AvatarFallback className="bg-violet-100 text-[10px] text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
          <Users className="h-3.5 w-3.5" />
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate font-semibold text-sm leading-4">{convName(conv, myId, t("widget.unknown"))}</p>
        <p className="text-[10px] text-muted-foreground">{t("widget.members", { count: memberCount })}</p>
      </div>
    </div>
  );
}

// ── Main widget ───────────────────────────────────────────────────────────────

export function ChatWidget({ userId }: { userId: string }) {
  const t = useTranslations("chat");
  const tc = useTranslations("common");
  const format = useFormatter();
  const pathname = usePathname();
  // The chat page is the chat: a bubble opening a second copy of it on top was noise.
  const onChatPage = pathname?.startsWith("/dashboard/chat") ?? false;
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>({ kind: "list" });
  const [tab, setTab] = useState<TabValue>("all");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [chatUsers, setChatUsers] = useState<ChatUser[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [groupName, setGroupName] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ kind: "leave" | "delete"; convId: string } | null>(null);

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
      arrived = data.at(-1)?.id !== prev.at(-1)?.id || (prev.length === 0 && data.length > 0);
      return arrived ? mergeMessages(prev, data) : prev;
    });
    // ⚠️ A message that arrives in the conversation on screen has been read. The
    // conversation was marked read only when it was opened, so everything that
    // came in while it stayed open was counted again on the bubble once it closed.
    if (arrived) markConversationRead(convId).catch(() => undefined);
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

  // While the panel is open the badge poll is off and the list poll is on, so the
  // total is the list's: otherwise it froze at whatever it was when the panel opened.
  useEffect(() => {
    if (open) setUnreadTotal(conversations.reduce((sum, c) => sum + (c.unread ?? 0), 0));
  }, [open, conversations]);

  useEffect(() => {
    (window as Window & { __fluxChatUnread?: number }).__fluxChatUnread = unreadTotal;
    window.dispatchEvent(new CustomEvent(CHAT_UNREAD_EVENT, { detail: unreadTotal }));
  }, [unreadTotal]);

  // ── Auto-scroll + mark read ───────────────────────────────────────────────

  // ⚠️ To the newest message whenever the conversation or its newest message
  // changes. With no dependencies this ran once, before any message existed, so a
  // conversation opened at its top and new messages arrived out of sight.
  const newestId = messages.at(-1)?.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the conversation and its newest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [threadId, newestId]);

  const loadOlder = async () => {
    if (view.kind !== "thread" || loadingOlder || messages.length === 0) return;
    setLoadingOlder(true);
    try {
      const older = (await getMessages(view.conv.id, new Date(messages[0].createdAt).toISOString())) as Message[];
      setMessages((prev) => [...older.filter((o) => !prev.some((m) => m.id === o.id)), ...prev]);
      setHasOlder(older.length >= MESSAGE_PAGE);
    } catch {
      toast.error(t("loadOlderFailed"));
    } finally {
      setLoadingOlder(false);
    }
  };

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
    setMessages([]);
    setView({ kind: "thread", conv });
    setConversations((prev) => prev.map((c) => (c.id === conv.id ? { ...c, unread: 0 } : c)));
    getMessages(conv.id)
      .then((data) => setHasOlder((data as Message[]).length >= MESSAGE_PAGE))
      .catch(() => undefined);
  };

  // A message that did not go says so in the composer, which keeps its text.
  const afterSend = async () => {
    if (view.kind !== "thread") return;
    await loadMessages(view.conv.id).catch(() => undefined);
    loadConvs().catch(() => undefined);
  };

  // Everyone in the open conversation, for the names picked out in its messages;
  // the others, in a group, are who may be mentioned.
  const people: ChatPerson[] =
    view.kind === "thread"
      ? view.conv.members.map((m) => ({ userId: m.userId, name: m.user?.name ?? null, email: m.user?.email ?? null }))
      : [];
  const mentionable =
    view.kind === "thread" && view.conv.type === "group" ? people.filter((p) => p.userId !== userId) : [];

  const handleStartDM = async (otherUserId: string) => {
    try {
      const conv = await getOrCreateDirectConversation(otherUserId);
      const fresh = (await getConversations()) as Conversation[];
      setConversations(fresh);
      const found = fresh.find((c) => c.id === conv.id);
      if (found) openThread(found);
      else setView({ kind: "list" });
    } catch {
      toast.error(t("widget.startFailed"));
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
      toast.error(t("widget.createGroupFailed"));
    }
  };

  const handleMute = async (convId: string, minutes: number | null) => {
    try {
      await muteConversation(convId, minutes);
      loadConvs();
      loadUnread();
    } catch {
      toast.error(t("widget.muteFailed"));
    }
  };

  // In a real dialog, not the browser's `confirm()`, which the rest of the product
  // no longer uses and which a phone draws as a system alert.
  const handleLeave = (convId: string) => setPendingAction({ kind: "leave", convId });
  const handleDelete = (convId: string) => setPendingAction({ kind: "delete", convId });

  const confirmPending = async () => {
    const action = pendingAction;
    setPendingAction(null);
    if (!action) return;
    try {
      if (action.kind === "leave") await leaveConversation(action.convId);
      else await deleteConversation(action.convId);
      setConversations((prev) => prev.filter((c) => c.id !== action.convId));
      if (view.kind === "thread" && view.conv.id === action.convId) setView({ kind: "list" });
      loadUnread();
    } catch {
      toast.error(action.kind === "leave" ? t("widget.leaveFailed") : t("widget.deleteFailed"));
      loadConvs();
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  // ⚠️ Full screen below md, not below sm. Between the two the tab bar is still
  // there and so is the bubble above it, and a 580px panel floating at bottom-20
  // sat on top of both — on a phone held sideways it was taller than the screen.
  //
  // ⚠️ The safe area is an inset, not padding (CLAUDE.md, the full-screen dialog):
  // the panel stops at the notch and the home indicator, and a plain backdrop
  // behind it paints those strips so the page does not show through them.
  const panelClass = cn(
    "fixed z-50 flex flex-col overflow-hidden border bg-background shadow-2xl transition-all duration-200",
    // Phone: the whole screen, inside the safe area
    "max-md:inset-x-0 max-md:top-[var(--safe-top)] max-md:bottom-[var(--safe-bottom)] max-md:rounded-none max-md:border-0 max-md:shadow-none",
    // Desktop: floating panel bottom-right
    "md:bottom-20 md:right-5 md:h-[580px] md:max-h-[calc(100dvh-7rem)] md:w-[400px] md:rounded-2xl",
  );

  if (onChatPage) return null;

  return (
    <>
      {/* ── Floating button ── */}
      {/*
        Below md the tab bar owns the bottom of the screen; the button sits
        above it rather than on top of the last two tabs.

        ⚠️ And there it sits exactly on the send button of any page whose reply
        box is pinned to the bottom — a ticket, the chat page. Such a page
        marks itself with `data-bottom-composer` and the bubble steps aside
        below md, rather than this file keeping a list of routes that would
        drift from the pages it names.

        ⚠️ A page with a save bar pinned to the bottom (contract, quote edit,
        sequence, draft invoice) marks it `data-bottom-bar`: the bubble steps
        aside on a phone and rises above the bar on a desktop, where it sat on
        the Save button itself.
      */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? tc("close") : t("widget.openChat")}
        aria-expanded={open}
        className="fixed right-4 bottom-[calc(var(--mobile-nav-height)+var(--safe-bottom)+0.75rem)] z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-all duration-200 hover:scale-105 hover:bg-primary/90 active:scale-95 max-md:[body:has([data-bottom-composer])_&]:hidden max-md:[body:has([data-bottom-bar])_&]:hidden md:right-5 md:bottom-5 md:z-50 md:[body:has([data-bottom-bar])_&]:bottom-24"
      >
        {open ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
        {!open && unreadTotal > 0 && (
          <span className="-top-1 -right-1 absolute flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 font-bold text-[10px] text-white leading-none">
            {unreadTotal > 99 ? "99+" : unreadTotal}
          </span>
        )}
      </button>

      {/* ── Chat panel ── */}
      {open && <div aria-hidden="true" className="fixed inset-0 z-50 bg-background md:hidden" />}
      {open && (
        <div className={panelClass}>
          {/* ─ Header ─ */}
          <div className="shrink-0 border-b bg-muted/20">
            {/* Title row */}
            <div className="flex items-center justify-between gap-2 px-3 pt-2 pb-2 md:px-4 md:pt-3">
              {view.kind === "list" ? (
                <>
                  <span className="font-semibold text-sm">{t("messages")}</span>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-9 md:size-7"
                      onClick={() => setView({ kind: "new-dm" })}
                      title={t("newDmTitle")}
                      aria-label={t("newDmTitle")}
                    >
                      <Edit className="h-4 w-4 md:h-3.5 md:w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-9 md:size-7"
                      onClick={() => setView({ kind: "new-group" })}
                      title={t("newGroupTitle")}
                      aria-label={t("newGroupTitle")}
                    >
                      <Users className="h-4 w-4 md:h-3.5 md:w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-9 md:size-7"
                      onClick={() => setOpen(false)}
                      aria-label={tc("close")}
                    >
                      <X className="h-4 w-4 md:h-3.5 md:w-3.5" />
                    </Button>
                  </div>
                </>
              ) : view.kind === "thread" ? (
                <>
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-9 shrink-0 md:size-7"
                      onClick={() => setView({ kind: "list" })}
                      aria-label={tc("back")}
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
                        <span className="truncate font-semibold text-sm">
                          {convName(view.conv, userId, t("widget.unknown"))}
                        </span>
                      </div>
                    )}
                  </div>
                  {/* Thread quick actions */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon" variant="ghost" className="size-9 shrink-0 md:size-7" aria-label={tc("more")}>
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      {view.conv.muted ? (
                        <DropdownMenuItem onClick={() => handleMute(view.conv.id, null)}>
                          <Volume2 className="mr-2 h-3.5 w-3.5" /> {t("unmute")}
                        </DropdownMenuItem>
                      ) : (
                        <>
                          <DropdownMenuLabel className="text-[11px] text-muted-foreground">
                            {t("muteFor")}
                          </DropdownMenuLabel>
                          <DropdownMenuItem onClick={() => handleMute(view.conv.id, 60)}>
                            {t("mute1h")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleMute(view.conv.id, 8 * 60)}>
                            {t("mute8h")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleMute(view.conv.id, 24 * 60)}>
                            {t("mute24h")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleMute(view.conv.id, 999_999_999)}>
                            {t("muteForever")}
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
                            <LogOut className="mr-2 h-3.5 w-3.5" /> {t("leaveGroup")}
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {/* Below md the panel covers the bubble that closes it, and back
                      then close was two taps to leave a conversation. */}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-9 shrink-0 md:hidden"
                    onClick={() => setOpen(false)}
                    aria-label={tc("close")}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </>
              ) : (
                <>
                  <div className="flex min-w-0 items-center gap-2">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-9 shrink-0 md:size-7"
                      onClick={() => setView({ kind: "list" })}
                      aria-label={tc("back")}
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <span className="truncate font-semibold text-sm">
                      {view.kind === "new-dm" ? t("newMessageBtn") : t("newGroupBtn")}
                    </span>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-9 shrink-0 md:size-7"
                    onClick={() => setOpen(false)}
                    aria-label={tc("close")}
                  >
                    <X className="h-4 w-4 md:h-3.5 md:w-3.5" />
                  </Button>
                </>
              )}
            </div>

            {/* Tabs (only on list view) */}
            {view.kind === "list" && (
              <div className="px-3 pb-2">
                <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
                  <TabsList className="h-10 w-full md:h-8">
                    <TabsTrigger value="all" className="h-8 flex-1 gap-1 text-xs md:h-6">
                      {t("allTab")}
                      {unreadTotal > 0 && (
                        <span className="rounded-full bg-primary/20 px-1 font-semibold text-[10px] text-primary leading-4">
                          {unreadTotal}
                        </span>
                      )}
                    </TabsTrigger>
                    <TabsTrigger value="direct" className="h-8 flex-1 gap-1 text-xs md:h-6">
                      <User className="h-3 w-3" /> {t("widget.directTab")}
                      {directCount > 0 && <span className="text-[10px] text-muted-foreground">({directCount})</span>}
                    </TabsTrigger>
                    <TabsTrigger value="groups" className="h-8 flex-1 gap-1 text-xs md:h-6">
                      <Users className="h-3 w-3" /> {t("groupsTab")}
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
                        <p className="font-medium text-sm">{t("widget.noGroups")}</p>
                        <p className="mt-1 text-muted-foreground text-xs">{t("widget.noGroupsHint")}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 text-xs"
                        onClick={() => setView({ kind: "new-group" })}
                      >
                        <Plus className="h-3.5 w-3.5" /> {t("newGroupBtn")}
                      </Button>
                    </>
                  ) : tab === "direct" ? (
                    <>
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                        <MessageCircle className="h-6 w-6 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">{t("widget.noDirect")}</p>
                        <p className="mt-1 text-muted-foreground text-xs">{t("widget.noDirectHint")}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 text-xs"
                        onClick={() => setView({ kind: "new-dm" })}
                      >
                        <Edit className="h-3.5 w-3.5" /> {t("newMessageBtn")}
                      </Button>
                    </>
                  ) : (
                    <>
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                        <MessageCircle className="h-6 w-6 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">{t("noConversationsPanel")}</p>
                        <p className="mt-1 text-muted-foreground text-xs">{t("widget.noConversationsHint")}</p>
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
                            {t("widget.directTab")}
                          </p>
                        )}
                        {filtered.map((conv, i) => {
                          const prevType = i > 0 ? filtered[i - 1]?.type : null;
                          const showGroupDivider = conv.type === "group" && prevType === "direct";
                          return (
                            <React.Fragment key={conv.id}>
                              {showGroupDivider && (
                                <p className="px-4 pt-3 pb-1.5 font-semibold text-[10px] text-muted-foreground uppercase tracking-wider">
                                  {t("groupsTab")}
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
                {hasOlder && (
                  <div className="mb-2 flex justify-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={loadOlder}
                      disabled={loadingOlder}
                      className="h-8 gap-1.5"
                    >
                      <ChevronUp className="size-4" aria-hidden />
                      {t("loadOlder")}
                    </Button>
                  </div>
                )}
                {messages.length === 0 && (
                  <div className="flex justify-center py-8">
                    <p className="text-muted-foreground text-xs">{t("noMessagesYet")}</p>
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
                          <ChatMessageBody
                            content={msg.content}
                            attachments={msg.attachments}
                            people={people}
                            myId={userId}
                            isMe={isMe}
                            bubbleClassName="px-3 py-2"
                          />
                          {(!sameAuthor || i === messages.length - 1) && (
                            <span className="px-1 text-[9px] text-muted-foreground">
                              {formatTime(msg.createdAt, format, t)}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div ref={messagesEndRef} />
              </ScrollArea>

              <ChatComposer
                key={view.conv.id}
                conversationId={view.conv.id}
                people={mentionable}
                onSent={afterSend}
                textareaRef={inputRef}
                compact
                autoFocus
                className="px-3 py-2"
              />
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
                    placeholder={t("widget.searchPeople")}
                    className="h-9 pl-8 md:h-8"
                    autoFocus
                  />
                </div>
              </div>
              <ScrollArea className="flex-1">
                {filteredUsers.length === 0 ? (
                  <p className="px-6 py-10 text-center text-muted-foreground text-xs">
                    {/* Nobody at all is a different sentence from nobody matching. */}
                    {chatUsers.length === 0 ? t("noColleagues") : t("widget.noUsers")}
                  </p>
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
                  placeholder={t("groupNamePlaceholder")}
                  className="h-9 md:h-8"
                  autoFocus
                />
                <div className="relative">
                  <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder={t("widget.addMembers")}
                    className="h-9 pl-8 md:h-8"
                  />
                </div>
                {selectedIds.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {selectedIds.map((id) => {
                      const u = chatUsers.find((x) => x.id === id);
                      return (
                        <Badge key={id} variant="secondary" className="h-5 gap-1 rounded-full pr-1 pl-2 text-xs">
                          {u?.name ?? u?.email ?? id}
                          <button
                            type="button"
                            aria-label={tc("remove")}
                            className="-my-1 -mr-0.5 rounded-full p-1"
                            onClick={() => setSelectedIds((s) => s.filter((x) => x !== id))}
                          >
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
                  {t("widget.createGroupWithCount", { count: selectedIds.length })}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <AlertDialog open={pendingAction !== null} onOpenChange={(v) => !v && setPendingAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingAction?.kind === "leave" ? t("leaveGroup") : t("deleteConvTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction?.kind === "leave" ? t("leaveGroupConfirm") : t("widget.deleteConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmPending} className="bg-destructive text-white hover:bg-destructive/90">
              {pendingAction?.kind === "leave" ? t("leaveGroup") : t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
