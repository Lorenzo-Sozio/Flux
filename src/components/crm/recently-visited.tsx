"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import Link from "next/link";

import { History, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ENTITY_GROUPS, ENTITY_TYPES, type EntityGroup, entityDef } from "@/lib/entities";
import { clearRecentRecords, RECENT_EVENT, type RecentRecord, readRecentRecords } from "@/lib/recent-records";
import { cn } from "@/lib/utils";

import { EntityBadgeIcon } from "./entity-icon";
import { useWorkspaceScope } from "./workspace-scope";

type Tab = "all" | EntityGroup;
const TAB_KEY = "flux.recent.tab";
const ALL_LIMIT = 12;

/** "3 min ago", "yesterday", in the interface language. */
function relative(at: number, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const mins = Math.round((at - Date.now()) / 60_000);
  if (Math.abs(mins) < 60) return rtf.format(mins, "minute");
  const hours = Math.round(mins / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, "hour");
  return rtf.format(Math.round(hours / 24), "day");
}

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

  const row = (item: RecentRecord, showType: boolean) => (
    <Link
      key={`${item.type}:${item.id}`}
      href={item.url}
      onClick={() => setOpen(false)}
      className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/60"
    >
      <EntityBadgeIcon type={item.type} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-sm">{item.label}</span>
        <span className="block truncate text-muted-foreground text-xs">
          {[showType ? t(`types.${item.type}.one` as never) : null, item.sub].filter(Boolean).join(" · ")}
        </span>
      </span>
      <span className="shrink-0 text-[11px] text-muted-foreground">{relative(item.at, locale)}</span>
    </Link>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-8 w-8"
          aria-label={t("recents.button")}
          title={t("recents.button")}
        >
          <History className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
          <div className="min-w-0">
            <p className="font-semibold text-sm">{t("recents.title")}</p>
            <p className="truncate text-muted-foreground text-xs">{t("recents.hint")}</p>
          </div>
          {items.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 gap-1 text-muted-foreground text-xs"
              onClick={clear}
            >
              <Trash2 className="h-3 w-3" />
              {current === "all" ? t("recents.clear") : t("recents.clearGroup")}
            </Button>
          )}
        </div>

        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
            <History className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-muted-foreground text-sm">{t("recents.empty")}</p>
          </div>
        ) : (
          <>
            {/* Sections that have something, as chips: they wrap rather than scroll, so none is hidden. */}
            <div role="tablist" aria-label={t("recents.title")} className="flex flex-wrap gap-1 border-b px-3 py-2">
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
                      "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition-colors",
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

            <div className="max-h-[min(24rem,60dvh)] overflow-y-auto p-1.5">
              {current === "all"
                ? items.slice(0, ALL_LIMIT).map((item) => row(item, true))
                : ENTITY_TYPES.filter((type) => entityDef(type)?.group === current).map((type) => {
                    const ofType = (byGroup.get(current) ?? []).filter((r) => r.type === type);
                    if (ofType.length === 0) return null;
                    return (
                      <div key={type} className="mb-1">
                        <p className="px-2 pt-2 pb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
                          {t(`types.${type}.other` as never)}
                        </p>
                        {ofType.map((item) => row(item, false))}
                      </div>
                    );
                  })}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
