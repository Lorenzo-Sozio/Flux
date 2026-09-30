"use client";

import { useCallback, useMemo, useState, useTransition } from "react";

import Link from "next/link";

import { Bell, CheckCheck, ChevronRight, ExternalLink, Settings2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { markAllNotificationsReadAction, markNotificationReadAction } from "@/actions/auth";
import { FullScreenPanel } from "@/components/crm/full-screen-panel";
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
import { useIsMobile } from "@/hooks/use-mobile";
import { type DayBucket, dayBucket, relativeTime } from "@/lib/relative-time";
import { cn } from "@/lib/utils";

type Notification = {
  id: string;
  type: string;
  title: string;
  message: string | null;
  /** Set on everything the product composes itself: composed again here, in the reader's language. */
  titleKey?: string | null;
  params?: Record<string, string | number> | null;
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
  chat_mention: "@",
  sla_warning: "⏳",
  sla_breach: "⏰",
  contract_renewal: "📄",
  sequence_reply: "↩️",
  email_reply: "✉️",
  quote_viewed: "👀",
  quote_accepted: "✅",
  quote_declined: "❌",
  appointment_reminder: "📅",
  booking_received: "🗓️",
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
  // ⚠️ These five strings were hardcoded English in an otherwise translated
  // product, so an Italian workspace got "Mark all read" in the middle of its
  // own language — in the panel people open most often.
  const t = useTranslations("notificationCenter");
  const tn = useTranslations("notificationTexts");
  /**
   * The text in the reader's language when the row says how it was composed; otherwise the
   * text stored with it — an automation's own words, or a row older than the key.
   */
  const textOf = (n: Notification) => {
    if (n.titleKey && tn.has(`${n.titleKey}.title` as never)) {
      const params = n.params ?? {};
      return {
        title: tn(`${n.titleKey}.title` as never, params as never),
        message: tn.has(`${n.titleKey}.message` as never)
          ? tn(`${n.titleKey}.message` as never, params as never)
          : n.message,
      };
    }
    return { title: n.title, message: n.message };
  };
  const [isPending, startTransition] = useTransition();
  const locale = useLocale();

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

  const isMobile = useIsMobile();
  const [panelOpen, setPanelOpen] = useState(false);

  const bell = (
    <Button
      variant="ghost"
      size="icon"
      // On a phone the same 40px target as the search and the recents beside it.
      className="relative h-8 w-8 max-md:size-10"
      aria-label={t("title")}
      title={t("title")}
      onClick={isMobile ? () => setPanelOpen(true) : undefined}
    >
      <Bell className="h-4 w-4 max-md:size-5" />
      {unreadCount > 0 && (
        <Badge className="-right-1 -top-1 absolute flex h-4 w-4 items-center justify-center rounded-full p-0 text-[10px]">
          {unreadCount > 9 ? "9+" : unreadCount}
        </Badge>
      )}
    </Button>
  );

  // ⚠️ On a phone the bell opens the whole screen, as the search does: the dropdown was a 320px
  // box whose list was 320px tall, a third of the screen, with the page still under it to tap by
  // mistake and a link icon the size of a fingertip's edge.
  if (isMobile) {
    return (
      <>
        {bell}
        <NotificationsPanel
          open={panelOpen}
          onOpenChange={setPanelOpen}
          items={items}
          unreadCount={unreadCount}
          textOf={textOf}
          onMarkRead={handleMarkRead}
          onMarkAllRead={handleMarkAllRead}
          pending={isPending}
        />
      </>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{bell}</DropdownMenuTrigger>
      {/* 20rem is wider than the margin a 360px phone leaves, so the panel
          would be clipped at one edge. It takes what is there instead. */}
      <DropdownMenuContent align="end" className="w-[min(20rem,calc(100vw-1.5rem))]">
        <DropdownMenuLabel className="flex items-center justify-between py-3">
          <span>{t("title")}</span>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 text-xs"
              onClick={handleMarkAllRead}
              disabled={isPending}
            >
              <CheckCheck className="h-3 w-3" />
              {t("markAllRead")}
            </Button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <ScrollArea className="h-80">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Bell className="mb-2 h-8 w-8 text-muted-foreground/40" />
              <p className="text-muted-foreground text-sm">{t("empty")}</p>
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
                    title={n.isRead ? undefined : t("markRead")}
                    className={cn("min-w-0 flex-1 text-left", !n.isRead && "cursor-pointer")}
                  >
                    <p className={cn("text-sm leading-tight", !n.isRead && "font-medium")}>{textOf(n).title}</p>
                    {textOf(n).message && (
                      <p className="mt-0.5 line-clamp-2 text-muted-foreground text-xs">{textOf(n).message}</p>
                    )}
                    <p
                      className="mt-1 text-[10px] text-muted-foreground"
                      title={new Date(n.createdAt).toLocaleString()}
                    >
                      {relativeTime(n.createdAt, locale)}
                    </p>
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
        <DropdownMenuSeparator />
        {/* ⚠️ Without this the setting is unreachable in practice. Push
            notifications are off until somebody grants permission, and nobody
            goes looking through Settings for a feature they were never told
            exists. The bell is where a person already is when they think about
            notifications. */}
        <Link
          href="/dashboard/settings/notifications"
          className="flex items-center gap-2 px-3 py-2.5 text-muted-foreground text-xs hover:bg-muted/50 hover:text-foreground"
        >
          <Settings2 className="h-3.5 w-3.5" />
          {t("settings")}
        </Link>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const BUCKETS: DayBucket[] = ["today", "yesterday", "week", "older"];

/**
 * The bell on a phone: the whole screen, like the search.
 *
 * - A row is one target, the height of a thumb: tapping it opens what the notification is about
 *   (and marks it read), or only marks it read when it points nowhere. The small link icon beside
 *   the text on the desktop was a miss waiting to happen.
 * - "To read" filters the ones not seen yet; the rows are grouped by day, newest first, and say
 *   how long ago rather than a date and a time to the second.
 * - The notification settings stay one tap away, at the bottom, where the thumb is.
 */
function NotificationsPanel({
  open,
  onOpenChange,
  items,
  unreadCount,
  textOf,
  onMarkRead,
  onMarkAllRead,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: Notification[];
  unreadCount: number;
  textOf: (n: Notification) => { title: string; message: string | null };
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  pending: boolean;
}) {
  const t = useTranslations("notificationCenter");
  const locale = useLocale();
  const [onlyUnread, setOnlyUnread] = useState(false);
  const shown = onlyUnread ? items.filter((n) => !n.isRead) : items;
  const grouped = useMemo(() => {
    const map = new Map<DayBucket, Notification[]>();
    for (const n of shown) {
      const b = dayBucket(n.createdAt);
      map.set(b, [...(map.get(b) ?? []), n]);
    }
    return BUCKETS.filter((b) => map.has(b)).map((b) => ({ bucket: b, rows: map.get(b) ?? [] }));
  }, [shown]);

  const row = (n: Notification) => {
    const text = textOf(n);
    const body = (
      <>
        <span className="mt-0.5 w-6 shrink-0 text-center text-lg leading-none" aria-hidden>
          {TYPE_ICONS[n.type] ?? "📌"}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn("block text-sm leading-snug", !n.isRead && "font-semibold")}>{text.title}</span>
          {text.message && (
            <span className="mt-0.5 line-clamp-3 block text-muted-foreground text-sm leading-snug">{text.message}</span>
          )}
          <span className="mt-1 block text-muted-foreground text-xs">{relativeTime(n.createdAt, locale)}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2 self-center">
          {!n.isRead && (
            <>
              <span className="size-2.5 rounded-full bg-primary" aria-hidden />
              <span className="sr-only">{t("unread")}</span>
            </>
          )}
          {n.link && <ChevronRight className="size-4 text-muted-foreground" aria-hidden />}
        </span>
      </>
    );
    const classes = cn(
      "flex min-h-16 w-full items-start gap-3 px-4 py-3 text-left transition-colors active:bg-muted/70",
      !n.isRead && "bg-primary/5",
    );
    return n.link ? (
      <Link
        key={n.id}
        href={n.link}
        className={classes}
        onClick={() => {
          if (!n.isRead) onMarkRead(n.id);
          onOpenChange(false);
        }}
      >
        {body}
      </Link>
    ) : (
      <button
        key={n.id}
        type="button"
        className={classes}
        disabled={n.isRead}
        onClick={() => onMarkRead(n.id)}
        aria-label={n.isRead ? undefined : `${text.title} — ${t("markRead")}`}
      >
        {body}
      </button>
    );
  };

  return (
    <FullScreenPanel
      open={open}
      onOpenChange={onOpenChange}
      title={t("title")}
      description={t("description")}
      action={
        unreadCount > 0 && (
          <Button variant="ghost" size="sm" className="h-9 shrink-0 gap-1.5" onClick={onMarkAllRead} disabled={pending}>
            <CheckCheck className="size-4" aria-hidden />
            {t("markAllReadShort")}
          </Button>
        )
      }
      footer={
        <Link
          href="/dashboard/settings/notifications"
          onClick={() => onOpenChange(false)}
          className="flex min-h-12 items-center gap-2 px-4 text-muted-foreground text-sm active:bg-muted/70"
        >
          <Settings2 className="size-4" aria-hidden />
          <span className="flex-1">{t("settings")}</span>
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      }
    >
      {/* All, or only what has not been seen: two chips, never a second row. */}
      <div className="flex gap-2 border-b px-4 py-2.5">
        {([false, true] as const).map((unread) => (
          <button
            key={String(unread)}
            type="button"
            aria-pressed={onlyUnread === unread}
            onClick={() => setOnlyUnread(unread)}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 font-medium text-sm transition-colors",
              onlyUnread === unread ? "border-primary bg-primary text-primary-foreground" : "active:bg-muted",
            )}
          >
            {unread ? t("filterUnread") : t("filterAll")}
            {unread && unreadCount > 0 && <span className="tabular-nums opacity-80">{unreadCount}</span>}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
          <Bell className="size-10 text-muted-foreground/40" aria-hidden />
          <p className="text-muted-foreground text-sm">{onlyUnread ? t("emptyUnread") : t("empty")}</p>
        </div>
      ) : (
        grouped.map(({ bucket, rows }) => (
          <section key={bucket} aria-label={t(`days.${bucket}`)}>
            <h3 className="sticky top-14 bg-muted/60 px-4 py-1.5 font-medium text-muted-foreground text-xs uppercase tracking-wide backdrop-blur">
              {t(`days.${bucket}`)}
            </h3>
            <div className="divide-y">{rows.map(row)}</div>
          </section>
        ))
      )}
    </FullScreenPanel>
  );
}
