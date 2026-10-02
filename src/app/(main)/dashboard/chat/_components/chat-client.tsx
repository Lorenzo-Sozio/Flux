"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useSearchParams } from "next/navigation";

import {
  ArrowLeft,
  BellOff,
  ChevronUp,
  Edit,
  LogOut,
  MessageCircle,
  MoreVertical,
  Paperclip,
  Plus,
  Search,
  Trash2,
  Users,
  Volume2,
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
  leaveConversation,
  markConversationRead,
  muteConversation,
} from "@/actions/chat-internal";
import { ChatComposer } from "@/components/chat/chat-composer";
import { type ChatAttachment, ChatMessageBody, type ChatPerson } from "@/components/chat/chat-message-body";
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
import { useBackDismiss } from "@/hooks/use-back-dismiss";
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

function convName(conv: Conversation, myId: string, unknown: string) {
  if (conv.name) return conv.name;
  const other = conv.members.find((m) => m.userId !== myId);
  return other?.user?.name ?? other?.user?.email ?? unknown;
}

type Formatter = ReturnType<typeof useFormatter>;

/** In the product's language, not the browser's: `toLocaleTimeString([])` followed the OS. */
function formatTime(date: Date | string, format: Formatter, yesterday: string) {
  const d = new Date(date);
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (diffDays === 0) return format.dateTime(d, { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return yesterday;
  if (diffDays < 7) return format.dateTime(d, { weekday: "short" });
  return format.dateTime(d, { month: "short", day: "numeric" });
}

/** A page of history, as `getMessages` returns it. */
const MESSAGE_PAGE = 50;

/**
 * The newest page merged into what is on screen, keeping any older pages the
 * person loaded: the poll re-reads only the newest fifty, and replacing the list
 * with them dropped everything scrolled back to.
 */
function mergeMessages(prev: Message[], newest: Message[]): Message[] {
  if (newest.length === 0) return prev.length === 0 ? prev : [];
  const firstNew = new Date(newest[0].createdAt).getTime();
  const older = prev.filter((m) => new Date(m.createdAt).getTime() < firstNew && !newest.some((n) => n.id === m.id));
  return [...older, ...newest];
}

/** While a conversation is open on a phone, Back returns to the list. Renders nothing. */
function BackToList({ onBack }: { onBack: () => void }) {
  useBackDismiss(onBack);
  return null;
}

// ── Main Component ────────────────────────────────────────────────────────────

export function ChatClient({ userId }: { userId: string }) {
  const t = useTranslations("chat");
  const tc = useTranslations("common");
  const format = useFormatter();
  const searchParams = useSearchParams();
  const myId = userId;
  const unknown = t("widget.unknown");

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
  const [tab, setTab] = useState<TabValue>("all");
  const [search, setSearch] = useState("");

  const [showNewDm, setShowNewDm] = useState(false);
  const [chatUsers, setChatUsers] = useState<ChatUser[]>([]);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  // Whether an older page may exist, and whether one is loading.
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // A leave or delete waiting for its confirmation, in a real dialog rather than
  // the browser's `confirm()`, which the rest of the product no longer uses.
  const [pendingAction, setPendingAction] = useState<{ kind: "leave" | "delete"; convId: string } | null>(null);

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
      arrived = data.at(-1)?.id !== prev.at(-1)?.id || (prev.length === 0 && data.length > 0);
      return arrived ? mergeMessages(prev, data) : prev;
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

  const selectConversation = useCallback(async (conv: Conversation) => {
    setActiveConv(conv);
    setMessages([]);
    setHasOlder(false);
    const data = (await getMessages(conv.id).catch(() => [])) as unknown as Message[];
    setMessages(data);
    setHasOlder(data.length >= MESSAGE_PAGE);
    if (data.length > 0) markConversationRead(conv.id).catch(() => undefined);
    setConversations((prev) => prev.map((c) => (c.id === conv.id ? { ...c, unread: 0 } : c)));
  }, []);

  // ⚠️ To the newest message whenever the conversation or its newest message
  // changes — not once on mount, when there was nothing to scroll to: a
  // conversation used to open at its top, and a new message arrived out of sight.
  // Loading an older page changes neither, so reading back is not interrupted.
  const newestId = messages.at(-1)?.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the conversation and its newest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [activeConvId, newestId]);

  // A notification links to `?c=<id>`: open that conversation once the list is in.
  const wanted = searchParams.get("c");
  const openedFromLink = useRef<string | null>(null);
  useEffect(() => {
    if (!wanted || openedFromLink.current === wanted) return;
    const conv = conversations.find((c) => c.id === wanted);
    if (conv) {
      openedFromLink.current = wanted;
      selectConversation(conv);
    }
  }, [wanted, conversations, selectConversation]);

  const loadOlder = async () => {
    if (!activeConv || loadingOlder || messages.length === 0) return;
    setLoadingOlder(true);
    try {
      const older = (await getMessages(
        activeConv.id,
        new Date(messages[0].createdAt).toISOString(),
      )) as unknown as Message[];
      setMessages((prev) => [...older.filter((o) => !prev.some((m) => m.id === o.id)), ...prev]);
      setHasOlder(older.length >= MESSAGE_PAGE);
    } catch {
      toast.error(t("loadOlderFailed"));
    } finally {
      setLoadingOlder(false);
    }
  };

  // ⚠️ Every action says when it did not happen. These awaited server actions with
  // no catch, so a failure was an unhandled rejection and a screen that simply did
  // not change — a message that was not sent looked like a slow one. Sending says
  // so inside the composer, which keeps the text when it does.
  const afterSend = async () => {
    if (!activeConv) return;
    await loadMessages(activeConv.id).catch(() => undefined);
    loadConversations().catch(() => undefined);
  };

  // Everyone in the open conversation, for the names picked out in its messages;
  // the others, in a group, are who may be mentioned.
  const people: ChatPerson[] = (activeConv?.members ?? []).map((m) => ({
    userId: m.userId,
    name: m.user?.name ?? null,
    email: m.user?.email ?? null,
  }));
  const mentionable = activeConv?.type === "group" ? people.filter((p) => p.userId !== myId) : [];

  const openNewDm = async () => {
    try {
      setChatUsers((await getChatUsers()) as unknown as ChatUser[]);
      setShowNewDm(true);
    } catch {
      toast.error(t("widget.startFailed"));
    }
  };

  const startDm = async (targetUserId: string) => {
    setShowNewDm(false);
    try {
      const conv = await getOrCreateDirectConversation(targetUserId);
      await loadConversations();
      await selectConversation(conv as unknown as Conversation);
    } catch {
      toast.error(t("widget.startFailed"));
    }
  };

  const openNewGroup = async () => {
    try {
      setChatUsers((await getChatUsers()) as unknown as ChatUser[]);
      setGroupName("");
      setSelectedMembers([]);
      setShowNewGroup(true);
    } catch {
      toast.error(t("widget.createGroupFailed"));
    }
  };

  const createGroup = async () => {
    if (!groupName.trim() || selectedMembers.length === 0) return;
    setShowNewGroup(false);
    try {
      const conv = await createGroupConversation(groupName.trim(), selectedMembers);
      await loadConversations();
      await selectConversation(conv as unknown as Conversation);
    } catch {
      toast.error(t("widget.createGroupFailed"));
    }
  };

  const handleMute = async (convId: string, minutes: number | null) => {
    try {
      await muteConversation(convId, minutes);
      await loadConversations();
    } catch {
      toast.error(t("widget.muteFailed"));
    }
  };

  const confirmPending = async () => {
    const action = pendingAction;
    setPendingAction(null);
    if (!action) return;
    try {
      if (action.kind === "leave") await leaveConversation(action.convId);
      else await deleteConversation(action.convId);
      if (activeConv?.id === action.convId) {
        setActiveConv(null);
        setMessages([]);
      }
      setConversations((prev) => prev.filter((c) => c.id !== action.convId));
    } catch {
      toast.error(action.kind === "leave" ? t("widget.leaveFailed") : t("widget.deleteFailed"));
      loadConversations().catch(() => undefined);
    }
  };

  const filtered = conversations.filter((c) => {
    const matchTab =
      tab === "all" || (tab === "direct" && c.type === "direct") || (tab === "groups" && c.type === "group");
    const name = convName(c, myId, unknown).toLowerCase();
    return matchTab && (!search || name.includes(search.toLowerCase()));
  });

  return (
    // ⚠️ The height has to clear the bottom bar as well as the header, or the
    // message box — the only control this page has — sits behind the tabs.
    //
    // Below md it is edge to edge, the way a messaging app is: `-m-4` cancels
    // the page's own padding (all four sides, including the 1rem the layout adds
    // above the tab bar), so the height is the screen less the header, the bar
    // and the safe area. It used to be 1rem taller than that, and the page
    // scrolled by exactly that much. `data-bottom-composer` keeps the floating
    // chat bubble off the send button (see chat-widget.tsx).
    <div
      data-bottom-composer=""
      className="flex h-[calc(100dvh-var(--app-header-height)-var(--mobile-nav-height)-var(--safe-bottom))] overflow-hidden bg-background max-md:-m-4 md:h-[calc(100dvh-4rem)] md:rounded-lg md:border"
    >
      {/*
        ⚠️ Two panes side by side is a 288px list beside a 55px conversation on
        a phone. Below md it is **one pane at a time**: the list, and then the
        conversation with a way back — which is what every messaging app on a
        phone does, and the only arrangement in which either is readable.

        ⚠️ The way back is the phone's Back too: an open conversation is a layer, like a dialog
        (src/hooks/use-back-dismiss.ts). Without it Back left the chat for the page before it.
      */}
      {activeConv && <BackToList onBack={() => setActiveConv(null)} />}
      <div className={cn("flex w-full shrink-0 flex-col border-r md:w-72", activeConv && "hidden md:flex")}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-semibold text-base">{t("messages")}</h2>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-9 md:size-7"
              onClick={openNewDm}
              title={t("newDmTitle")}
              aria-label={t("newDmTitle")}
            >
              <Edit className="h-4 w-4 md:h-3.5 md:w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-9 md:size-7"
              onClick={openNewGroup}
              title={t("newGroupTitle")}
              aria-label={t("newGroupTitle")}
            >
              <Plus className="h-4 w-4 md:h-3.5 md:w-3.5" />
            </Button>
          </div>
        </div>

        <div className="border-b px-3 py-2">
          <div className="relative">
            <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 text-muted-foreground" />
            {/* No `text-sm` below md: under 16px, iOS zooms the page on focus. */}
            <Input
              placeholder={t("searchPlaceholder")}
              className="h-9 pl-8 md:h-7"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="border-b px-3 py-2">
          <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
            <TabsList className="h-9 w-full md:h-7">
              <TabsTrigger value="all" className="flex-1 text-xs">
                {t("allTab")}
              </TabsTrigger>
              <TabsTrigger value="direct" className="flex-1 text-xs">
                {t("widget.directTab")}
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
              const name = convName(conv, myId, unknown);
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
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 px-3 py-3 text-left focus-visible:outline-none md:py-2.5"
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
                          {last ? formatTime(last.createdAt, format, t("yesterday")) : ""}
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
                    </div>
                  </button>

                  <div className="relative z-10 mr-1 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 md:mr-2">
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
                        <DropdownMenuSeparator />
                        {/* A group is left; only a direct conversation is deleted,
                            and then for both people, which the dialog says. */}
                        {isGroup ? (
                          <DropdownMenuItem
                            onClick={() => setPendingAction({ kind: "leave", convId: conv.id })}
                            className="text-destructive focus:text-destructive"
                          >
                            <LogOut className="mr-2 h-3.5 w-3.5" /> {t("leaveGroup")}
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onClick={() => setPendingAction({ kind: "delete", convId: conv.id })}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="mr-2 h-3.5 w-3.5" /> {t("delete")}
                          </DropdownMenuItem>
                        )}
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
      <div className={cn("flex min-w-0 flex-1 flex-col", !activeConv && "hidden md:flex")}>
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
            <div className="flex shrink-0 items-center gap-3 border-b bg-background px-3 py-2 md:px-4 md:py-3">
              {/* The way back to the list, which only exists on a phone. */}
              <Button
                variant="ghost"
                size="icon"
                className="-ml-1 size-9 shrink-0 md:hidden"
                onClick={() => setActiveConv(null)}
                aria-label={t("messages")}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <Avatar className="h-8 w-8 shrink-0">
                <AvatarFallback
                  className={cn(
                    "font-medium text-xs",
                    activeConv.type === "group"
                      ? "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
                      : "bg-primary/10 text-primary",
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
                <p className="truncate font-semibold text-sm leading-tight">{convName(activeConv, myId, unknown)}</p>
                {activeConv.type === "group" && (
                  <p className="text-muted-foreground text-xs">
                    {t("membersCount", { count: activeConv.members.length })}
                  </p>
                )}
              </div>
            </div>

            <ScrollArea className="min-h-0 flex-1 px-3 py-3 md:px-4 md:py-4">
              <div className="space-y-3">
                {hasOlder && (
                  <div className="flex justify-center">
                    <Button variant="ghost" size="sm" onClick={loadOlder} disabled={loadingOlder} className="gap-1.5">
                      <ChevronUp className="size-4" aria-hidden />
                      {t("loadOlder")}
                    </Button>
                  </div>
                )}
                {messages.length === 0 && (
                  <p className="py-8 text-center text-muted-foreground text-sm">{t("noMessagesYet")}</p>
                )}
                {/* ⚠️ In the order they were written, oldest at the top. `getMessages`
                    already returns them oldest first, and a second `.reverse()` here
                    put the newest message at the top of the thread and the oldest
                    beside the input box. */}
                {messages.map((msg, i) => {
                  const isMe = msg.senderId === myId;
                  const sameAuthor = messages[i - 1]?.senderId === msg.senderId;
                  return (
                    <div
                      key={msg.id}
                      className={cn("flex", isMe ? "justify-end" : "justify-start", sameAuthor && "-mt-2")}
                    >
                      {!isMe && (
                        <Avatar className={cn("mt-1 mr-2 h-7 w-7 shrink-0", sameAuthor && "invisible")}>
                          <AvatarFallback className="bg-muted text-[10px]">
                            {initials(msg.sender?.name ?? null, msg.sender?.email ?? null)}
                          </AvatarFallback>
                        </Avatar>
                      )}
                      {/* 65% of a phone is 220px, a few words a line. */}
                      <div className={cn("min-w-0 max-w-[80%] md:max-w-[65%]", isMe ? "items-end" : "items-start")}>
                        {!isMe && !sameAuthor && activeConv.type === "group" && (
                          <p className="mb-0.5 ml-0.5 text-[10px] text-muted-foreground">
                            {msg.sender?.name ?? msg.sender?.email ?? unknown}
                          </p>
                        )}
                        <ChatMessageBody
                          content={msg.content}
                          attachments={msg.attachments}
                          people={people}
                          myId={myId}
                          isMe={isMe}
                          bubbleClassName="px-3.5 py-2"
                        />
                        {(messages[i + 1]?.senderId !== msg.senderId || i === messages.length - 1) && (
                          <p className={cn("mt-0.5 px-0.5 text-[10px] text-muted-foreground", isMe && "text-right")}>
                            {formatTime(msg.createdAt, format, t("yesterday"))}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>
            </ScrollArea>

            {/* Keyed by conversation: a half-written message or a chosen file
                belongs to the conversation it was started in. */}
            <ChatComposer
              key={activeConv.id}
              conversationId={activeConv.id}
              people={mentionable}
              onSent={afterSend}
              className="px-3 py-2 md:px-4 md:py-3"
            />
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
            {chatUsers.length === 0 && (
              <p className="px-3 py-6 text-center text-muted-foreground text-sm">{t("noColleagues")}</p>
            )}
            <div className="space-y-1">
              {chatUsers
                .filter((u) => u.id !== myId)
                .map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-muted sm:py-2"
                    onClick={() => startDm(u.id)}
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
              {chatUsers.length === 0 && (
                <p className="px-3 py-6 text-center text-muted-foreground text-sm">{t("noColleagues")}</p>
              )}
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

      <AlertDialog open={pendingAction !== null} onOpenChange={(open) => !open && setPendingAction(null)}>
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
    </div>
  );
}
