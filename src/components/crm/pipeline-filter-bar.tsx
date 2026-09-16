"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { ChevronDown, Loader2, Search, Users, X } from "lucide-react";
import { useTranslations } from "next-intl";

import type { PipelineMember } from "@/actions/pipeline-members";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ALL_OWNERS,
  DEAL_STATUS_FILTERS,
  ownersParam,
  PERIOD_OPTIONS,
  PIPELINE_VIEWS,
  type PipelineView,
  parsePipelineFilters,
  pipelineViewAt,
  UNASSIGNED,
} from "@/lib/pipeline-filters";
import { cn } from "@/lib/utils";

/** Parameters that mean the same thing on every Pipeline page, so they follow the tabs. */
const SHARED = ["owners", "period"] as const;

/**
 * The tabs and the filters of the Pipeline section, drawn once in its layout.
 *
 * Every page reads the same URL parameters (src/lib/pipeline-filters.ts), and the
 * agents and the period travel with the tabs: looking at one agent's funnel and
 * then their win/loss should not mean choosing them again.
 */
export function PipelineFilterBar({ members }: { members: PipelineMember[] }) {
  const pathname = usePathname();
  const view = pipelineViewAt(pathname);
  if (!view) return null;
  return <Bar view={view} members={members} />;
}

function Bar({ view, members }: { view: PipelineView; members: PipelineMember[] }) {
  const t = useTranslations("pipeline.filters");
  const tv = useTranslations("pipeline.views");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const filters = parsePipelineFilters(searchParams, { period: view.defaultPeriod });
  const has = (c: PipelineView["controls"][number]) => view.controls.includes(c);

  const navigate = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    const q = next.toString();
    startTransition(() => router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false }));
  };

  const tabHref = (v: PipelineView) => {
    const next = new URLSearchParams();
    for (const key of SHARED) {
      const value = searchParams.get(key);
      if (value && v.controls.includes(key)) next.set(key, value);
    }
    const q = next.toString();
    return q ? `${v.path}?${q}` : v.path;
  };

  const [term, setTerm] = useState(filters.q);
  useEffect(() => setTerm(filters.q), [filters.q]);

  const allOwners = searchParams.get("owners") === ALL_OWNERS;
  const active =
    filters.owners.length > 0 ||
    allOwners ||
    (has("period") && searchParams.has("period")) ||
    (has("status") && filters.status !== null) ||
    (has("q") && filters.q !== "");

  return (
    <div className="mb-6 space-y-3">
      <nav aria-label={t("sections")} className="-mx-1 overflow-x-auto px-1">
        <ul className="flex min-w-max gap-1 border-b">
          {PIPELINE_VIEWS.map((v) => (
            <li key={v.key}>
              <Link
                href={tabHref(v)}
                aria-current={v.key === view.key ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex border-b-2 px-3 py-2 font-medium text-sm transition-colors",
                  v.key === view.key
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {tv(v.key)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex flex-wrap items-center gap-2">
        {has("owners") && (
          <OwnerFilter
            members={members}
            selected={filters.owners}
            all={allOwners}
            onChange={(owners) => navigate({ owners })}
          />
        )}

        {has("period") && (
          <fieldset className="flex rounded-md border p-0.5" aria-label={t("period")}>
            {PERIOD_OPTIONS.map((days) => (
              <button
                key={days}
                type="button"
                aria-pressed={filters.period === days}
                onClick={() => navigate({ period: days === view.defaultPeriod ? null : String(days) })}
                className={cn(
                  "rounded px-2.5 py-1 font-medium text-xs transition-colors",
                  filters.period === days
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {t("days", { days })}
              </button>
            ))}
          </fieldset>
        )}

        {has("status") && (
          <Select value={filters.status ?? "all"} onValueChange={(v) => navigate({ status: v === "all" ? null : v })}>
            <SelectTrigger className="h-8 w-40 text-sm" aria-label={t("status")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("statusAll")}</SelectItem>
              {DEAL_STATUS_FILTERS.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`statuses.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {has("q") && (
          <form
            className="relative"
            onSubmit={(e) => {
              e.preventDefault();
              navigate({ q: term.trim() || null });
            }}
          >
            <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              type="search"
              value={term}
              onChange={(e) => {
                setTerm(e.target.value);
                if (e.target.value === "" && filters.q) navigate({ q: null });
              }}
              placeholder={t("searchDeals")}
              aria-label={t("searchDeals")}
              className="h-8 w-52 pl-8 text-sm"
            />
          </form>
        )}

        {active && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1 text-muted-foreground"
            onClick={() => navigate({ owners: null, period: null, status: null, q: null })}
          >
            <X className="h-3.5 w-3.5" />
            {t("reset")}
          </Button>
        )}

        {isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />}
      </div>
    </div>
  );
}

/**
 * One or more agents, all of them, or none of them — and back to everyone in one click.
 *
 * Applied as it changes rather than behind an "apply" button: each tick is one
 * narrowing the page answers straight away, which is what a filter is for.
 */
function OwnerFilter({
  members,
  selected: explicit,
  all,
  onChange,
}: {
  members: PipelineMember[];
  selected: string[];
  /** Every agent ticked (`owners=all`). */
  all: boolean;
  onChange: (owners: string | null) => void;
}) {
  const t = useTranslations("pipeline.filters");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const everyone = useMemo(() => [...members.map((m) => m.id), UNASSIGNED], [members]);
  const selected = all ? everyone : explicit;
  const chosen = new Set(selected);
  const name = (m: PipelineMember) => m.name || m.email || t("unnamed");

  const visible = members.filter((m) => {
    const q = search.trim().toLocaleLowerCase();
    return !q || name(m).toLocaleLowerCase().includes(q) || (m.email ?? "").toLocaleLowerCase().includes(q);
  });

  const apply = (ids: string[]) => onChange(ownersParam(ids, everyone));
  const toggle = (id: string) => apply(chosen.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  const summary = (() => {
    if (selected.length === 0 || all) return t("allAgents");
    if (selected.length === 1) {
      if (selected[0] === UNASSIGNED) return t("unassigned");
      const m = members.find((x) => x.id === selected[0]);
      return m ? name(m) : t("agentsCount", { count: 1 });
    }
    return t("agentsCount", { count: selected.length });
  })();

  return (
    <div className="flex items-center">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn("h-8 max-w-64 gap-2", selected.length > 0 && "rounded-r-none border-primary/50 bg-primary/5")}
            aria-label={t("agents")}
          >
            <Users className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{summary}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0">
          <div className="border-b p-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("searchAgents")}
              aria-label={t("searchAgents")}
              className="h-8 text-sm"
            />
          </div>
          <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5 text-xs">
            <button
              type="button"
              className="font-medium text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
              onClick={() => apply(everyone)}
              disabled={all}
            >
              {t("selectAll")}
            </button>
            <button
              type="button"
              className="font-medium text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50 disabled:no-underline"
              onClick={() => apply([])}
              disabled={selected.length === 0}
            >
              {t("clearSelection")}
            </button>
          </div>
          <ul className="max-h-72 overflow-y-auto p-1">
            {!search && (
              <OwnerOption
                label={t("unassigned")}
                hint={t("unassignedHint")}
                checked={chosen.has(UNASSIGNED)}
                onToggle={() => toggle(UNASSIGNED)}
              />
            )}
            {visible.map((m) => (
              <OwnerOption
                key={m.id}
                label={name(m)}
                hint={m.former ? t("formerMember") : m.name && m.email ? m.email : undefined}
                checked={chosen.has(m.id)}
                onToggle={() => toggle(m.id)}
              />
            ))}
            {visible.length === 0 && (
              <li className="px-3 py-4 text-center text-muted-foreground text-sm">{t("noAgents")}</li>
            )}
          </ul>
          {selected.length > 0 && (
            <div className="border-t px-3 py-2 text-muted-foreground text-xs">
              {t("selectedCount", { count: selected.length, total: everyone.length })}
            </div>
          )}
        </PopoverContent>
      </Popover>
      {selected.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          className="h-8 rounded-l-none border-primary/50 border-l-0 bg-primary/5 px-2"
          onClick={() => apply([])}
          aria-label={t("clearSelection")}
          title={t("clearSelection")}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

function OwnerOption({
  label,
  hint,
  checked,
  onToggle,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      {/* biome-ignore lint/a11y/noLabelWithoutControl: the checkbox inside is the control */}
      <label className="flex cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm hover:bg-muted">
        <Checkbox checked={checked} onCheckedChange={onToggle} />
        <span className="min-w-0 flex-1">
          <span className="block truncate">{label}</span>
          {hint && <span className="block truncate text-muted-foreground text-xs">{hint}</span>}
        </span>
      </label>
    </li>
  );
}
