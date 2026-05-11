"use client";

import * as React from "react";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { Command as CommandPrimitive } from "cmdk";
import {
  ArrowRight,
  Building2,
  Contact,
  FileText,
  Headphones,
  Kanban,
  Loader2,
  Search,
  ShoppingCart,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

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

export function SearchDialog() {
  const t = useTranslations("search");
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchResults | null>(null);
  const [loading, setLoading] = React.useState(false);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const ENTITY_CONFIG: Record<
    string,
    { icon: React.ReactNode; badge: string; badgeClass: string; href: string }
  > = {
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
    { label: t("groups.leads"),    entity: "lead" },
    { label: t("groups.companies"), entity: "company" },
    { label: t("groups.deals"),    entity: "deal" },
    { label: t("groups.tickets"),  entity: "ticket" },
    { label: t("groups.quotes"),   entity: "quote" },
    { label: t("groups.orders"),   entity: "order" },
  ];

  const groups: { key: keyof SearchResults; label: string }[] = [
    { key: "contacts",  label: t("groups.contacts") },
    { key: "leads",     label: t("groups.leads") },
    { key: "companies", label: t("groups.companies") },
    { key: "deals",     label: t("groups.deals") },
    { key: "tickets",   label: t("groups.tickets") },
    { key: "quotes",    label: t("groups.quotes") },
    { key: "orders",    label: t("groups.orders") },
  ];

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "j" && (e.metaKey || e.ctrlKey)) {
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
        <kbd className="inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-medium text-[10px]">
          <span className="text-xs">⌘</span>J
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
                onClick={() => {
                  setQuery("");
                  setResults(null);
                  inputRef.current?.focus();
                }}
                className="shrink-0 rounded-sm text-xs text-muted-foreground ring-offset-background transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
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
                <p className="mb-3 px-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {t("quickAccess")}
                </p>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {QUICK_LINKS.map(({ label, entity }) => {
                    const cfg = ENTITY_CONFIG[entity];
                    return (
                      <button
                        key={entity}
                        onClick={() => handleSelect(cfg.href)}
                        className="flex items-center gap-2.5 rounded-lg border border-border/50 bg-muted/30 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted hover:border-border"
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
              <div className="py-8 text-center text-sm text-muted-foreground">{t("keepTyping")}</div>
            )}

            {/* No results */}
            {!loading && query.length >= 2 && !hasResults && (
              <CommandEmpty>
                <div className="py-8">
                  <p className="text-sm text-muted-foreground">
                    {t("noResults")}{" "}
                    <span className="font-medium text-foreground">&ldquo;{query}&rdquo;</span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground/60">
                    {t("noResultsTip")}
                  </p>
                </div>
              </CommandEmpty>
            )}

            {/* Results */}
            {hasResults && (
              <>
                <div className="flex items-center justify-between px-4 pt-3 pb-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("resultsHeading")}</p>
                  <span className="text-xs text-muted-foreground">{t("foundCount", { count: totalCount })}</span>
                </div>
                {groups.map((group, idx) => {
                  const items = results![group.key];
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
                              onSelect={() => handleSelect(item.url)}
                              className="flex items-center gap-3 px-3 py-2.5"
                            >
                              <span
                                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${cfg?.badgeClass ?? ""}`}
                              >
                                {cfg?.icon}
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium leading-tight">{item.label}</p>
                                {item.sub && (
                                  <p className="truncate text-xs text-muted-foreground leading-tight mt-0.5">
                                    {item.sub}
                                  </p>
                                )}
                              </div>
                              <span
                                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${cfg?.badgeClass ?? ""}`}
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
