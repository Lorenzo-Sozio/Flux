"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Check, ChevronDown, Loader2, Search, SlidersHorizontal, Users, X } from "lucide-react";
import { useTranslations } from "next-intl";

import type { PipelineMember } from "@/actions/pipeline-members";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePeriodLabel } from "@/hooks/use-period-label";
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
const SHARED = ["owners", "period", "pipeline"] as const;

/**
 * The tabs and the filters of the Pipeline section, drawn once in its layout.
 *
 * Every page reads the same URL parameters (src/lib/pipeline-filters.ts), and the
 * agents and the period travel with the tabs: looking at one agent's funnel and
 * then their win/loss should not mean choosing them again.
 *
 * ⚠️ Below lg it is a different layout, not a narrower one. Eight tabs and four
 * controls in a row that scrolled sideways put half of them past the edge of the
 * screen, where nobody knew they were. On a phone or a tablet (lg, not md: beside the
 * sidebar an upright tablet has 524px for 715px of tabs) the tabs are one menu, the search
 * takes the row, and every other filter lives in a sheet behind one button whose
 * badge says how many are on — with the ones that are on shown underneath as chips
 * that wrap, each removable with a tap.
 */
export function PipelineFilterBar({
  members,
  pipelines = [],
}: {
  members: PipelineMember[];
  pipelines?: { id: string; name: string }[];
}) {
  const pathname = usePathname();
  const view = pipelineViewAt(pathname);
  if (!view) return null;
  return <Bar view={view} members={members} pipelines={pipelines} />;
}

function Bar({
  view,
  members,
  pipelines,
}: {
  view: PipelineView;
  members: PipelineMember[];
  pipelines: { id: string; name: string }[];
}) {
  const t = useTranslations("pipeline.filters");
  const tv = useTranslations("pipeline.views");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [sheetOpen, setSheetOpen] = useState(false);

  const filters = parsePipelineFilters(searchParams, { period: view.defaultPeriod });
  const periodLabel = usePeriodLabel();
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

  // From lg up the tabs are a row, and the page you are on can be past its edge on a
  // narrow window (Report is last), which reads as "no tab is selected". Bring it into
  // view, sideways only: `block: "nearest"` keeps this from scrolling the page itself.
  const activeTab = useRef<HTMLAnchorElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when the view changes, which moves the active tab
  useEffect(() => {
    activeTab.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [view.key]);

  const allOwners = searchParams.get("owners") === ALL_OWNERS;
  const showPipeline = has("pipeline") && pipelines.length > 1;
  const pipelineValue = filters.pipeline ?? pipelines[0]?.id;
  const pipelineName =
    pipelineValue === "all" ? t("allPipelines") : (pipelines.find((p) => p.id === pipelineValue)?.name ?? "");
  const resetAll = () => navigate({ owners: null, period: null, status: null, q: null, closed: null });

  const active =
    filters.owners.length > 0 ||
    allOwners ||
    (has("period") && searchParams.has("period")) ||
    (has("status") && filters.status !== null) ||
    (has("q") && filters.q !== "") ||
    (has("closed") && filters.closed !== null);

  const owners = useOwnerSelection({
    members,
    explicit: filters.owners,
    all: allOwners,
    onChange: (value) => navigate({ owners: value }),
  });

  // What the phone's sheet holds that is switched on: its badge, and the chips.
  const chips: { key: string; label: string; remove: () => void }[] = [];
  if (showPipeline && filters.pipeline)
    chips.push({ key: "pipeline", label: pipelineName, remove: () => navigate({ pipeline: null }) });
  if (has("owners") && owners.selected.length > 0)
    chips.push({ key: "owners", label: owners.summary, remove: () => owners.apply([]) });
  if (has("period") && searchParams.has("period"))
    chips.push({ key: "period", label: t("days", { days: filters.period }), remove: () => navigate({ period: null }) });
  if (has("status") && filters.status)
    chips.push({ key: "status", label: t(`statuses.${filters.status}`), remove: () => navigate({ status: null }) });
  if (has("closed") && filters.closed)
    chips.push({
      key: "closed",
      label: t("closedIn", { period: periodLabel(filters.closed) }),
      remove: () => navigate({ closed: null }),
    });
  const sheetControls = showPipeline || has("owners") || has("period") || has("status");

  const periodButtons = (fill: boolean) => (
    <fieldset className={cn("flex rounded-md border p-0.5", fill && "grid grid-cols-4")} aria-label={t("period")}>
      {PERIOD_OPTIONS.map((days) => (
        <button
          key={days}
          type="button"
          aria-pressed={filters.period === days}
          onClick={() => navigate({ period: days === view.defaultPeriod ? null : String(days) })}
          className={cn(
            "rounded px-2.5 py-1 font-medium text-xs transition-colors",
            fill && "min-h-10 text-sm",
            filters.period === days
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {fill ? t("daysShort", { days }) : t("days", { days })}
        </button>
      ))}
    </fieldset>
  );

  const searchField = (className: string) => (
    <form
      className="relative min-w-0"
      onSubmit={(e) => {
        e.preventDefault();
        navigate({ q: term.trim() || null });
      }}
    >
      <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 text-muted-foreground" />
      {/* `md:text-sm`, not `text-sm`: below 16px iOS Safari zooms the whole
          page in when the field takes focus, and does not zoom back out. */}
      <Input
        type="search"
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
          if (e.target.value === "" && filters.q) navigate({ q: null });
        }}
        placeholder={t("searchDeals")}
        aria-label={t("searchDeals")}
        className={cn("pl-8 md:text-sm", className)}
      />
    </form>
  );

  return (
    <div className="mb-4 shrink-0 space-y-3">
      {/* ── Phone and tablet: the sections as one menu ──────────────────── */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="h-11 w-full justify-between gap-2 px-3 font-semibold lg:hidden"
            aria-label={t("sectionPicker", { section: tv(view.key) })}
          >
            <span className="truncate">{tv(view.key)}</span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width)">
          {PIPELINE_VIEWS.map((v) => (
            <DropdownMenuItem key={v.key} asChild className="min-h-11">
              <Link href={tabHref(v)} aria-current={v.key === view.key ? "page" : undefined}>
                <span className={cn("flex-1", v.key === view.key && "font-semibold")}>{tv(v.key)}</span>
                {v.key === view.key && <Check className="size-4 text-primary" aria-hidden />}
              </Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* ── lg and up: the tabs ─────────────────────────────────────────── */}
      <nav aria-label={t("sections")} className="scrollbar-slim -mx-1 shrink-0 overflow-x-auto px-1 max-lg:hidden">
        <ul className="flex min-w-max gap-1 border-b">
          {PIPELINE_VIEWS.map((v) => (
            <li key={v.key}>
              <Link
                ref={v.key === view.key ? activeTab : undefined}
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

      {/* ── Phone and tablet: search, one button for the rest, what is on ─ */}
      <div className="space-y-2 lg:hidden">
        <div className="flex items-center gap-2">
          {has("q") ? <div className="min-w-0 flex-1">{searchField("h-11 w-full")}</div> : <div className="flex-1" />}
          {sheetControls && (
            <Button
              variant="outline"
              className={cn("h-11 shrink-0 gap-2 px-3", chips.length > 0 && "border-primary/50 bg-primary/5")}
              onClick={() => setSheetOpen(true)}
              aria-label={t("filtersAria", { count: chips.length })}
            >
              <SlidersHorizontal className="size-4" aria-hidden />
              {t("filters")}
              {chips.length > 0 && (
                <span className="flex size-5 items-center justify-center rounded-full bg-primary font-semibold text-[11px] text-primary-foreground tabular-nums">
                  {chips.length}
                </span>
              )}
            </Button>
          )}
          {isPending && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />}
        </div>
        {chips.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label={t("activeFilters")}>
            {chips.map((chip) => (
              <li key={chip.key} className="min-w-0 max-w-full">
                <button
                  type="button"
                  onClick={chip.remove}
                  aria-label={t("removeFilter", { label: chip.label })}
                  className="flex h-8 max-w-full items-center gap-1 rounded-full border border-primary/30 bg-primary/5 pr-2 pl-3 font-medium text-xs transition-colors hover:bg-primary/10"
                >
                  <span className="truncate">{chip.label}</span>
                  <X className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Drawer open={sheetOpen} onOpenChange={setSheetOpen}>
        <DrawerContent className="max-h-[90dvh] pb-[var(--safe-bottom)] lg:hidden">
          <DrawerHeader className="text-left">
            <DrawerTitle>{t("filters")}</DrawerTitle>
            <DrawerDescription>{tv(view.key)}</DrawerDescription>
          </DrawerHeader>
          <div className="flex min-h-0 flex-col gap-5 overflow-y-auto px-4 pb-2">
            {showPipeline && (
              <div className="space-y-2">
                <p className="font-medium text-sm">{t("pipeline")}</p>
                <Select
                  value={pipelineValue}
                  onValueChange={(v) => navigate({ pipeline: v === pipelines[0].id ? null : v })}
                >
                  <SelectTrigger className="h-11 w-full" aria-label={t("pipeline")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {pipelines.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                    {view.key === "board" && <SelectItem value="all">{t("allPipelines")}</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
            )}
            {has("status") && (
              <div className="space-y-2">
                <p className="font-medium text-sm">{t("status")}</p>
                <fieldset className="grid grid-cols-4 rounded-md border p-0.5" aria-label={t("status")}>
                  {(["all", ...DEAL_STATUS_FILTERS] as const).map((s) => {
                    const on = (filters.status ?? "all") === s;
                    return (
                      <button
                        key={s}
                        type="button"
                        aria-pressed={on}
                        onClick={() => navigate({ status: s === "all" ? null : s })}
                        className={cn(
                          "min-h-10 truncate rounded px-1 font-medium text-sm transition-colors",
                          on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                        )}
                      >
                        {s === "all" ? t("statusAllShort") : t(`statuses.${s}`)}
                      </button>
                    );
                  })}
                </fieldset>
              </div>
            )}
            {has("period") && (
              <div className="space-y-2">
                <p className="font-medium text-sm">{t("period")}</p>
                {periodButtons(true)}
              </div>
            )}
            {has("owners") && (
              <div className="space-y-2">
                <p className="font-medium text-sm">{t("agentsTitle")}</p>
                <div className="overflow-hidden rounded-md border">
                  <OwnerList selection={owners} listClassName="max-h-64" />
                </div>
              </div>
            )}
          </div>
          <DrawerFooter className="flex-row gap-2 border-t">
            <Button variant="outline" className="h-11 flex-1" onClick={resetAll} disabled={!active}>
              {t("reset")}
            </Button>
            <Button className="h-11 flex-1" onClick={() => setSheetOpen(false)}>
              {t("showResults")}
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* ── lg and up: the controls in a row that wraps ─────────────────── */}
      <div className="flex flex-wrap items-center gap-2 max-lg:hidden">
        {/* One pipeline at a time; the selector appears only when there is a second one. */}
        {showPipeline && (
          <Select value={pipelineValue} onValueChange={(v) => navigate({ pipeline: v === pipelines[0].id ? null : v })}>
            <SelectTrigger className="h-8 w-44 text-sm" aria-label={t("pipeline")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pipelines.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
              {view.key === "board" && <SelectItem value="all">{t("allPipelines")}</SelectItem>}
            </SelectContent>
          </Select>
        )}

        {has("owners") && <OwnerFilter selection={owners} />}

        {has("period") && periodButtons(false)}

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

        {has("q") && searchField("h-8 w-52")}

        {/* Arrives only from a link — a figure on the scorecard — so it is shown as what it
            is, removable, rather than as a control nobody would set by hand. */}
        {has("closed") && filters.closed && (
          <Button
            variant="secondary"
            size="sm"
            className="h-8 gap-1"
            onClick={() => navigate({ closed: null })}
            aria-label={t("closedRemove", { period: periodLabel(filters.closed) })}
          >
            {t("closedIn", { period: periodLabel(filters.closed) })}
            <X className="h-3.5 w-3.5" aria-hidden />
          </Button>
        )}

        {active && (
          <Button variant="ghost" size="sm" className="h-8 gap-1 text-muted-foreground" onClick={resetAll}>
            <X className="h-3.5 w-3.5" />
            {t("reset")}
          </Button>
        )}

        {isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />}
      </div>
    </div>
  );
}

type OwnerSelection = ReturnType<typeof useOwnerSelection>;

/**
 * One or more agents, all of them, or none of them — and back to everyone in one tap.
 *
 * Applied as it changes rather than behind an "apply" button: each tick is one
 * narrowing the page answers straight away, which is what a filter is for. The same
 * selection drives the desktop popover and the phone's sheet.
 */
function useOwnerSelection({
  members,
  explicit,
  all,
  onChange,
}: {
  members: PipelineMember[];
  explicit: string[];
  /** Every agent ticked (`owners=all`). */
  all: boolean;
  onChange: (owners: string | null) => void;
}) {
  const t = useTranslations("pipeline.filters");
  const everyone = useMemo(() => [...members.map((m) => m.id), UNASSIGNED], [members]);
  const selected = all ? everyone : explicit;
  const chosen = new Set(selected);
  const name = (m: PipelineMember) => m.name || m.email || t("unnamed");

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

  return { members, everyone, selected, chosen, all, name, apply, toggle, summary };
}

function OwnerFilter({ selection }: { selection: OwnerSelection }) {
  const t = useTranslations("pipeline.filters");
  const [open, setOpen] = useState(false);
  const { selected, summary, apply } = selection;

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
          <OwnerList selection={selection} listClassName="max-h-72" />
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

function OwnerList({ selection, listClassName }: { selection: OwnerSelection; listClassName: string }) {
  const t = useTranslations("pipeline.filters");
  const [search, setSearch] = useState("");
  const { members, everyone, selected, chosen, all, name, apply, toggle } = selection;

  const visible = members.filter((m) => {
    const q = search.trim().toLocaleLowerCase();
    return !q || name(m).toLocaleLowerCase().includes(q) || (m.email ?? "").toLocaleLowerCase().includes(q);
  });

  return (
    <>
      <div className="border-b p-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("searchAgents")}
          aria-label={t("searchAgents")}
          className="h-8 md:text-sm"
        />
      </div>
      <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5 text-xs">
        <button
          type="button"
          className="min-h-8 font-medium text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
          onClick={() => apply(everyone)}
          disabled={all}
        >
          {t("selectAll")}
        </button>
        <button
          type="button"
          className="min-h-8 font-medium text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50 disabled:no-underline"
          onClick={() => apply([])}
          disabled={selected.length === 0}
        >
          {t("clearSelection")}
        </button>
      </div>
      <ul className={cn("overflow-y-auto p-1", listClassName)}>
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
    </>
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
      <label className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm hover:bg-muted">
        <Checkbox checked={checked} onCheckedChange={onToggle} />
        <span className="min-w-0 flex-1">
          <span className="block truncate">{label}</span>
          {hint && <span className="block truncate text-muted-foreground text-xs">{hint}</span>}
        </span>
      </label>
    </li>
  );
}
