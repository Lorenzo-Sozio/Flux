"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Command as CommandPrimitive } from "cmdk";
import {
  Building2,
  Contact,
  Kanban,
  Loader2,
  Search,
  Users,
  ArrowRight,
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
};

const ENTITY_CONFIG: Record<
  string,
  { icon: React.ReactNode; badge: string; badgeClass: string; href: string }
> = {
  contact: {
    icon: <Contact className="h-4 w-4" />,
    badge: "Contact",
    badgeClass: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
    href: "/dashboard/contacts",
  },
  lead: {
    icon: <Users className="h-4 w-4" />,
    badge: "Lead",
    badgeClass:
      "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
    href: "/dashboard/leads",
  },
  company: {
    icon: <Building2 className="h-4 w-4" />,
    badge: "Company",
    badgeClass:
      "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    href: "/dashboard/companies",
  },
  deal: {
    icon: <Kanban className="h-4 w-4" />,
    badge: "Deal",
    badgeClass:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    href: "/dashboard/pipeline",
  },
};

const QUICK_LINKS: { label: string; entity: string }[] = [
  { label: "Contacts", entity: "contact" },
  { label: "Leads", entity: "lead" },
  { label: "Companies", entity: "company" },
  { label: "Deals", entity: "deal" },
];

export function SearchDialog() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchResults | null>(null);
  const [loading, setLoading] = React.useState(false);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

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

  // Auto-focus input when dialog opens
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

  const groups: { key: keyof SearchResults; label: string }[] = [
    { key: "contacts", label: "Contacts" },
    { key: "leads", label: "Leads" },
    { key: "companies", label: "Companies" },
    { key: "deals", label: "Deals" },
  ];

  const hasResults = results && groups.some((g) => results[g.key]?.length > 0);

  const totalCount = results
    ? groups.reduce((acc, g) => acc + (results[g.key]?.length ?? 0), 0)
    : 0;

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        variant="link"
        className="px-0! font-normal text-muted-foreground hover:no-underline"
      >
        <Search data-icon="inline-start" />
        Search
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
          {/* ── Search input ─────────────────────────────────── */}
          <div className="flex items-center gap-3 border-b px-4 py-3.5">
            <div className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Search className="h-5 w-5" />
              )}
            </div>
            <CommandPrimitive.Input
              ref={inputRef}
              placeholder="Search contacts, leads, companies, deals…"
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
                Clear
              </button>
            )}
          </div>

          {/* ── Results list ─────────────────────────────────── */}
          <CommandList className="max-h-[420px] overflow-y-auto">
            {/* Idle state */}
            {!query && (
              <div className="p-4">
                <p className="mb-3 px-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Quick access
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {QUICK_LINKS.map(({ label, entity }) => {
                    const cfg = ENTITY_CONFIG[entity];
                    return (
                      <button
                        key={entity}
                        onClick={() => handleSelect(cfg.href)}
                        className="flex items-center gap-2.5 rounded-lg border border-border/50 bg-muted/30 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted hover:border-border"
                      >
                        <span className="text-muted-foreground">
                          {cfg.icon}
                        </span>
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
              <div className="py-8 text-center text-sm text-muted-foreground">
                Keep typing to search…
              </div>
            )}

            {/* No results */}
            {!loading && query.length >= 2 && !hasResults && (
              <CommandEmpty>
                <div className="py-8">
                  <p className="text-sm text-muted-foreground">
                    No results for{" "}
                    <span className="font-medium text-foreground">
                      &ldquo;{query}&rdquo;
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground/60">
                    Try a different name, email, or company.
                  </p>
                </div>
              </CommandEmpty>
            )}

            {/* Results */}
            {hasResults && (
              <>
                <div className="flex items-center justify-between px-4 pt-3 pb-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Results
                  </p>
                  <span className="text-xs text-muted-foreground">
                    {totalCount} found
                  </span>
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
                                <p className="truncate text-sm font-medium leading-tight">
                                  {item.label}
                                </p>
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

          {/* ── Footer hint ──────────────────────────────────── */}
          <div className="flex items-center gap-4 border-t bg-muted/30 px-4 py-2.5 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <kbd className="rounded border bg-background px-1 py-0.5 font-mono text-[10px]">
                ↑↓
              </kbd>{" "}
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border bg-background px-1 py-0.5 font-mono text-[10px]">
                ↵
              </kbd>{" "}
              open
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border bg-background px-1 py-0.5 font-mono text-[10px]">
                esc
              </kbd>{" "}
              close
            </span>
            <span className="ml-auto flex items-center gap-1">
              <kbd className="rounded border bg-background px-1 py-0.5 font-mono text-[10px]">
                ⌘J
              </kbd>{" "}
              toggle
            </span>
          </div>
        </CommandPrimitive>
      </CommandDialog>
    </>
  );
}
