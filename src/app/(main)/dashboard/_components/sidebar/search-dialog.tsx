"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Contact,
  Kanban,
  Loader2,
  Search,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
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

const ENTITY_ICONS: Record<string, React.ReactNode> = {
  contact: <Contact className="h-4 w-4" />,
  lead: <Users className="h-4 w-4" />,
  company: <Building2 className="h-4 w-4" />,
  deal: <Kanban className="h-4 w-4" />,
};

export function SearchDialog() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchResults | null>(null);
  const [loading, setLoading] = React.useState(false);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const search = React.useCallback(async (q: string) => {
    if (q.length < 2) { setResults(null); return; }
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

  const handleSelect = (url: string) => {
    setOpen(false);
    setQuery("");
    setResults(null);
    router.push(url);
  };

  const groups: { key: keyof SearchResults; label: string }[] = [
    { key: "contacts", label: "Contacts" },
    { key: "leads", label: "Leads" },
    { key: "companies", label: "Companies" },
    { key: "deals", label: "Deals" },
  ];

  const hasResults = results && groups.some((g) => results[g.key]?.length > 0);

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

      <CommandDialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setQuery(""); setResults(null); } }}>
        <Command shouldFilter={false}>
          <div className="flex items-center border-b px-3">
            {loading
              ? <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
              : <Search className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
            }
            <CommandInput
              placeholder="Search contacts, leads, companies, deals…"
              value={query}
              onValueChange={handleValueChange}
              className="border-0 focus:ring-0"
            />
          </div>
          <CommandList>
            {!loading && query.length >= 2 && !hasResults && (
              <CommandEmpty>No results found for &ldquo;{query}&rdquo;</CommandEmpty>
            )}
            {!query && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Type at least 2 characters to search…
              </div>
            )}
            {hasResults && groups.map((group, idx) => {
              const items = results[group.key];
              if (!items?.length) return null;
              return (
                <React.Fragment key={group.key}>
                  {idx > 0 && <CommandSeparator />}
                  <CommandGroup heading={group.label}>
                    {items.map((item) => (
                      <CommandItem
                        key={item.id}
                        value={item.id}
                        onSelect={() => handleSelect(item.url)}
                        className="flex items-center gap-3"
                      >
                        <span className="text-muted-foreground">{ENTITY_ICONS[item.entity]}</span>
                        <div className="flex flex-col">
                          <span className="font-medium text-sm">{item.label}</span>
                          {item.sub && <span className="text-xs text-muted-foreground">{item.sub}</span>}
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </React.Fragment>
              );
            })}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
