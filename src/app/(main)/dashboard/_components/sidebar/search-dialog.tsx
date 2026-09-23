"use client";

import * as React from "react";

import { useRouter } from "next/navigation";

import { Command as CommandPrimitive } from "cmdk";
import { BarChart3, Clock, CornerDownLeft, Loader2, Plus, Search, Swords } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { EntityBadgeIcon, entityIcon } from "@/components/crm/entity-icon";
import { useWorkspaceScope } from "@/components/crm/workspace-scope";
import { Button } from "@/components/ui/button";
import { CommandDialog, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { ENTITIES, ENTITY_GROUPS, type EntityGroup, type EntityType, entityInPlan } from "@/lib/entities";
import { matchCommands, PALETTE_COMMANDS, type PaletteCommand } from "@/lib/palette-commands";
import { can, type TenantRole } from "@/lib/permissions";
import { type RecentRecord, readRecentRecords, rememberRecord } from "@/lib/recent-records";
import type { SearchHit } from "@/lib/search/providers";
import { cn } from "@/lib/utils";

type Group = { type: EntityType; hits: SearchHit[] };
type Filter = "all" | EntityGroup;

const NAV_ICONS: Record<string, React.ElementType> = { dashboard: BarChart3, "win-loss": Swords };

/**
 * The palette: find any record, run any verb.
 *
 * ⚠️ Driven by src/lib/entities.ts. It kept its own tables of seven entities —
 * icons, badges, groups, quick links — so invoices, contracts, credit notes and
 * the rest never appeared, whatever the search route returned.
 *
 * The chips narrow the search to one section, which is what makes it usable once
 * a word ("Rossi") matches a contact, three quotes, two invoices and a ticket.
 */
export function SearchDialog({
  tenantRole,
  enabledModules,
}: {
  tenantRole?: TenantRole;
  /** The plan's modules; null when not known, which hides nothing. */
  enabledModules?: string[] | null;
}) {
  const t = useTranslations("search");
  const te = useTranslations("entities");
  const format = useFormatter();
  const router = useRouter();
  const scope = useWorkspaceScope();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<Filter>("all");
  const [groups, setGroups] = React.useState<Group[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = React.useRef(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [recent, setRecent] = React.useState<RecentRecord[]>([]);

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
  const commandLabel = React.useCallback(
    (command: PaletteCommand) =>
      command.entity ? te(`types.${command.entity}.new` as never) : t(`commands.${command.labelKey}` as never),
    [t, te],
  );
  const commandMatches = React.useMemo(() => matchCommands(query, allow, commandLabel), [query, allow, commandLabel]);
  const createCommands = React.useMemo(() => PALETTE_COMMANDS.filter((c) => c.entity && allow(c)), [allow]);

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // ⌘K is what every comparable product uses; ⌘J stays for whoever learnt it.
      if ((e.key === "k" || e.key === "j") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  React.useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setRecent(readRecentRecords(scope).slice(0, 6));
    }
  }, [open, scope]);

  const search = React.useCallback(async (q: string, f: Filter) => {
    if (q.length < 2) {
      setGroups(null);
      return;
    }
    const request = ++requestRef.current;
    setLoading(true);
    try {
      const types =
        f === "all"
          ? ""
          : ENTITIES.filter((e) => e.group === f)
              .map((e) => e.type)
              .join(",");
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}${types ? `&types=${types}` : ""}`);
      const data = (await res.json()) as { groups?: Group[] };
      // A slow answer to an older query must not replace a newer one.
      if (request === requestRef.current) setGroups(data.groups ?? []);
    } catch {
      if (request === requestRef.current) setGroups(null);
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, []);

  const handleValueChange = (val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(val, filter), 250);
  };

  const chooseFilter = (f: Filter) => {
    setFilter(f);
    search(query, f);
    inputRef.current?.focus();
  };

  const handleClose = () => {
    setOpen(false);
    setQuery("");
    setGroups(null);
    setFilter("all");
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

  const total = groups?.reduce((n, g) => n + g.hits.length, 0) ?? 0;

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        variant="link"
        className="px-0! font-normal text-muted-foreground hover:no-underline"
      >
        <Search data-icon="inline-start" />
        {t("buttonLabel")}
        <kbd className="hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-medium text-[10px] sm:inline-flex">
          <span className="text-xs">⌘</span>K
        </kbd>
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={(v) => {
          if (!v) handleClose();
          else setOpen(true);
        }}
        // ⚠️ Wide enough to put what you have open beside what you can create,
        // instead of stacking them into a column taller than the box. The palette
        // opened on a scrollbar: six recent records and fourteen create commands in
        // one 680px column came to some 700px of content in a 460px window, so the
        // first thing anybody saw was half a list.
        // Sits higher than the default third of the way down, because it is taller
        // now. No height cap of its own: the dialog already caps itself against the
        // window, and a second cap here only ever made it shorter.
        className="sm:top-[8vh] sm:max-w-[920px]"
      >
        <CommandPrimitive shouldFilter={false} className="flex size-full flex-col">
          <div className="flex shrink-0 items-center gap-3 border-b py-3.5 pr-12 pl-4 sm:pr-4">
            <div className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
            </div>
            <CommandPrimitive.Input
              ref={inputRef}
              placeholder={t("placeholder")}
              value={query}
              onValueChange={handleValueChange}
              className="h-8 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground/60"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setGroups(null);
                  inputRef.current?.focus();
                }}
                className="shrink-0 rounded-sm text-muted-foreground text-xs transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {t("clear")}
              </button>
            )}
          </div>

          {/* Where to look. Wraps instead of scrolling, so no section is out of sight. */}
          {sections.length > 1 && (
            <fieldset
              className="flex shrink-0 flex-wrap items-center gap-1 border-b px-3 py-2"
              aria-label={te("search.filterLabel")}
            >
              {(["all", ...sections] as Filter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={filter === f}
                  onClick={() => chooseFilter(f)}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                    filter === f ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                  )}
                >
                  {f === "all" ? te("search.all") : te(`groups.${f}` as never)}
                </button>
              ))}
            </fieldset>
          )}

          {/* ⚠️⚠️ An explicit height, not `flex-1`. The dialog is a flex column whose
              own height is `max-height` only — auto, in other words — so a child with
              `flex-1` has a *basis of zero* and nothing to grow into: the list came out
              shorter than the content it held, which is the opposite of what taking the
              remaining space means. `dvh` rather than `vh`: on iOS the latter is the
              window without the address bar. */}
          <CommandList className="scrollbar-slim max-h-[min(70dvh,780px)] overflow-y-auto">
            {!query && (
              // Two columns where there is room for two: what you were working on, and
              // what you can start. On a narrow screen they stack, in that order,
              // because coming back to a record is the commoner errand of the two.
              <div className="grid items-start gap-x-8 gap-y-5 p-4 lg:grid-cols-2">
                {recent.length > 0 && (
                  <div>
                    <p className="mb-2 flex items-center gap-1.5 px-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                      <Clock className="h-3 w-3" /> {te("search.recent")}
                    </p>
                    <div className="space-y-0.5">
                      {recent.map((item) => (
                        <button
                          type="button"
                          key={`${item.type}:${item.id}`}
                          onClick={() => {
                            rememberRecord(scope, item);
                            go(item.url);
                          }}
                          className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted"
                        >
                          <EntityBadgeIcon type={item.type} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium text-sm leading-tight">{item.label}</span>
                            <span className="mt-0.5 block truncate text-muted-foreground text-xs leading-tight">
                              {[te(`types.${item.type}.one` as never), item.sub].filter(Boolean).join(" · ")}
                            </span>
                          </span>
                          <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Every verb, by section: the list grows with the registry, not with this file. */}
                {createCommands.length > 0 && (
                  <div>
                    <p className="mb-2 px-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                      {te("search.create")}
                    </p>
                    {/* ⚠️ Laid out in two text columns rather than stacked: six section
                        headings and fourteen buttons down a single column is 450px, which
                        is most of the window on a laptop and the reason this opened on a
                        scrollbar. `break-inside-avoid` keeps a heading with its own
                        buttons — a section split across the fold reads as two sections. */}
                    <div className="gap-x-4 sm:columns-2">
                      {ENTITY_GROUPS.map((g) => {
                        const inGroup = createCommands.filter((c) => c.group === g);
                        if (inGroup.length === 0) return null;
                        return (
                          <div key={g} className="mb-2.5 break-inside-avoid">
                            <p className="mb-1 px-1 text-[11px] text-muted-foreground">{te(`groups.${g}` as never)}</p>
                            <div className="grid grid-cols-1 gap-1.5">
                              {inGroup.map((command) => {
                                const Icon = entityIcon(command.entity ?? "");
                                return (
                                  <button
                                    type="button"
                                    key={command.id}
                                    onClick={() => go(command.href)}
                                    className="flex items-center gap-2.5 rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-left text-sm transition-colors hover:border-border hover:bg-muted"
                                  >
                                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                                    <span className="truncate font-medium">{commandLabel(command)}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {query.length === 1 && (
              <div className="py-8 text-center text-muted-foreground text-sm">{t("keepTyping")}</div>
            )}

            {!loading && query.length >= 2 && total === 0 && commandMatches.length === 0 && (
              <CommandEmpty>
                <div className="py-6">
                  <p className="text-muted-foreground text-sm">
                    {t("noResults")} <span className="font-medium text-foreground">&ldquo;{query}&rdquo;</span>
                  </p>
                  {createCommands.length > 0 ? (
                    <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                      {createCommands
                        .filter((c) => (filter === "all" ? c.group === "crm" : c.group === filter))
                        .map((command) => (
                          <button
                            type="button"
                            key={command.id}
                            onClick={() => go(command.href)}
                            className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm transition-colors hover:bg-muted"
                          >
                            <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                            {commandLabel(command)}
                          </button>
                        ))}
                    </div>
                  ) : (
                    <p className="mt-1 text-muted-foreground/60 text-xs">{t("noResultsTip")}</p>
                  )}
                </div>
              </CommandEmpty>
            )}

            {query.length >= 1 && commandMatches.length > 0 && (
              <CommandGroup heading={te("search.actions")}>
                {commandMatches.map((command) => {
                  const Icon = command.entity ? entityIcon(command.entity) : (NAV_ICONS[command.id] ?? Plus);
                  return (
                    <CommandItem
                      key={command.id}
                      value={`cmd-${command.id}`}
                      onSelect={() => go(command.href)}
                      className="flex items-center gap-3 px-3 py-2.5"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium text-sm">{commandLabel(command)}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {te(`groups.${command.group}` as never)}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}

            {total > 0 && (
              <>
                <div className="flex items-center justify-between px-4 pt-3 pb-1">
                  <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                    {t("resultsHeading")}
                  </p>
                  <span className="text-muted-foreground text-xs">{t("foundCount", { count: total })}</span>
                </div>
                {groups?.map((group) => (
                  <CommandGroup key={group.type} heading={te(`types.${group.type}.other` as never)}>
                    {group.hits.map((hit) => {
                      const detail = hitDetail(hit);
                      return (
                        <CommandItem
                          key={`${hit.type}:${hit.id}`}
                          value={`${hit.type}:${hit.id}`}
                          onSelect={() => openHit(hit)}
                          className="flex items-center gap-3 px-3 py-2.5"
                        >
                          <EntityBadgeIcon type={hit.type} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium text-sm leading-tight">{hit.label}</p>
                            {detail && (
                              <p className="mt-0.5 truncate text-muted-foreground text-xs leading-tight">{detail}</p>
                            )}
                          </div>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                ))}
              </>
            )}
          </CommandList>

          <div className="hidden shrink-0 items-center gap-4 border-t bg-muted/30 px-4 py-2.5 text-[11px] text-muted-foreground sm:flex">
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
              <kbd className="rounded border bg-background px-1 py-0.5 font-mono text-[10px]">⌘K</kbd> {t("toggle")}
            </span>
          </div>
        </CommandPrimitive>
      </CommandDialog>
    </>
  );
}
