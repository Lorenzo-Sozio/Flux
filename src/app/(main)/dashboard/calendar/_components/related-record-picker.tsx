"use client";

import { useEffect, useRef, useState } from "react";

import { Building2, Handshake, Link2, Loader2, Target, User, X } from "lucide-react";
import { useTranslations } from "next-intl";

import type { AppointmentLink } from "@/actions/appointments";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const LINKABLE = ["contact", "company", "deal", "lead"] as const;
type LinkType = (typeof LINKABLE)[number];

const ICONS: Record<LinkType, typeof User> = {
  contact: User,
  company: Building2,
  deal: Handshake,
  lead: Target,
};

type Hit = { id: string; type: string; label: string; sub: string | null };
type Group = { type: string; hits: Hit[] };

/**
 * The one record an appointment is about.
 *
 * Asks the global search endpoint rather than a query of its own, so what can be
 * found here is exactly what the search palette finds, with the same permission
 * and plan checks.
 */
export function RelatedRecordPicker({
  value,
  onChange,
}: {
  value: AppointmentLink | null;
  onChange: (link: AppointmentLink | null) => void;
}) {
  const t = useTranslations("appointment");
  const te = useTranslations("entities.types");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setGroups([]);
      return;
    }
    const request = ++requestRef.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&types=${LINKABLE.join(",")}`);
        const data = (await res.json()) as { groups?: Group[] };
        // A slow answer to an older query must not replace a newer one.
        if (request === requestRef.current) setGroups(data.groups ?? []);
      } catch {
        if (request === requestRef.current) setGroups([]);
      } finally {
        if (request === requestRef.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  if (value) {
    const Icon = ICONS[value.type];
    return (
      <div className="flex min-w-0 items-center gap-2 rounded-md border bg-muted/30 px-3 py-1.5 text-sm">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="shrink-0 text-muted-foreground text-xs">{te(`${value.type}.one`)}</span>
        <span className="min-w-0 flex-1 truncate font-medium">{value.label || "—"}</span>
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label={t("fields.relatedClear")}
          className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-start gap-2 font-normal text-muted-foreground"
        >
          <Link2 className="h-4 w-4" />
          {t("fields.relatedPlaceholder")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-72 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder={t("fields.relatedSearch")} />
          <CommandList>
            {loading && (
              <div className="flex justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}
            {!loading && query.trim().length >= 2 && <CommandEmpty>{t("fields.relatedNone")}</CommandEmpty>}
            {groups
              .filter((g): g is Group & { type: LinkType } => (LINKABLE as readonly string[]).includes(g.type))
              .map((g) => {
                const Icon = ICONS[g.type];
                return (
                  <CommandGroup key={g.type} heading={te(`${g.type}.other`)}>
                    {g.hits.map((hit) => (
                      <CommandItem
                        key={hit.id}
                        value={`${g.type}:${hit.id}`}
                        onSelect={() => {
                          onChange({ type: g.type, id: hit.id, label: hit.label });
                          setOpen(false);
                          setQuery("");
                        }}
                      >
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <div className="min-w-0">
                          <div className="truncate">{hit.label}</div>
                          {hit.sub && <div className="truncate text-muted-foreground text-xs">{hit.sub}</div>}
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                );
              })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
