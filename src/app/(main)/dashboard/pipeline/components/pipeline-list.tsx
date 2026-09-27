"use client";

import { useEffect, useId, useMemo, useState } from "react";

import Link from "next/link";

import {
  ArrowRightLeft,
  CalendarCheck,
  CalendarIcon,
  CalendarPlus,
  CalendarX2,
  ChevronDown,
  ChevronRight,
  HourglassIcon,
  MoreHorizontal,
  NotebookPen,
  Trophy,
  XCircle,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useCurrency } from "@/hooks/use-currency";
import { dealAmountForDisplay } from "@/lib/deal-amount";
import { cn } from "@/lib/utils";

import { type Deal, needsAttention, type Stage, stageLabel } from "./pipeline-types";
import { StagePicker } from "./stage-picker";

type Sort = "close" | "amount" | "idle" | "name";
const SORTS: Sort[] = ["close", "amount", "idle", "name"];

/** Which sections are folded in the list, per workspace; the board's folding is its own. */
const LIST_FOLDED_KEY = "flux.pipeline.listFolded:";
const SORT_KEY = "flux.pipeline.listSort";

function sortDeals(deals: Deal[], sort: Sort): Deal[] {
  const byName = (a: Deal, b: Deal) => a.name.localeCompare(b.name);
  const copy = [...deals];
  switch (sort) {
    case "amount":
      return copy.sort((a, b) => Number(b.amount ?? 0) - Number(a.amount ?? 0) || byName(a, b));
    case "idle":
      return copy.sort((a, b) => b.signals.idleDays - a.signals.idleDays || byName(a, b));
    case "name":
      return copy.sort(byName);
    default: {
      // Soonest first; a deal with no date at the end, where it cannot be mistaken for urgent.
      const at = (d: Deal) =>
        d.expectedCloseDate ? new Date(d.expectedCloseDate).getTime() : Number.POSITIVE_INFINITY;
      return copy.sort((a, b) => at(a) - at(b) || byName(a, b));
    }
  }
}

/**
 * The pipeline as a list: the board's alternative for a narrow screen, where seven
 * columns are one column and a swipe, and a drag is a long press that fights the scroll.
 *
 * The same deals, the same stages, the same signals, read top to bottom:
 * - a summary of what is open and what it is worth, and the deals that need somebody
 *   today, one tap away as a filter;
 * - a section per stage, in the board's order, folding away like a column does,
 *   its header staying in view while its deals scroll under it;
 * - a row per deal that opens it, and a stage chip that moves it — through a sheet
 *   of stages, with the same rules as a drop on the board (the loss reason, the next
 *   step), because the caller's `onMove` is the board's own.
 */
export function PipelineList({
  stages,
  deals,
  canEdit,
  scope,
  sheet,
  onMove,
  onLog,
  onPlan,
  onLose,
}: {
  stages: Stage[];
  deals: Deal[];
  canEdit: boolean;
  scope: string | null;
  /** Pick stages from a bottom sheet (phone, tablet) rather than a dialog. */
  sheet: boolean;
  onMove: (deal: Deal, stageId: string) => void;
  onLog: (dealId: string) => void;
  onPlan: (deal: Deal) => void;
  onLose: (deal: Deal, stageId: string) => void;
}) {
  const t = useTranslations("pipeline");
  const tl = useTranslations("pipeline.list");
  const format = useFormatter();
  const { formatAmount, formatMoney } = useCurrency();
  const listId = useId();

  const wonStage = stages.find((s) => s.isWon);
  const lostStage = stages.find((s) => s.isLost);

  // Won and lost start folded: they are where deals end, and a year of them would
  // push the work of today off the screen.
  const [folded, setFolded] = useState<string[]>(() => stages.filter((s) => s.isWon || s.isLost).map((s) => s.id));
  const [sort, setSort] = useState<Sort>("close");
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [moving, setMoving] = useState<Deal | null>(null);

  useEffect(() => {
    try {
      const storedSort = window.localStorage.getItem(SORT_KEY);
      if (storedSort && (SORTS as string[]).includes(storedSort)) setSort(storedSort as Sort);
      if (!scope) return;
      const stored = window.localStorage.getItem(`${LIST_FOLDED_KEY}${scope}`);
      if (stored) setFolded(JSON.parse(stored) as string[]);
    } catch {
      // A browser that will not remember is a list that opens the default way.
    }
  }, [scope]);

  const toggle = (stageId: string) => {
    setFolded((current) => {
      const next = current.includes(stageId) ? current.filter((id) => id !== stageId) : [...current, stageId];
      try {
        if (scope) window.localStorage.setItem(`${LIST_FOLDED_KEY}${scope}`, JSON.stringify(next));
      } catch {
        // Forgotten by tomorrow; nothing else lost.
      }
      return next;
    });
  };

  const chooseSort = (next: Sort) => {
    setSort(next);
    try {
      window.localStorage.setItem(SORT_KEY, next);
    } catch {
      // As above.
    }
  };

  const open = deals.filter((d) => d.status === "open");
  const openValue = open.reduce((sum, d) => sum + Number(d.amount ?? 0), 0);
  const weighted = open.reduce((sum, d) => sum + (Number(d.amount ?? 0) * (d.probability ?? 0)) / 100, 0);
  const attentionCount = open.filter((d) => needsAttention(d)).length;

  const sections = useMemo(
    () =>
      stages.map((stage) => {
        const all = deals.filter((d) => d.stageId === stage.id);
        const shown = onlyAttention ? all.filter((d) => needsAttention(d)) : all;
        return {
          stage,
          deals: sortDeals(shown, sort),
          count: all.length,
          total: all.reduce((sum, d) => sum + Number(d.amount ?? 0), 0),
        };
      }),
    [stages, deals, onlyAttention, sort],
  );

  const shortDate = (d: Date | string) => format.dateTime(new Date(d), { month: "short", day: "numeric" });
  const now = Date.now();

  return (
    <div data-sticky-sections="" className="flex flex-col gap-3 pb-4">
      {/* What is open and what it is worth: the three figures a column header carries,
          for the whole pipeline at once. */}
      <div className="grid grid-cols-3 divide-x rounded-xl border bg-card shadow-xs">
        {[
          { label: tl("open"), value: format.number(open.length) },
          { label: tl("value"), value: formatAmount(openValue, { noDecimals: true }) },
          { label: tl("weighted"), value: formatAmount(weighted, { noDecimals: true }) },
        ].map((m) => (
          <div key={m.label} className="min-w-0 px-2.5 py-2.5 sm:px-3">
            <p className="truncate text-[11px] text-muted-foreground uppercase tracking-wide">{m.label}</p>
            <p className="truncate font-semibold text-sm tabular-nums sm:text-base">{m.value}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant={onlyAttention ? "default" : "outline"}
          size="sm"
          aria-pressed={onlyAttention}
          onClick={() => setOnlyAttention((v) => !v)}
          className="h-9 min-w-0 shrink gap-1.5"
          title={tl("attentionHelp")}
        >
          <CalendarX2 className="size-4 shrink-0" aria-hidden />
          <span className="truncate">{tl("attention")}</span>
          <span
            className={cn(
              "rounded-full px-1.5 font-semibold text-[11px] tabular-nums",
              onlyAttention ? "bg-primary-foreground/20" : "bg-muted",
            )}
          >
            {attentionCount}
          </span>
        </Button>
        <div className="ml-auto flex min-w-0 items-center gap-2 text-muted-foreground text-xs">
          <label htmlFor={`${listId}-sort`} className="max-sm:sr-only">
            {tl("sortBy")}
          </label>
          <NativeSelect
            id={`${listId}-sort`}
            value={sort}
            onChange={(e) => chooseSort(e.target.value as Sort)}
            className="h-9 min-w-0 text-sm"
          >
            {SORTS.map((s) => (
              <NativeSelectOption key={s} value={s}>
                {tl(`sort.${s}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>

      {onlyAttention && attentionCount === 0 && (
        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-muted-foreground text-sm">
          {tl("attentionNone")}
        </p>
      )}

      {sections.map(({ stage, deals: rows, count, total }) => {
        // Filtered to what needs attention, a stage with none of it is noise.
        if (onlyAttention && rows.length === 0) return null;
        const isFolded = folded.includes(stage.id) && !onlyAttention;
        const panelId = `${listId}-${stage.id}`;
        return (
          <section key={stage.id} aria-label={stageLabel(stage)}>
            {/* ⚠️ Sticky, so the stage a deal belongs to stays readable however far
                down it is. It sticks to the page, which is what scrolls: the boxes
                above that only look like scrollers stand aside for `data-sticky-sections`
                (the dashboard layout), and under a sticky navbar it stops below it. */}
            <button
              type="button"
              aria-expanded={!isFolded}
              aria-controls={panelId}
              onClick={() => toggle(stage.id)}
              className="sticky top-0 z-10 flex min-h-11 [html[data-navbar-style=sticky]_&]:top-(--app-header-height) w-full items-center gap-2 rounded-lg bg-background/95 px-1 py-2 text-left backdrop-blur supports-backdrop-filter:bg-background/80"
            >
              {isFolded ? (
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              ) : (
                <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              )}
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: stage.color ?? "var(--muted-foreground)" }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate font-semibold text-sm">{stageLabel(stage)}</span>
              <span className="shrink-0 rounded-full bg-muted px-2 font-semibold text-[11px] tabular-nums leading-5">
                {count}
              </span>
              <span className="w-24 shrink-0 truncate text-right font-medium text-muted-foreground text-xs tabular-nums">
                {formatAmount(total, { noDecimals: true })}
              </span>
            </button>

            {!isFolded && (
              <div id={panelId}>
                {rows.length === 0 ? (
                  <p className="rounded-xl border border-dashed px-4 py-3 text-muted-foreground text-xs">
                    {tl("emptyStage")}
                  </p>
                ) : (
                  <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
                    {rows.map((deal) => {
                      const shown = dealAmountForDisplay(deal);
                      const overdue =
                        deal.status === "open" &&
                        deal.expectedCloseDate !== null &&
                        new Date(deal.expectedCloseDate).getTime() < now;
                      return (
                        <li key={deal.id} className="relative flex gap-3 px-3 py-3 transition-colors hover:bg-muted/40">
                          <span
                            className="w-1 shrink-0 self-stretch rounded-full"
                            style={{ backgroundColor: stage.color ?? "var(--border)" }}
                            aria-hidden
                          />
                          <div className="min-w-0 flex-1">
                            {/* The whole row opens the deal; the two buttons sit above the link. */}
                            <Link
                              href={`/dashboard/pipeline/${deal.id}`}
                              className="line-clamp-2 break-words font-semibold text-sm leading-snug after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-sm focus-visible:after:ring-2 focus-visible:after:ring-ring"
                            >
                              {deal.name}
                            </Link>
                            {/* Who and how much; then the odds, the date and whatever is wrong,
                                in words. The company keeps the width a name needs. */}
                            <div className="mt-0.5 flex items-baseline gap-2">
                              <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
                                {deal.companyName}
                              </span>
                              <span className="shrink-0 font-semibold text-sm tabular-nums">
                                {formatMoney(shown.value, shown.currency)}
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-muted-foreground">
                              {(deal.probability ?? 0) > 0 && (
                                <span className="tabular-nums">
                                  <span className="sr-only">{t("probability")}: </span>
                                  {deal.probability}%
                                </span>
                              )}
                              {deal.expectedCloseDate && (
                                <span
                                  className={cn(
                                    "flex items-center gap-1",
                                    overdue && "font-medium text-red-600 dark:text-red-400",
                                  )}
                                >
                                  <CalendarIcon className="size-3" aria-hidden />
                                  <span className="sr-only">{t("expectedClose")}: </span>
                                  {shortDate(deal.expectedCloseDate)}
                                </span>
                              )}
                              {deal.status === "open" &&
                                (deal.signals.hasNextStep ? (
                                  <span className="flex items-center gap-1">
                                    <CalendarCheck className="size-3" aria-hidden />
                                    {deal.signals.nextStepAt
                                      ? t("nextStepOn", { date: shortDate(deal.signals.nextStepAt) })
                                      : t("nextStepUndated")}
                                  </span>
                                ) : (
                                  <span className="flex items-center gap-1 font-medium text-red-600 dark:text-red-400">
                                    <CalendarX2 className="size-3" aria-hidden />
                                    {t("signals.noNextStep")}
                                  </span>
                                ))}
                              {deal.status === "open" && deal.stale && typeof deal.daysInStage === "number" && (
                                <span className="font-medium text-amber-700 dark:text-amber-400">
                                  {t("stuckInStage", { days: deal.daysInStage })}
                                </span>
                              )}
                              {deal.status === "open" && deal.signals.stalled && (
                                <span className="flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400">
                                  <HourglassIcon className="size-3" aria-hidden />
                                  {t("signals.idle", { days: deal.signals.idleDays })}
                                </span>
                              )}
                            </div>
                          </div>
                          {canEdit && (
                            <div className="relative z-10 -my-1 -mr-1 flex shrink-0 items-start gap-0.5">
                              {/* The move a finger cannot drag: one tap, then the stage. */}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-9 text-muted-foreground hover:text-foreground"
                                onClick={() => setMoving(deal)}
                                aria-label={tl("moveAria", { name: deal.name, stage: stageLabel(stage) })}
                                title={tl("move")}
                              >
                                <ArrowRightLeft className="size-4" />
                              </Button>
                              {deal.status === "open" && (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="size-9"
                                      aria-label={t("quickActions", { name: deal.name })}
                                    >
                                      <MoreHorizontal className="size-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onSelect={() => onLog(deal.id)}>
                                      <NotebookPen className="size-4" aria-hidden />
                                      {t("quick.log")}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onSelect={() => onPlan(deal)}>
                                      <CalendarPlus className="size-4" aria-hidden />
                                      {t("quick.plan")}
                                    </DropdownMenuItem>
                                    {(wonStage || lostStage) && <DropdownMenuSeparator />}
                                    {wonStage && (
                                      <DropdownMenuItem onSelect={() => onMove(deal, wonStage.id)}>
                                        <Trophy className="size-4" aria-hidden />
                                        {t("quick.won")}
                                      </DropdownMenuItem>
                                    )}
                                    {lostStage && (
                                      <DropdownMenuItem onSelect={() => onLose(deal, lostStage.id)}>
                                        <XCircle className="size-4" aria-hidden />
                                        {t("quick.lost")}
                                      </DropdownMenuItem>
                                    )}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </section>
        );
      })}

      <StagePicker
        stages={stages}
        currentStageId={moving?.stageId ?? null}
        dealName={moving?.name ?? ""}
        open={moving !== null}
        onOpenChange={(v) => {
          if (!v) setMoving(null);
        }}
        onPick={(stageId) => {
          if (moving) onMove(moving, stageId);
        }}
        sheet={sheet}
      />
    </div>
  );
}
