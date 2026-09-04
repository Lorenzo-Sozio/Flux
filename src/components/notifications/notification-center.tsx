"use client";

import { useCallback, useState, useTransition } from "react";

import Link from "next/link";

import { Bell, CheckCheck, ExternalLink } from "lucide-react";

import { markAllNotificationsReadAction, markNotificationReadAction } from "@/actions/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLivePoll } from "@/hooks/use-live-poll";
import { cn } from "@/lib/utils";

type Notification = {
  id: string;
  type: string;
  title: string;
  message: string | null;
  link: string | null;
  isRead: boolean;
  createdAt: Date;
};

const TYPE_ICONS: Record<string, string> = {
  task_due: "🔔",
  deal_won: "🏆",
  lead_assigned: "👤",
  email_sent: "📧",
  chat_message: "💬",
  sla_warning: "⏳",
  sla_breach: "⏰",
  system: "ℹ️",
};

interface Props {
  notifications: Notification[];
  /** Kept for the caller's convenience; the server derives the owner itself. */
  userId?: string;
}

/** How often to ask when something has just happened. */
const POLL_BASE_MS = 45_000;
/** And how rarely once nothing has, or the tab is in the background. */
const POLL_MAX_MS = 5 * 60_000;

export function NotificationCenter({ notifications: initial }: Props) {
  const [items, setItems] = useState(initial);
  const [serverUnread, setServerUnread] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

  /**
   * Asks only for what arrived after the newest row already held.
   *
   * This used to pull fifty complete rows every sixty seconds whether or not
   * anything had changed, in every open tab (audit rilievo U-11). Returns whether
   * anything came back, which is what decides how soon to ask again.
   */
  const fetchNotifications = useCallback(async () => {
    const newest = items.reduce<number>((max, n) => Math.max(max, new Date(n.createdAt).getTime()), 0);
    const query = newest > 0 ? `?since=${encodeURIComponent(new Date(newest).toISOString())}` : "";

    const res = await fetch(`/api/notifications${query}`);
    if (!res.ok) return false;
    const data = (await res.json()) as {
      notifications: Notification[];
      unreadCount: number;
      incremental: boolean;
    };

    if (typeof data.unreadCount === "number") setServerUnread(data.unreadCount);

    const arrived = data.notifications ?? [];
    if (!data.incremental) {
      setItems(arrived);
      return arrived.length > 0;
    }
    if (arrived.length === 0) return false;

    // Merged by id, because a row can arrive twice on a boundary second.
    setItems((prev) => {
      const seen = new Set(prev.map((n) => n.id));
      const fresh = arrived.filter((n) => !seen.has(n.id));
      return fresh.length ? [...fresh, ...prev] : prev;
    });
    return true;
  }, [items]);

  useLivePoll(fetchNotifications, { baseMs: POLL_BASE_MS, maxMs: POLL_MAX_MS });

  // The server's count includes unread rows older than the page held here, so it
  // wins when it is known; the local one keeps the badge honest between polls.
  const localUnread = items.filter((n) => !n.isRead).length;
  const unreadCount = serverUnread !== null ? Math.max(serverUnread, localUnread) : localUnread;

  const handleMarkRead = (id: string) => {
    startTransition(async () => {
      await markNotificationReadAction(id);
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
      setServerUnread((n) => (n === null ? n : Math.max(0, n - 1)));
    });
  };

  const handleMarkAllRead = () => {
    startTransition(async () => {
      await markAllNotificationsReadAction();
      setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setServerUnread(0);
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-8 w-8">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <Badge className="-right-1 -top-1 absolute flex h-4 w-4 items-center justify-center rounded-full p-0 text-[10px]">
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between py-3">
          <span>Notifications</span>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 text-xs"
              onClick={handleMarkAllRead}
              disabled={isPending}
            >
              <CheckCheck className="h-3 w-3" />
              Mark all read
            </Button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <ScrollArea className="h-80">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Bell className="mb-2 h-8 w-8 text-muted-foreground/40" />
              <p className="text-muted-foreground text-sm">No notifications yet</p>
            </div>
          ) : (
            <div className="divide-y">
              {items.map((n) => (
                // Marking one read is a control, so it is a button and can be
                // reached from the keyboard; the link beside it sits outside that
                // button rather than nested inside it. The row was a div with a
                // click handler, which no keyboard could reach and no screen
                // reader announced as anything at all.
                <div
                  key={n.id}
                  className={cn(
                    "group flex gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50",
                    !n.isRead && "bg-primary/5",
                  )}
                >
                  <span className="mt-0.5 text-base" aria-hidden>
                    {TYPE_ICONS[n.type] ?? "📌"}
                  </span>
                  <button
                    type="button"
                    disabled={n.isRead}
                    onClick={() => handleMarkRead(n.id)}
                    title={n.isRead ? undefined : "Mark as read"}
                    className={cn("min-w-0 flex-1 text-left", !n.isRead && "cursor-pointer")}
                  >
                    <p className={cn("text-sm leading-tight", !n.isRead && "font-medium")}>{n.title}</p>
                    {n.message && <p className="mt-0.5 line-clamp-2 text-muted-foreground text-xs">{n.message}</p>}
                    <p className="mt-1 text-[10px] text-muted-foreground">{new Date(n.createdAt).toLocaleString()}</p>
                  </button>
                  <div className="flex flex-col items-center gap-1">
                    {!n.isRead && (
                      <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-primary transition-opacity group-hover:opacity-50" />
                    )}
                    {n.link && (
                      <Link href={n.link} className="text-muted-foreground hover:text-foreground">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
