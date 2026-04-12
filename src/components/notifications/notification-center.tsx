"use client";

import { useState, useTransition, useEffect, useCallback } from "react";
import { Bell, CheckCheck, ExternalLink } from "lucide-react";
import Link from "next/link";
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/actions/auth";
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
  system: "ℹ️",
};

interface Props {
  notifications: Notification[];
  userId: string;
}

const POLL_INTERVAL_MS = 60_000; // 60 seconds

export function NotificationCenter({ notifications: initial, userId }: Props) {
  const [items, setItems] = useState(initial);
  const [isPending, startTransition] = useTransition();

  // Poll for new notifications every 60s
  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.notifications ?? []);
    } catch {
      // Silently ignore network errors during polling
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(fetchNotifications, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [fetchNotifications]);

  const unreadCount = items.filter((n) => !n.isRead).length;

  const handleMarkRead = (id: string) => {
    startTransition(async () => {
      await markNotificationReadAction(id);
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    });
  };

  const handleMarkAllRead = () => {
    startTransition(async () => {
      await markAllNotificationsReadAction(userId);
      setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-8 w-8">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <Badge
              className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full p-0 text-[10px]"
            >
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
              <p className="text-sm text-muted-foreground">No notifications yet</p>
            </div>
          ) : (
            <div className="divide-y">
              {items.map((n) => (
                <div
                  key={n.id}
                  className={cn(
                    "flex gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50",
                    !n.isRead && "bg-primary/5"
                  )}
                >
                  <span className="mt-0.5 text-base" aria-hidden>
                    {TYPE_ICONS[n.type] ?? "📌"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-sm leading-tight", !n.isRead && "font-medium")}>
                      {n.title}
                    </p>
                    {n.message && (
                      <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                        {n.message}
                      </p>
                    )}
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {new Date(n.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    {!n.isRead && (
                      <button
                        className="h-2 w-2 rounded-full bg-primary flex-shrink-0 mt-1"
                        title="Mark as read"
                        onClick={() => handleMarkRead(n.id)}
                      />
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
