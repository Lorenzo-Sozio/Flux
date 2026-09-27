"use client";

import * as React from "react";

import { useRouter } from "next/navigation";

import { Command as CommandPrimitive } from "cmdk";
import {
  ArrowRight,
  ChevronDown,
  Clock,
  CornerDownLeft,
  Loader2,
  Plus,
  RotateCcw,
  Search,
  SearchX,
  X,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { EntityBadgeIcon, entityIcon } from "@/components/crm/entity-icon";
import { useWorkspaceScope } from "@/components/crm/workspace-scope";
import { Button } from "@/components/ui/button";
import { CommandDialog, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsMobile } from "@/hooks/use-mobile";
import { ENTITIES, ENTITY_GROUPS, type EntityGroup, type EntityType, entityDef, entityInPlan } from "@/lib/entities";
import { matchCommands, navigationCommands, PALETTE_COMMANDS, type PaletteCommand } from "@/lib/palette-commands";
import { can, type TenantRole } from "@/lib/permissions";
import { type RecentRecord, readRecentRecords, rememberRecord } from "@/lib/recent-records";
import type { SearchHit } from "@/lib/search/providers";
import { cn } from "@/lib/utils";
import { applyNavAccess, type NavAccess } from "@/navigation/sidebar/filter-nav";
import { sidebarItems } from "@/navigation/sidebar/sidebar-items";

type Group = { type: EntityType; hits: SearchHit[] };
type Filter = "all" | EntityGroup;

/**
 * How many hits a section returns at most — `PER_ENTITY` in src/lib/search/providers.ts.
 * Repeated rather than imported: that module holds the queries and the schema, and
 * importing a value from it would put them in the browser bundle.
 */
const PER_SECTION = 5;

/**
 * Opens the palette from anywhere: the phone's Menu hub and its top bar have no
 * keyboard shortcut to press.
 */
export const OPEN_SEARCH_EVENT = "flux:open-search";

/** The part of `text` that matched, in bold: the eye finds why a row is there without reading it. */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (q.length < 2) return <>{text}</>;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "ig"));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === q.toLowerCase() ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the split is stable for a given text and query
          <mark key={i} className="rounded-[3px] bg-primary/15 px-px font-semibold text-foreground">
            {part}
          </mark>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: as above
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      )}
    </>
  );
}

/** The key that goes with K: ⌘ on a Mac, Ctrl everywhere else. The hint showed ⌘ to Windows users. */
function useModifierLabel() {
  const [label, setLabel] = React.useState("⌘");
  React.useEffect(() => {
    const platform =
      (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
      navigator.platform ??
      "";
    if (!/mac|iphone|ipad/i.test(platform)) setLabel("Ctrl");
  }, []);
  return label;
}

/**
 * The palette: find any record, run any verb.
 *
 * ⚠️ Driven by src/lib/entities.ts. It kept its own tables of seven entities —
 * icons, badges, groups, quick links — so invoices, contracts, credit notes and
 * the rest never appeared, whatever the search route returned.
 *
 * ⚠️ Everything in it is a `CommandItem`, the recents and the create buttons
 * included: they were plain buttons, so the palette opened on a list the arrow
 * keys could not reach, and the one tool built for the keyboard needed the mouse
 * for its first screen.
 *
 * It keeps one size whatever it holds. It used to grow and shrink with each
 * keystroke — a search box jumping under the cursor while somebody types.
 */
export function SearchDialog({
  tenantRole,
  enabledModules,
  navAccess,
}: {
  tenantRole?: TenantRole;
  /** The plan's modules; null when not known, which hides nothing. */
  enabledModules?: string[] | null;
  /** The server's verdict on the menu: the sections the palette can go to (§4.3). */
  navAccess?: NavAccess;
}) {
  const t = useTranslations("search");
  const te = useTranslations("entities");
  const tn = useTranslations("nav");
  const format = useFormatter();
  const router = useRouter();
  const scope = useWorkspaceScope();
  const isMobile = useIsMobile();
  const modifier = useModifierLabel();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<Filter>("all");
  const [groups, setGroups] = React.useState<Group[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = React.useRef(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [recent, setRecent] = React.useState<RecentRecord[]>([]);
  // The row the keyboard is on. Held here rather than left to cmdk, which keeps
  // the old selection when the items change under it with filtering off: results
  // arrived with nothing selected, and Enter did nothing.
  const [selected, setSelected] = React.useState("");

  /** Sections this person can search at all: what they may read, in their plan. */
  const sections = React.useMemo(
    () =>
      ENTITY_GROUPS.filter((g) =>
        ENTITIES.some((e) => e.group === g && can(tenantRole ?? null, e.read) && entityInPlan(e, enabledModules)),
      ),
    [tenantRole, enabledModules],
  );

  const allow = React.useCallback(
    (command: PaletteCommand) =>
      (command.capability ? can(tenantRole ?? null, command.capability) : true) &&
      (!command.module || !enabledModules || enabledModules.includes(command.module)),
    [tenantRole, enabledModules],
  );
  // Every section of the menu this person may open, as "go to" commands — the secondary
  // ones included, since this is where somebody finds what their menu leaves out.
  const navGroups = React.useMemo(() => (navAccess ? applyNavAccess(sidebarItems, navAccess) : []), [navAccess]);
  const navCommands = React.useMemo(() => navigationCommands(navGroups), [navGroups]);
  const navIcons = React.useMemo(() => {
    const icons = new Map<string, React.ElementType>();
    for (const g of navGroups)
      for (const item of g.items) {
        if (item.icon) icons.set(item.url, item.icon);
        for (const sub of item.subItems ?? []) if (sub.icon) icons.set(sub.url, sub.icon);
      }
    return icons;
  }, [navGroups]);
  const commandLabel = React.useCallback(
    (command: PaletteCommand) =>
      command.entity ? te(`types.${command.entity}.new` as never) : tn(`items.${command.navTitleKey}` as never),
    [te, tn],
  );
  const commandMatches = React.useMemo(
    () => matchCommands(query, allow, commandLabel, 6, [...PALETTE_COMMANDS, ...navCommands]),
    [query, allow, commandLabel, navCommands],
  );
  // In the registry's section order, so the grid reads CRM, sales, documents…
  const createCommands = React.useMemo(
    () => ENTITY_GROUPS.flatMap((g) => PALETTE_COMMANDS.filter((c) => c.entity && c.group === g && allow(c))),
    [allow],
  );

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // ⌘K is what every comparable product uses; ⌘J stays for whoever learnt it.
      if ((e.key === "k" || e.key === "j") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const openFromEvent = () => setOpen(true);
    document.addEventListener("keydown", down);
    window.addEventListener(OPEN_SEARCH_EVENT, openFromEvent);
    return () => {
      document.removeEventListener("keydown", down);
      window.removeEventListener(OPEN_SEARCH_EVENT, openFromEvent);
    };
  }, []);

  React.useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setRecent(readRecentRecords(scope).slice(0, 6));
    }
  }, [open, scope]);

  const search = React.useCallback(async (q: string, f: Filter) => {
    const term = q.trim();
    if (term.length < 2) {
      requestRef.current++;
      setGroups(null);
      setLoading(false);
      setFailed(false);
      return;
    }
    const request = ++requestRef.current;
    setLoading(true);
    setFailed(false);
    try {
      const types =
        f === "all"
          ? ""
          : ENTITIES.filter((e) => e.group === f)
              .map((e) => e.type)
              .join(",");
      const res = await fetch(`/api/search?q=${encodeURIComponent(term)}${types ? `&types=${types}` : ""}`);
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { groups?: Group[] };
      // A slow answer to an older query must not replace a newer one.
      if (request === requestRef.current) setGroups(data.groups ?? []);
    } catch {
      // ⚠️ Said, not swallowed: a failed request used to look exactly like a
      // search that found nothing, and "no such customer" is a wrong answer.
      if (request === requestRef.current) {
        setGroups(null);
        setFailed(true);
      }
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, []);

  const handleValueChange = (val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // The spinner starts with the keystroke, not with the request a quarter of a
    // second later: that quarter-second was a still screen that looked finished.
    if (val.trim().length >= 2) setLoading(true);
    debounceRef.current = setTimeout(() => search(val, filter), 250);
  };

  const chooseFilter = (f: Filter) => {
    setFilter(f);
    search(query, f);
    inputRef.current?.focus();
  };

  const clearQuery = () => {
    setQuery("");
    search("", filter);
    inputRef.current?.focus();
  };

  const handleClose = () => {
    setOpen(false);
    setQuery("");
    setGroups(null);
    setFilter("all");
    setFailed(false);
    setLoading(false);
  };

  const go = (url: string) => {
    handleClose();
    router.push(url);
  };

  const openHit = (hit: SearchHit) => {
    // Documents open on their parent record, which records its own visit.
    if (hit.type !== "document") {
      rememberRecord(scope, { type: hit.type, id: hit.id, label: hit.label, sub: hit.sub, url: hit.url });
    }
    go(hit.url);
  };

  /** What sits under the name: who or what it belongs to, its state, its figure. */
  const hitDetail = (hit: SearchHit) => {
    const parts: string[] = [];
    if (hit.sub) parts.push(hit.sub);
    if (hit.type === "document" && hit.status) {
      parts.push(te("attachedTo", { type: te(`types.${hit.status}.one` as never) }));
    } else if (hit.status && te.has(`statuses.${hit.status}` as never)) {
      parts.push(te(`statuses.${hit.status}` as never));
    }
    if (hit.amount) {
      parts.push(format.number(Number(hit.amount.value), { style: "currency", currency: hit.amount.currency }));
    }
    return parts.join(" · ");
  };

  const term = query.trim();
  const total = groups?.reduce((n, g) => n + g.hits.length, 0) ?? 0;
  const sectionName = (f: Filter) => (f === "all" ? te("search.all") : te(`groups.${f}` as never));
  const showEmpty = !loading && !failed && term.length >= 2 && groups !== null && total === 0;
  const showSkeleton = loading && groups === null && term.length >= 2;

  /** The ↵ that appears on the row the keyboard is on — desktop only, a phone has no Enter to press here. */
  const enterHint = (
    <CornerDownLeft
      className="size-3.5 shrink-0 text-muted-foreground opacity-0 group-data-[selected=true]/command-item:opacity-100 max-sm:hidden"
      aria-hidden
    />
  );

  /**
   * Verbs that match what was typed: "nuovo pr" → Nuovo preventivo. ⚠️ Below the
   * records when there are records: a verb matched on two letters ("an" finds
   * "Vinte / perse" through a keyword) sat on top, took the selection, and Enter
   * opened a report instead of the customer somebody was typing the name of.
   */
  const hasRecords = total > 0;
  const actions =
    term.length >= 1 && commandMatches.length > 0 ? (
      <CommandGroup heading={te("search.actions")} className="px-2 pt-2">
        {commandMatches.map((command) => {
          const Icon = command.entity ? entityIcon(command.entity) : (navIcons.get(command.href) ?? ArrowRight);
          return (
            <CommandItem
              key={command.id}
              value={`cmd:${command.id}`}
              onSelect={() => go(command.href)}
              className="gap-3 px-2 py-2 max-sm:min-h-12"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1 truncate font-medium text-sm">{commandLabel(command)}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {command.navGroupKey
                  ? tn(`groups.${command.navGroupKey}` as never)
                  : te(`groups.${command.group}` as never)}
              </span>
              {enterHint}
            </CommandItem>
          );
        })}
      </CommandGroup>
    ) : null;

  // Whatever is first on screen is selected whenever the list changes, so Enter
  // always opens the top row: the first record, else the first verb, else — with
  // nothing typed — the most recent record or the first thing to create.
  const firstValue = hasRecords
    ? `${groups?.[0].type}:${groups?.[0].hits[0].id}`
    : commandMatches[0] && term
      ? `cmd:${commandMatches[0].id}`
      : !term && recent[0]
        ? `recent:${recent[0].type}:${recent[0].id}`
        : !term && createCommands[0]
          ? `create:${createCommands[0].id}`
          : "";
  React.useEffect(() => {
    setSelected(firstValue);
  }, [firstValue]);

  return (
    <>
      {/* On a phone an icon on the right of the top bar, where the page title
          has the left; from md up the labelled field it always was. */}
      <Button
        onClick={() => setOpen(true)}
        variant="link"
        aria-label={t("buttonLabel")}
        className="font-normal text-muted-foreground hover:no-underline max-md:size-10 max-md:justify-center max-md:p-0 max-md:text-foreground md:px-0!"
      >
        <Search data-icon="inline-start" className="max-md:size-5" />
        <span className="max-md:sr-only">{t("buttonLabel")}</span>
        <kbd className="hidden h-5 select-none items-center gap-0.5 rounded border bg-muted px-1.5 font-medium text-[10px] sm:inline-flex">
          {modifier} K
        </kbd>
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={(v) => {
          if (!v) handleClose();
          else setOpen(true);
        }}
        title={t("buttonLabel")}
        description={t("tip")}
        // ⚠️ One fixed size on a desktop — a box that grew and shrank with every
        // keystroke moved the input's surroundings while somebody typed. Wide
        // enough for the recents beside the create grid, not so wide that a
        // result's name and its detail are a head-turn apart.
        className="sm:top-[10vh] sm:h-[min(620px,calc(100dvh-20vh))] sm:max-w-[860px]"
      >
        <CommandPrimitive
          shouldFilter={false}
          loop
          value={selected}
          onValueChange={setSelected}
          className="flex size-full min-h-0 flex-col"
        >
          {/* ── The field ── */}
          <div className="flex shrink-0 items-center gap-3 border-b px-4 max-sm:pr-12">
            <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground" aria-hidden>
              {loading ? <Loader2 className="size-5 animate-spin" /> : <Search className="size-5" />}
            </span>
            <CommandPrimitive.Input
              ref={inputRef}
              placeholder={isMobile ? t("placeholderShort") : t("placeholder")}
              value={query}
              onValueChange={handleValueChange}
              aria-busy={loading}
              className="h-14 min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground/70"
            />
            {query && (
              <button
                type="button"
                onClick={clearQuery}
                aria-label={t("clearLabel")}
                title={t("clearLabel")}
                // A 44px target on a phone around a small round mark: the mark stays
                // the size of the text it clears, the thumb gets the whole square.
                className="group/clear flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:size-11"
              >
                <span className="flex size-6 items-center justify-center rounded-full bg-muted transition-colors group-hover/clear:bg-muted-foreground/20 group-hover/clear:text-foreground">
                  <X className="size-3.5" aria-hidden />
                </span>
              </button>
            )}
            <kbd className="hidden shrink-0 select-none rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">
              esc
            </kbd>
          </div>

          {/* ── Where to look ── */}
          {sections.length > 1 && (
            <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
              {/* From sm up every section is a chip on one line. On a phone seven
                  chips wrapped to two rows of 44px targets — a sixth of the
                  screen above the first result — so there it is one menu. */}
              <fieldset
                className="hidden min-w-0 flex-1 flex-wrap items-center gap-1 sm:flex"
                aria-label={te("search.filterLabel")}
              >
                {(["all", ...sections] as Filter[]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={filter === f}
                    onClick={() => chooseFilter(f)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 font-medium text-xs transition-colors",
                      filter === f
                        ? "border-primary bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {sectionName(f)}
                  </button>
                ))}
              </fieldset>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-10 gap-1.5 sm:hidden">
                    <span className="text-muted-foreground">{te("search.filterLabel")}:</span>
                    <span className="font-medium">{sectionName(filter)}</span>
                    <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-56">
                  <DropdownMenuRadioGroup value={filter} onValueChange={(v) => chooseFilter(v as Filter)}>
                    {(["all", ...sections] as Filter[]).map((f) => (
                      <DropdownMenuRadioItem key={f} value={f} className="min-h-11">
                        {sectionName(f)}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              {term.length >= 2 && groups !== null && total > 0 && (
                <span className="ml-auto shrink-0 text-muted-foreground text-xs tabular-nums" aria-live="polite">
                  {t("foundCount", { count: total })}
                </span>
              )}
            </div>
          )}

          {/* ⚠️ `min-h-0 flex-1` works here because the palette now has a fixed
              height from sm up (and fills the screen below it). With only a
              max-height, a `flex-1` child has nothing to grow into. */}
          <CommandList className="scrollbar-slim max-h-none min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {/* ── Nothing typed: where you were, and what you can start ── */}
            {!term && (
              <div className="p-2 sm:p-3">
                <p className="px-2 pt-1 pb-3 text-muted-foreground text-xs">{t("tip")}</p>
                <div
                  className={cn(
                    "grid items-start gap-x-4 gap-y-2",
                    recent.length > 0 && "md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]",
                  )}
                >
                  {recent.length > 0 && (
                    <CommandGroup
                      heading={
                        <span className="flex items-center gap-1.5">
                          <Clock className="size-3" aria-hidden /> {te("search.recent")}
                        </span>
                      }
                      className="p-0"
                    >
                      {recent.map((item) => (
                        <CommandItem
                          key={`${item.type}:${item.id}`}
                          value={`recent:${item.type}:${item.id}`}
                          onSelect={() => {
                            rememberRecord(scope, item);
                            go(item.url);
                          }}
                          className="gap-3 px-2 py-2 max-sm:min-h-12"
                        >
                          <EntityBadgeIcon type={item.type} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium text-sm leading-tight">{item.label}</span>
                            <span className="mt-0.5 block truncate text-muted-foreground text-xs leading-tight">
                              {[te(`types.${item.type}.one` as never), item.sub].filter(Boolean).join(" · ")}
                            </span>
                          </span>
                          {enterHint}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}

                  {/* One flat grid rather than a heading per section: fourteen
                      buttons under six headings was taller than the palette, and
                      each button's icon already says which section it is. */}
                  {createCommands.length > 0 && (
                    <CommandGroup
                      heading={te("search.create")}
                      className={cn(
                        "p-0 **:[[cmdk-group-items]]:grid **:[[cmdk-group-items]]:grid-cols-2 **:[[cmdk-group-items]]:gap-1",
                        recent.length === 0 && "sm:**:[[cmdk-group-items]]:grid-cols-3",
                      )}
                    >
                      {createCommands.map((command) => {
                        const Icon = entityIcon(command.entity ?? "");
                        return (
                          <CommandItem
                            key={command.id}
                            value={`create:${command.id}`}
                            onSelect={() => go(command.href)}
                            className="min-w-0 gap-2 border border-border/60 px-2.5 py-2 max-sm:min-h-11"
                          >
                            <Icon className="size-4 text-muted-foreground" aria-hidden />
                            <span className="truncate text-[13px]">{commandLabel(command)}</span>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  )}
                </div>
              </div>
            )}

            {term.length === 1 && (
              <p className="px-4 py-10 text-center text-muted-foreground text-sm">{t("keepTyping")}</p>
            )}

            {!hasRecords && actions}

            {/* ── Searching, for the first time with this query ── */}
            {showSkeleton && (
              <div className="space-y-1 p-2">
                <p className="sr-only" aria-live="polite">
                  {t("searching")}
                </p>
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3 px-2 py-2" aria-hidden>
                    <span className="size-7 shrink-0 animate-pulse rounded-md bg-muted" />
                    <span className="flex-1 space-y-1.5">
                      <span className="block h-3 w-2/5 animate-pulse rounded bg-muted" />
                      <span className="block h-2.5 w-3/5 animate-pulse rounded bg-muted/70" />
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* ── The request failed ── */}
            {failed && term.length >= 2 && (
              <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
                <p className="text-muted-foreground text-sm">{t("error")}</p>
                <CommandGroup className="p-0">
                  <CommandItem
                    value="retry"
                    onSelect={() => search(query, filter)}
                    className="justify-center gap-2 border px-3 py-2"
                  >
                    <RotateCcw className="size-4" aria-hidden />
                    {t("retry")}
                  </CommandItem>
                </CommandGroup>
              </div>
            )}

            {/* ── Results ── */}
            {groups && total > 0 && (
              // Dimmed while a newer query is on its way: these answer the previous one.
              <div className={cn("p-2 transition-opacity", loading && "opacity-60")}>
                {groups.map((group) => {
                  const def = entityDef(group.type);
                  const capped = group.hits.length >= PER_SECTION && def?.list;
                  return (
                    <CommandGroup
                      key={group.type}
                      heading={
                        <span className="flex items-center justify-between gap-2">
                          <span>{te(`types.${group.type}.other` as never)}</span>
                          <span className="tabular-nums">{capped ? `${group.hits.length}+` : group.hits.length}</span>
                        </span>
                      }
                      className="p-0 pb-1"
                    >
                      {group.hits.map((hit) => {
                        const detail = hitDetail(hit);
                        return (
                          <CommandItem
                            key={`${hit.type}:${hit.id}`}
                            value={`${hit.type}:${hit.id}`}
                            onSelect={() => openHit(hit)}
                            className="gap-3 px-2 py-2 max-sm:min-h-12"
                          >
                            <EntityBadgeIcon type={hit.type} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium text-sm leading-tight">
                                <Highlight text={hit.label} query={term} />
                              </span>
                              {detail && (
                                <span className="mt-0.5 block truncate text-muted-foreground text-xs leading-tight">
                                  <Highlight text={detail} query={term} />
                                </span>
                              )}
                            </span>
                            {enterHint}
                          </CommandItem>
                        );
                      })}
                      {/* ⚠️ Each section returns five at most. A sixth "Rossi" was
                          simply not there, with nothing to say so; the list page
                          takes the same words and shows them all. */}
                      {capped && def && (
                        <CommandItem
                          value={`all:${group.type}`}
                          onSelect={() => go(`${def.list}?q=${encodeURIComponent(term)}`)}
                          className="gap-3 px-2 py-1.5 text-muted-foreground text-xs max-sm:min-h-11"
                        >
                          <span className="flex size-7 shrink-0 items-center justify-center" aria-hidden>
                            <ArrowRight className="size-3.5" />
                          </span>
                          <span className="flex-1">
                            {t("seeAll", { type: te(`types.${group.type}.other` as never) })}
                          </span>
                          {enterHint}
                        </CommandItem>
                      )}
                    </CommandGroup>
                  );
                })}
              </div>
            )}

            {hasRecords && actions}

            {/* ── Nothing found ── */}
            {showEmpty && commandMatches.length === 0 && (
              <div className="flex flex-col items-center px-6 py-10 text-center">
                <SearchX className="mb-3 size-8 text-muted-foreground/50" aria-hidden />
                <p className="text-sm">
                  {filter === "all"
                    ? t("noResultsFor", { query: term })
                    : t("noResultsIn", { query: term, section: sectionName(filter) })}
                </p>
                <p className="mt-1 max-w-sm text-muted-foreground text-xs">{t("noResultsTip")}</p>
                <CommandGroup className="mt-4 p-0 **:[[cmdk-group-items]]:flex **:[[cmdk-group-items]]:flex-wrap **:[[cmdk-group-items]]:justify-center **:[[cmdk-group-items]]:gap-1.5">
                  {filter !== "all" && (
                    <CommandItem
                      value="search-everywhere"
                      onSelect={() => chooseFilter("all")}
                      className="gap-1.5 border border-primary/40 px-3 py-1.5 text-primary max-sm:min-h-11"
                    >
                      <Search className="size-3.5" aria-hidden />
                      {t("searchEverywhere")}
                    </CommandItem>
                  )}
                  {createCommands
                    .filter((c) => (filter === "all" ? c.group === "crm" : c.group === filter))
                    .map((command) => (
                      <CommandItem
                        key={command.id}
                        value={`empty-create:${command.id}`}
                        onSelect={() => go(command.href)}
                        className="gap-1.5 border px-3 py-1.5 max-sm:min-h-11"
                      >
                        <Plus className="size-3.5 text-muted-foreground" aria-hidden />
                        {commandLabel(command)}
                      </CommandItem>
                    ))}
                </CommandGroup>
              </div>
            )}
          </CommandList>

          {/* ── Keys, on a keyboard ── */}
          <div className="hidden shrink-0 items-center gap-4 border-t bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground sm:flex">
            <span className="flex items-center gap-1">
              <kbd className="rounded border bg-background px-1 py-0.5 font-mono text-[10px]">↑↓</kbd> {t("navigate")}
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border bg-background px-1 py-0.5 font-mono text-[10px]">↵</kbd> {t("open")}
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border bg-background px-1 py-0.5 font-mono text-[10px]">esc</kbd> {t("close")}
            </span>
            <span className="ml-auto flex items-center gap-1">
              <kbd className="rounded border bg-background px-1 py-0.5 font-mono text-[10px]">{modifier} K</kbd>{" "}
              {t("toggle")}
            </span>
          </div>
        </CommandPrimitive>
      </CommandDialog>
    </>
  );
}
