"use client";

import * as React from "react";

import { useRouter } from "next/navigation";

import { Command as CommandPrimitive } from "cmdk";
import {
  ArrowRight,
  Building2,
  CheckSquare,
  Clock,
  Contact,
  CornerDownLeft,
  FileText,
  Headphones,
  Kanban,
  Loader2,
  Plus,
  Search,
  ShoppingCart,
  Sunrise,
  Swords,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { matchCommands, PALETTE_COMMANDS, type PaletteCommand } from "@/lib/palette-commands";
import { can, type TenantRole } from "@/lib/permissions";
import { type RecentRecord, readRecentRecords, rememberRecord } from "@/lib/recent-records";

type SearchResult = {
  id: string;
  label: string;
  sub?: string | null;
  url: string;
  entity: string;
};

type SearchResults = {
  contacts: SearchResult[];
  leads: SearchResult[];
  companies: SearchResult[];
  deals: SearchResult[];
  tickets: SearchResult[];
  quotes: SearchResult[];
  orders: SearchResult[];
};

/** The pure command list names its icon; this is where the name becomes one. */
const COMMAND_ICONS: Record<string, React.ReactNode> = {
  FileText: <FileText className="h-4 w-4" />,
  ShoppingCart: <ShoppingCart className="h-4 w-4" />,
  Contact: <Contact className="h-4 w-4" />,
  Users: <Users className="h-4 w-4" />,
  Building2: <Building2 className="h-4 w-4" />,
  Kanban: <Kanban className="h-4 w-4" />,
  Headphones: <Headphones className="h-4 w-4" />,
  CheckSquare: <CheckSquare className="h-4 w-4" />,
  Sunrise: <Sunrise className="h-4 w-4" />,
  Swords: <Swords className="h-4 w-4" />,
};

export function SearchDialog({ tenantRole }: { tenantRole?: TenantRole }) {
  const t = useTranslations("search");
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchResults | null>(null);
  const [loading, setLoading] = React.useState(false);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [recent, setRecent] = React.useState<RecentRecord[]>([]);

  /** Only the verbs this person is allowed to use. */
  const allow = React.useCallback(
    (capability?: Parameters<typeof can>[1]) => (capability ? can(tenantRole ?? null, capability) : true),
    [tenantRole],
  );

  const commandMatches = React.useMemo(() => matchCommands(query, allow), [query, allow]);
  const idleCommands = React.useMemo(() => PALETTE_COMMANDS.filter((c) => allow(c.capability)).slice(0, 6), [allow]);

  const ENTITY_CONFIG: Record<string, { icon: React.ReactNode; badge: string; badgeClass: string; href: string }> = {
    contact: {
      icon: <Contact className="h-4 w-4" />,
      badge: t("badges.contact"),
      badgeClass: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
      href: "/dashboard/contacts",
    },
    lead: {
      icon: <Users className="h-4 w-4" />,
      badge: t("badges.lead"),
      badgeClass: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
      href: "/dashboard/leads",
    },
    company: {
      icon: <Building2 className="h-4 w-4" />,
      badge: t("badges.company"),
      badgeClass: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
      href: "/dashboard/companies",
    },
    deal: {
      icon: <Kanban className="h-4 w-4" />,
      badge: t("badges.deal"),
      badgeClass: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
      href: "/dashboard/pipeline",
    },
    ticket: {
      icon: <Headphones className="h-4 w-4" />,
      badge: t("badges.ticket"),
      badgeClass: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
      href: "/dashboard/support/tickets",
    },
    quote: {
      icon: <FileText className="h-4 w-4" />,
      badge: t("badges.quote"),
      badgeClass: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
      href: "/dashboard/sales/quotes",
    },
    order: {
      icon: <ShoppingCart className="h-4 w-4" />,
      badge: t("badges.order"),
      badgeClass: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
      href: "/dashboard/sales/orders",
    },
  };

  const QUICK_LINKS: { label: string; entity: string }[] = [
    { label: t("groups.contacts"), entity: "contact" },
    { label: t("groups.leads"), entity: "lead" },
    { label: t("groups.companies"), entity: "company" },
    { label: t("groups.deals"), entity: "deal" },
    { label: t("groups.tickets"), entity: "ticket" },
    { label: t("groups.quotes"), entity: "quote" },
    { label: t("groups.orders"), entity: "order" },
  ];

  const groups: { key: keyof SearchResults; label: string }[] = [
    { key: "contacts", label: t("groups.contacts") },
    { key: "leads", label: t("groups.leads") },
    { key: "companies", label: t("groups.companies") },
    { key: "deals", label: t("groups.deals") },
    { key: "tickets", label: t("groups.tickets") },
    { key: "quotes", label: t("groups.quotes") },
    { key: "orders", label: t("groups.orders") },
  ];

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // ⌘K is the shortcut every comparable product uses, and it is what someone
      // arriving from one of them will press. ⌘J stays bound as well so nobody who
      // learned the old one has it taken away (audit rilievo U-03).
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
      // Read on open rather than on mount: another tab may have moved things.
      setRecent(readRecentRecords());
    }
  }, [open]);

  const search = React.useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults(null);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(data.results);
    } catch {
      setResults(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleValueChange = (val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(val), 250);
  };

  const handleClose = () => {
    setOpen(false);
    setQuery("");
    setResults(null);
  };

  const handleSelect = (url: string) => {
    handleClose();
    router.push(url);
  };

  /** Opening a record from here is what makes it recent. */
  const openRecord = (item: { id: string; label: string; sub?: string | null; url: string; entity: string }) => {
    rememberRecord(item);
    handleSelect(item.url);
  };

  const runCommand = (command: PaletteCommand) => handleSelect(command.href);

  const hasResults = results && groups.some((g) => results[g.key]?.length > 0);
  const totalCount = results ? groups.reduce((acc, g) => acc + (results[g.key]?.length ?? 0), 0) : 0;

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        variant="link"
        className="px-0! font-normal text-muted-foreground hover:no-underline"
      >
        <Search data-icon="inline-start" />
        {t("buttonLabel")}
        {/* There is no ⌘ on a phone. */}
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
        className="sm:max-w-[620px]"
      >
        <CommandPrimitive shouldFilter={false}>
          {/* Search input */}
          <div className="flex items-center gap-3 border-b px-4 py-3.5">
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
                  setResults(null);
                  inputRef.current?.focus();
                }}
                className="shrink-0 rounded-sm text-muted-foreground text-xs ring-offset-background transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {t("clear")}
              </button>
            )}
          </div>

          {/* Results list */}
          <CommandList className="max-h-[420px] overflow-y-auto">
            {/* Idle state */}
            {!query && (
              <div className="p-4">
                {/*
                  What was open twenty minutes ago, before anything else. The list
                  of module index pages below it is the sidebar again in a smaller
                  box, and only helps somebody who has not been anywhere yet.
                */}
                {recent.length > 0 && (
                  <div className="mb-4">
                    <p className="mb-2 flex items-center gap-1.5 px-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                      <Clock className="h-3 w-3" /> Recent
                    </p>
                    <div className="space-y-0.5">
                      {recent.map((item) => {
                        const cfg = ENTITY_CONFIG[item.entity];
                        return (
                          <button
                            type="button"
                            key={item.id}
                            onClick={() => openRecord(item)}
                            className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted"
                          >
                            <span
                              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${cfg?.badgeClass ?? ""}`}
                            >
                              {cfg?.icon}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium text-sm leading-tight">{item.label}</span>
                              {item.sub && (
                                <span className="mt-0.5 block truncate text-muted-foreground text-xs leading-tight">
                                  {item.sub}
                                </span>
                              )}
                            </span>
                            <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* The verbs. Searching found nouns, and only nouns. */}
                {idleCommands.length > 0 && (
                  <div className="mb-4">
                    <p className="mb-2 px-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                      Create
                    </p>
                    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                      {idleCommands.map((command) => (
                        <button
                          type="button"
                          key={command.id}
                          onClick={() => runCommand(command)}
                          className="flex items-center gap-2.5 rounded-lg border border-border/50 bg-muted/30 px-3 py-2.5 text-left text-sm transition-colors hover:border-border hover:bg-muted"
                        >
                          <span className="text-muted-foreground">{COMMAND_ICONS[command.icon]}</span>
                          <span className="truncate font-medium">{command.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <p className="mb-3 px-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                  {t("quickAccess")}
                </p>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {QUICK_LINKS.map(({ label, entity }) => {
                    const cfg = ENTITY_CONFIG[entity];
                    return (
                      <button
                        type="button"
                        key={entity}
                        onClick={() => handleSelect(cfg.href)}
                        className="flex items-center gap-2.5 rounded-lg border border-border/50 bg-muted/30 px-3 py-2.5 text-left text-sm transition-colors hover:border-border hover:bg-muted"
                      >
                        <span className="text-muted-foreground">{cfg.icon}</span>
                        <span className="font-medium">{label}</span>
                        <ArrowRight className="ml-auto h-3.5 w-3.5 text-muted-foreground/40" />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Typing but < 2 chars */}
            {query.length === 1 && (
              <div className="py-8 text-center text-muted-foreground text-sm">{t("keepTyping")}</div>
            )}

            {/* No results */}
            {!loading && query.length >= 2 && !hasResults && commandMatches.length === 0 && (
              <CommandEmpty>
                <div className="py-6">
                  <p className="text-muted-foreground text-sm">
                    {t("noResults")} <span className="font-medium text-foreground">&ldquo;{query}&rdquo;</span>
                  </p>
                  {/*
                    Not finding something is usually the moment you wanted to make
                    it. Offering that here is the difference between a dead end and
                    the next step.
                  */}
                  {allow("record:write") ? (
                    <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                      {["new-contact", "new-lead", "new-company"].map((id) => {
                        const command = PALETTE_COMMANDS.find((c) => c.id === id);
                        if (!command || !allow(command.capability)) return null;
                        return (
                          <button
                            type="button"
                            key={id}
                            onClick={() => runCommand(command)}
                            className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm transition-colors hover:bg-muted"
                          >
                            <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                            {command.label}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="mt-1 text-muted-foreground/60 text-xs">{t("noResultsTip")}</p>
                  )}
                </div>
              </CommandEmpty>
            )}

            {/*
              The verbs, above the records. Typing "ord" should offer to write one
              as readily as it offers the ones already written.
            */}
            {query.length >= 1 && commandMatches.length > 0 && (
              <CommandGroup heading="Actions">
                {commandMatches.map((command) => (
                  <CommandItem
                    key={command.id}
                    value={`cmd-${command.id}`}
                    onSelect={() => runCommand(command)}
                    className="flex items-center gap-3 px-3 py-2.5"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      {COMMAND_ICONS[command.icon] ?? <Plus className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium text-sm">{command.label}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{command.group}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {/* Results */}
            {hasResults && (
              <>
                <div className="flex items-center justify-between px-4 pt-3 pb-1">
                  <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                    {t("resultsHeading")}
                  </p>
                  <span className="text-muted-foreground text-xs">{t("foundCount", { count: totalCount })}</span>
                </div>
                {groups.map((group, idx) => {
                  const items = results?.[group.key];
                  if (!items?.length) return null;
                  return (
                    <React.Fragment key={group.key}>
                      {idx > 0 && <CommandSeparator />}
                      <CommandGroup heading={group.label}>
                        {items.map((item) => {
                          const cfg = ENTITY_CONFIG[item.entity];
                          return (
                            <CommandItem
                              key={item.id}
                              value={item.id}
                              onSelect={() => openRecord(item)}
                              className="flex items-center gap-3 px-3 py-2.5"
                            >
                              <span
                                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${cfg?.badgeClass ?? ""}`}
                              >
                                {cfg?.icon}
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="truncate font-medium text-sm leading-tight">{item.label}</p>
                                {item.sub && (
                                  <p className="mt-0.5 truncate text-muted-foreground text-xs leading-tight">
                                    {item.sub}
                                  </p>
                                )}
                              </div>
                              <span
                                className={`shrink-0 rounded-full px-2 py-0.5 font-medium text-[11px] ${cfg?.badgeClass ?? ""}`}
                              >
                                {cfg?.badge}
                              </span>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </React.Fragment>
                  );
                })}
              </>
            )}
          </CommandList>

          {/* Footer */}
          <div className="flex items-center gap-4 border-t bg-muted/30 px-4 py-2.5 text-[11px] text-muted-foreground">
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
              <kbd className="rounded border bg-background px-1 py-0.5 font-mono text-[10px]">⌘J</kbd> {t("toggle")}
            </span>
          </div>
        </CommandPrimitive>
      </CommandDialog>
    </>
  );
}
