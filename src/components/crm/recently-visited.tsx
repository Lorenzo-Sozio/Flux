"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import Link from "next/link";

import { ChevronRight, History, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useIsMobile } from "@/hooks/use-mobile";
import { ENTITY_GROUPS, ENTITY_TYPES, type EntityGroup, entityDef } from "@/lib/entities";
import { clearRecentRecords, RECENT_EVENT, type RecentRecord, readRecentRecords } from "@/lib/recent-records";
import { relativeTime } from "@/lib/relative-time";
import { cn } from "@/lib/utils";

import { EntityBadgeIcon } from "./entity-icon";
import { FullScreenPanel } from "./full-screen-panel";
import { useWorkspaceScope } from "./workspace-scope";

type Tab = "all" | EntityGroup;
const TAB_KEY = "flux.recent.tab";
const ALL_LIMIT = 12;

/**
 * The records opened most recently, by section.
 *
 * ⚠️ One flat list stopped working once there were more than four kinds of
 * record: a contact, two invoices, a ticket and a quote in one column is a list
 * nobody scans. "All" keeps the newest dozen for "the thing I just had open";
 * each section shows its own, grouped by kind, with only the sections that have
 * something in them — so a new kind of record adds a heading, not noise.
 */
export function RecentlyVisited() {
  const t = useTranslations("entities");
  const locale = useLocale();
  const scope = useWorkspaceScope();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<RecentRecord[]>([]);
  const [tab, setTab] = useState<Tab>("all");

  const load = useCallback(() => setItems(readRecentRecords(scope)), [scope]);

  useEffect(() => {
    if (!open) return;
    load();
    try {
      const saved = window.localStorage.getItem(TAB_KEY) as Tab | null;
      if (saved) setTab(saved);
    } catch {
      // A remembered tab is a convenience.
    }
    const onChange = () => load();
    window.addEventListener(RECENT_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(RECENT_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, [open, load]);

  const byGroup = useMemo(() => {
    const map = new Map<EntityGroup, RecentRecord[]>();
    for (const r of items) {
      const group = entityDef(r.type)?.group;
      if (!group) continue;
      map.set(group, [...(map.get(group) ?? []), r]);
    }
    return map;
  }, [items]);

  const groups = ENTITY_GROUPS.filter((g) => byGroup.has(g));
  const current: Tab = tab === "all" || byGroup.has(tab) ? tab : "all";

  const choose = (next: Tab) => {
    setTab(next);
    try {
      window.localStorage.setItem(TAB_KEY, next);
    } catch {
      // Remembering the tab is optional.
    }
  };

  const clear = () => {
    if (current === "all") clearRecentRecords(scope);
    else
      clearRecentRecords(
        scope,
        ENTITY_TYPES.filter((type) => entityDef(type)?.group === current),
      );
    load();
  };

  const isMobile = useIsMobile();

  const row = (item: RecentRecord, showType: boolean) => (
    <Link
      key={`${item.type}:${item.id}`}
      href={item.url}
      onClick={() => setOpen(false)}
      className={cn(
        "flex items-center gap-3 transition-colors",
        // A phone: a thumb's height, edge to edge, and a chevron that says it opens.
        isMobile ? "min-h-14 px-4 py-2.5 active:bg-muted/70" : "rounded-md px-2 py-2 hover:bg-muted/60",
      )}
    >
      <EntityBadgeIcon type={item.type} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-sm">{item.label}</span>
        <span className="block truncate text-muted-foreground text-xs">
          {[showType ? t(`types.${item.type}.one` as never) : null, item.sub].filter(Boolean).join(" · ")}
        </span>
      </span>
      <span className="shrink-0 text-[11px] text-muted-foreground">{relativeTime(item.at, locale)}</span>
      {isMobile && <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
    </Link>
  );

  const clearButton = items.length > 0 && (
    <Button
      variant="ghost"
      size="sm"
      className={cn("shrink-0 gap-1 text-muted-foreground", isMobile ? "h-9 text-sm" : "h-7 text-xs")}
      onClick={clear}
    >
      <Trash2 className={isMobile ? "size-4" : "h-3 w-3"} aria-hidden />
      {current === "all" ? t("recents.clear") : t("recents.clearGroup")}
    </Button>
  );

  const trigger = (
    <Button
      variant="ghost"
      size="icon"
      // On a phone the same 40px target as the search beside it.
      className="relative h-8 w-8 max-md:size-10"
      aria-label={t("recents.button")}
      title={t("recents.button")}
      onClick={isMobile ? () => setOpen(true) : undefined}
    >
      <History className="h-4 w-4 max-md:size-5" />
    </Button>
  );

  const body =
    items.length === 0 ? (
      <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
        <History className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-muted-foreground text-sm">{t("recents.empty")}</p>
      </div>
    ) : (
      <>
        {/* Sections that have something, as chips: they wrap rather than scroll, so none is hidden. */}
        <div
          role="tablist"
          aria-label={t("recents.title")}
          className={cn("flex flex-wrap border-b", isMobile ? "gap-2 px-4 py-2.5" : "gap-1 px-3 py-2")}
        >
          {(["all", ...groups] as Tab[]).map((g) => {
            const count = g === "all" ? items.length : (byGroup.get(g)?.length ?? 0);
            return (
              <button
                key={g}
                type="button"
                role="tab"
                aria-selected={current === g}
                onClick={() => choose(g)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border transition-colors",
                  isMobile ? "h-9 px-3.5 font-medium text-sm" : "px-2.5 py-0.5 text-xs",
                  current === g ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                )}
              >
                {g === "all" ? t("recents.all") : t(`groups.${g}` as never)}
                <span className={cn("tabular-nums", current === g ? "opacity-80" : "text-muted-foreground")}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* On a phone the list is the screen; in the popover a box that scrolls. */}
        <div className={isMobile ? "divide-y" : "max-h-[min(24rem,60dvh)] overflow-y-auto p-1.5"}>
          {current === "all"
            ? items.slice(0, isMobile ? ALL_LIMIT * 2 : ALL_LIMIT).map((item) => row(item, true))
            : ENTITY_TYPES.filter((type) => entityDef(type)?.group === current).map((type) => {
                const ofType = (byGroup.get(current) ?? []).filter((r) => r.type === type);
                if (ofType.length === 0) return null;
                return (
                  <div key={type} className="mb-1">
                    <p
                      className={cn(
                        "pt-2 pb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide",
                        isMobile ? "bg-muted/60 px-4 py-1.5" : "px-2",
                      )}
                    >
                      {t(`types.${type}.other` as never)}
                    </p>
                    {ofType.map((item) => row(item, false))}
                  </div>
                );
              })}
        </div>
      </>
    );

  // ⚠️ On a phone the whole screen, as the search: the popover was a box over the page, its list
  // capped at a third of the screen and its rows a fingertip tall.
  if (isMobile) {
    return (
      <>
        {trigger}
        <FullScreenPanel
          open={open}
          onOpenChange={setOpen}
          title={t("recents.title")}
          description={t("recents.hint")}
          action={clearButton}
          footer={<p className="px-4 py-2.5 text-muted-foreground text-xs">{t("recents.hint")}</p>}
        >
          {body}
        </FullScreenPanel>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
          <div className="min-w-0">
            <p className="font-semibold text-sm">{t("recents.title")}</p>
            <p className="truncate text-muted-foreground text-xs">{t("recents.hint")}</p>
          </div>
          {clearButton}
        </div>
        {body}
      </PopoverContent>
    </Popover>
  );
}
