"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * The chat's unread count, where a menu names the chat.
 *
 * ⚠️ It does not ask the server: the chat widget already polls the count (backing
 * off, and stopping when the tab is hidden) and broadcasts it as `flux:chat-unread`.
 * A second poll here would double the queries for a number the page already has —
 * and every query wakes the database (CLAUDE.md). The event name is repeated
 * rather than imported so that the menus do not pull the widget into their bundle.
 */
const CHAT_UNREAD_EVENT = "flux:chat-unread";
const CHAT_URL = "/dashboard/chat";

/** The last count broadcast, for a menu that mounts after it (the phone's Menu hub opens later). */
export function lastChatUnread(): number {
  if (typeof window === "undefined") return 0;
  return Number((window as Window & { __fluxChatUnread?: number }).__fluxChatUnread) || 0;
}

export function useChatUnread() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(lastChatUnread());
    const onCount = (e: Event) => setCount(Number((e as CustomEvent<number>).detail) || 0);
    window.addEventListener(CHAT_UNREAD_EVENT, onCount);
    return () => window.removeEventListener(CHAT_UNREAD_EVENT, onCount);
  }, []);
  return count;
}

/** Renders nothing unless `url` is the chat and something is unread. */
export function ChatUnreadBadge({ url, className }: { url: string; className?: string }) {
  const count = useChatUnread();
  if (url !== CHAT_URL || count === 0) return null;
  return (
    <span
      className={cn(
        "ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-destructive px-1.5 font-semibold text-[11px] text-white tabular-nums leading-none",
        className,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
