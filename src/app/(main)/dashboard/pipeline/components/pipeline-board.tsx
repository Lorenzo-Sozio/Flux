"use client";

import { useEffect, useState } from "react";

import Link from "next/link";

import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import {
  ArrowRightLeft,
  Building2,
  CalendarCheck,
  CalendarIcon,
  CalendarPlus,
  CalendarX2,
  ChevronsLeftRight,
  ChevronsRightLeft,
  CoinsIcon,
  HourglassIcon,
  KanbanSquare,
  List,
  MoreHorizontal,
  NotebookPen,
  PencilIcon,
  PlusIcon,
  Scale,
  Settings2,
  TimerIcon,
  Trophy,
  XCircle,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { getLossReasons, updateDealStage } from "@/actions/pipeline";
import { ActivityModal } from "@/components/crm/activity-modal";
import { DealModal } from "@/components/crm/deal-modal";
import { type LossAnswer, type LossReason, LostDealDialog } from "@/components/crm/lost-deal-dialog";
import { PlanFollowUpDialog } from "@/components/crm/plan-follow-up-dialog";
import { useWorkspaceScope } from "@/components/crm/workspace-scope";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useCurrency } from "@/hooks/use-currency";
import { dealAmountForDisplay } from "@/lib/deal-amount";
import { cn } from "@/lib/utils";

import { PipelineList } from "./pipeline-list";
import { type Deal, type Stage, stageLabel } from "./pipeline-types";
import { StagePicker } from "./stage-picker";

/** Where the folded stages are remembered, per workspace. */
const FOLDED_KEY = "flux.pipeline.folded:";

type View = "board" | "list";

/**
 * Below this the list is where the pipeline opens: phones, and tablets held upright,
 * where the board is one column at a time and a drag is a long press that fights
 * the scroll. From here up, the board.
 */
const COMPACT_QUERY = "(max-width: 1023px)";

/** The view somebody chose, remembered per kind of screen: a board on the desktop
 *  does not mean a board on the phone. */
const viewKey = (compact: boolean) => `flux.pipeline.view:${compact ? "compact" : "wide"}`;

export function PipelineBoard({
  initialStages,
  initialDeals,
  companies,
  contacts,
  canEdit = true,
  canManageStages = false,
}: {
  initialStages: Stage[];
  initialDeals: Deal[];
  /** Left out, the deal dialog loads them when it opens. */
  companies?: { id: string; name: string }[];
  contacts?: { id: string; firstName: string | null; lastName: string | null }[];
  canEdit?: boolean;
  canManageStages?: boolean;
}) {
  const t = useTranslations("pipeline");
  const format = useFormatter();
  const { formatAmount, formatMoney } = useCurrency();
  const [isMounted, setIsMounted] = useState(false);
  const scope = useWorkspaceScope();
  // Which stages are folded away, per workspace and per browser. A preference about
  // how somebody looks at their own board: worth remembering, worth nothing if lost.
  const [folded, setFolded] = useState<string[]>([]);
  const [deals, setDeals] = useState(initialDeals);
  const [pendingLoss, setPendingLoss] = useState<{ dealId: string; dealName: string; stageId: string } | null>(null);
  const [askNextStep, setAskNextStep] = useState<{ id: string; name: string } | null>(null);
  const [logging, setLogging] = useState<string | null>(null);
  const wonStage = initialStages.find((st) => st.isWon);
  const lostStage = initialStages.find((st) => st.isLost);
  const [lossReasons, setLossReasons] = useState<LossReason[]>([]);
  // ⚠️ Scroll snapping is switched off while a card is being dragged. With
  // `snap-mandatory` on, every small step the drag's auto-scroll takes towards
  // the next column is snapped straight back to the current one, so on a phone a
  // card could never be carried past the edge of the screen.
  const [dragging, setDragging] = useState(false);
  const [compact, setCompact] = useState(false);
  const [view, setView] = useState<View>("board");
  // A deal whose stage is being picked from the list of stages, not dragged.
  const [moving, setMoving] = useState<Deal | null>(null);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Which kind of screen this is, and the view chosen on it: never having chosen,
  // the list on a compact screen and the board on a wide one.
  useEffect(() => {
    const mql = window.matchMedia(COMPACT_QUERY);
    const apply = () => {
      const isCompact = mql.matches;
      setCompact(isCompact);
      let stored: string | null = null;
      try {
        stored = window.localStorage.getItem(viewKey(isCompact));
      } catch {
        // No memory: the default for the screen.
      }
      setView(stored === "board" || stored === "list" ? stored : isCompact ? "list" : "board");
    };
    apply();
    mql.addEventListener("change", apply);
    return () => mql.removeEventListener("change", apply);
  }, []);

  const chooseView = (next: View) => {
    setView(next);
    try {
      window.localStorage.setItem(viewKey(compact), next);
    } catch {
      // The choice holds until the page is reloaded.
    }
  };

  useEffect(() => {
    if (!scope) return;
    try {
      const stored = window.localStorage.getItem(`${FOLDED_KEY}${scope}`);
      setFolded(stored ? (JSON.parse(stored) as string[]) : []);
    } catch {
      // A browser that will not store this is not a problem worth reporting.
    }
  }, [scope]);

  const toggleFold = (stageId: string) => {
    setFolded((current) => {
      const next = current.includes(stageId) ? current.filter((id) => id !== stageId) : [...current, stageId];
      try {
        if (scope) window.localStorage.setItem(`${FOLDED_KEY}${scope}`, JSON.stringify(next));
      } catch {
        // Same again: the board still works, it just forgets by tomorrow.
      }
      return next;
    });
  };

  // Loaded once, and only where there is a losing column to drop into.
  useEffect(() => {
    if (!initialStages.some((st) => st.isLost)) return;
    getLossReasons()
      .then((rows) => setLossReasons(rows.map((r) => ({ id: r.id, name: r.name }))))
      .catch(() => setLossReasons([]));
  }, [initialStages]);

  useEffect(() => {
    setDeals(initialDeals);
  }, [initialDeals]);

  /**
   * Applies a move, optimistically, and puts the board back if the server refuses.
   */
  const commitMove = async (dealId: string, stageId: string, loss?: LossAnswer) => {
    setDeals((prev) => prev.map((d) => (d.id === dealId ? { ...d, stageId } : d)));
    try {
      await updateDealStage(dealId, stageId, loss);
    } catch (e) {
      console.error(e);
      setDeals(initialDeals);
    }
  };

  /**
   * A deal sent to another stage, however it was sent: dropped on the board, or
   * picked from the list of stages. One path, so the list asks what the board asks.
   * A drop back into its own column is not a move, and writes nothing.
   */
  const requestMove = async (deal: Deal, stageId: string) => {
    if (deal.stageId === stageId) return;

    // Dropping into the losing column is the one moment the reason is still
    // known. Ask now; asked at the sales meeting a week later, nobody remembers.
    const target = initialStages.find((st) => st.id === stageId);
    if (target?.isLost) {
      setPendingLoss({ dealId: deal.id, dealName: deal.name, stageId });
      return;
    }

    await commitMove(deal.id, stageId);

    // ⚠️ Moved on, with nothing planned: the moment somebody touches a deal is the moment
    // to ask what happens next (V2.1). Not for a deal just won or lost.
    if (canEdit && !target?.isWon && !deal.signals.hasNextStep) {
      setAskNextStep({ id: deal.id, name: deal.name });
    }
  };

  const onDragEnd = async (result: DropResult) => {
    setDragging(false);
    const { destination, draggableId } = result;
    if (!destination) return;
    const deal = deals.find((d) => d.id === draggableId);
    if (deal) await requestMove(deal, destination.droppableId);
  };

  if (!isMounted) return null;

  // Read once per render, so every card on the board agrees on what "overdue" means.
  const now = Date.now();

  return (
    // Fills the height the section gives it (see the section layout) rather than
    // subtracting a measured constant from the viewport, which was wrong the moment
    // the filters wrapped onto a second line. The floor is there for the short
    // window a phone in landscape leaves: a board of 200px is not a board.
    //
    // The list is a document instead: it scrolls in the section's scroller, which is
    // what lets each stage's header stay in view above its deals.
    <div
      className={cn("flex w-full flex-col", view === "board" ? "h-full min-h-[26rem] overflow-hidden" : "min-h-full")}
    >
      {logging && (
        <ActivityModal
          mode="create"
          entityType="deal"
          entityId={logging}
          revalidatePathStr="/dashboard/pipeline"
          open
          onOpenChange={(v) => {
            if (!v) setLogging(null);
          }}
        />
      )}
      {askNextStep && (
        <PlanFollowUpDialog
          target={{ entity: "deal", id: askNextStep.id }}
          title={askNextStep.name}
          open
          onOpenChange={(v) => {
            if (!v) setAskNextStep(null);
          }}
          onPlanned={() => {
            const planned = askNextStep.id;
            setDeals((prev) =>
              prev.map((d) => (d.id === planned ? { ...d, signals: { ...d.signals, hasNextStep: true } } : d)),
            );
          }}
        />
      )}
      <LostDealDialog
        open={pendingLoss !== null}
        dealName={pendingLoss?.dealName ?? ""}
        reasons={lossReasons}
        // Cancelling leaves the card where it was: the move never happened,
        // because a loss without its reason is the thing being fixed here.
        onCancel={() => setPendingLoss(null)}
        onConfirm={async (answer) => {
          if (!pendingLoss) return;
          await commitMove(pendingLoss.dealId, pendingLoss.stageId, answer);
          setPendingLoss(null);
        }}
      />

      {/*
        ⚠️ The ways of *looking* at the pipeline — forecast, funnel, report — are the
        section's tabs now, drawn above this by the section layout. They were also three
        buttons here, so the same four destinations appeared twice on one screen, and the
        pair disagreed about which one you were on. What is left is what belongs to the
        board itself: changing its stages, and adding a deal.
      */}
      <StagePicker
        stages={initialStages}
        currentStageId={moving?.stageId ?? null}
        dealName={moving?.name ?? ""}
        open={moving !== null}
        onOpenChange={(v) => {
          if (!v) setMoving(null);
        }}
        onPick={(stageId) => {
          if (moving) void requestMove(moving, stageId);
        }}
        sheet={compact}
      />

      <div className="mb-4 flex shrink-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-semibold text-lg tracking-tight">{t("title")}</h2>
          <p className="truncate text-muted-foreground text-sm">
            {view === "list" ? t("list.subtitle") : t("boardSubtitle")}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* Two ways of looking at the same deals. Each kind of screen remembers
              its own, so choosing the board on a laptop leaves the phone on the list. */}
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={view}
            // A single toggle group lets its only pressed item be pressed off; a view
            // always has to be one of the two.
            onValueChange={(v) => {
              if (v === "board" || v === "list") chooseView(v);
            }}
            aria-label={t("list.viewLabel")}
          >
            {(
              [
                { value: "board", icon: KanbanSquare, label: t("list.viewBoard") },
                { value: "list", icon: List, label: t("list.viewList") },
              ] as const
            ).map(({ value, icon: Icon, label }) => (
              <ToggleGroupItem
                key={value}
                value={value}
                aria-label={label}
                title={label}
                className="gap-1.5 max-md:size-9 max-md:px-0"
              >
                <Icon className="size-4" aria-hidden />
                <span className="max-xl:sr-only">{label}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {canManageStages && (
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard/settings/pipeline">
                <Settings2 className="h-4 w-4 sm:mr-2" />
                <span className="max-sm:sr-only">{t("manageStages")}</span>
              </Link>
            </Button>
          )}
          {canEdit && (
            <DealModal stages={initialStages} companies={companies} contacts={contacts}>
              <Button size="sm" className="gap-2">
                <PlusIcon className="h-4 w-4" />
                <span className="max-sm:sr-only">{t("newDeal")}</span>
              </Button>
            </DealModal>
          )}
        </div>
      </div>
      {view === "list" ? (
        <PipelineList
          stages={initialStages}
          deals={deals}
          canEdit={canEdit}
          scope={scope}
          sheet={compact}
          onMove={(deal, stageId) => void requestMove(deal, stageId)}
          onLog={setLogging}
          onPlan={(deal) => setAskNextStep({ id: deal.id, name: deal.name })}
          onLose={(deal, stageId) => setPendingLoss({ dealId: deal.id, dealName: deal.name, stageId })}
        />
      ) : (
        <DragDropContext onDragStart={() => setDragging(true)} onDragEnd={onDragEnd}>
          {/* Columns shared the available width with no minimum, so a pipeline with
            seven stages rendered as unreadable strips and adding a stage made the
            board worse instead of richer (audit rilievo U-05). They now keep a
            legible width and the board scrolls sideways instead. */}
          {/* One horizontal scrollbar for the board, styled rather than left to the
            platform's default, which draws a grey slab across the bottom on Windows. */}
          {/* ⚠️⚠️ Columns **share** the width and scroll only when sharing it would make
            them unreadable. They used to be `min-w-[280px] shrink-0`, so six stages were
            1700px wide on a 1200px screen and the board scrolled sideways from the first
            visit: the stages past the edge were invisible, and finding a deal meant
            dragging a scrollbar. They now shrink to 13rem before the board scrolls at
            all, which fits six stages on a laptop — and a workspace with more than that
            can fold the ones it is not working in (the button in each header). */}
          {/* ⚠️ Below md every column snaps to the left edge, so a swipe lands on a
            column instead of between two, and the 15% left over is the edge of the
            next one saying there is more. See `dragging` for why it lets go. */}
          <div
            className={cn(
              "scrollbar-slim flex min-h-0 w-full flex-1 gap-3 overflow-x-auto pb-3",
              !dragging && "max-md:snap-x max-md:snap-mandatory",
            )}
          >
            {initialStages.map((stage) => {
              const stageDeals = deals.filter((d) => d.stageId === stage.id);
              const totalAmount = stageDeals.reduce((acc, curr) => acc + Number(curr.amount || 0), 0);
              // What the column is worth on the odds each deal carries: the figure a forecast
              // is made of, and the one a column of big long shots used to hide.
              const weightedAmount = stageDeals
                .filter((d) => d.status === "open")
                .reduce((acc, d) => acc + (Number(d.amount || 0) * (d.probability ?? 0)) / 100, 0);

              // A folded stage keeps its place in the order and stays a drop target: the
              // point of folding one is to move a deal *past* it, not to hide it from the
              // drag that is already under way.
              if (folded.includes(stage.id)) {
                return (
                  <Droppable droppableId={stage.id} key={stage.id}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={cn(
                          "flex h-full w-11 shrink-0 flex-col items-center gap-2 rounded-xl border bg-muted/30 py-3 shadow-sm transition-colors max-md:snap-start",
                          snapshot.isDraggingOver && "border-primary/40 bg-primary/10",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => toggleFold(stage.id)}
                          title={t("unfoldStage")}
                          aria-label={t("unfoldStage")}
                          className="flex items-center justify-center rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground max-md:size-9"
                        >
                          <ChevronsLeftRight className="h-3.5 w-3.5" />
                        </button>
                        <Badge variant="secondary" className="h-5 rounded-full px-1.5 text-[10px]">
                          {stageDeals.length}
                        </Badge>
                        <span
                          className="min-h-0 flex-1 truncate font-bold text-xs uppercase tracking-tight [writing-mode:vertical-rl]"
                          style={{ color: stage.color || "inherit" }}
                        >
                          {stageLabel(stage)}
                        </span>
                        <span className="hidden">{provided.placeholder}</span>
                      </div>
                    )}
                  </Droppable>
                );
              }

              return (
                <div
                  key={stage.id}
                  className={cn(
                    "flex h-full min-w-[13rem] flex-1 basis-0 flex-col overflow-hidden rounded-xl border bg-muted/30 shadow-sm",
                    // ⚠️ On a phone the sharing stops: a column takes 85% of the screen and
                    // the edge of the next one is what says the board scrolls. `flex-none`
                    // is what makes the width count at all — under `flex-1` a width is
                    // ignored and `min-w` becomes the real one (see CLAUDE.md). Up to md,
                    // not sm: a portrait tablet with seven stages of 13rem was the same
                    // unreadable strip of columns, only wider.
                    "max-md:w-[85%] max-md:min-w-0 max-md:max-w-80 max-md:flex-none max-md:snap-start",
                  )}
                >
                  {/* ⚠️ Two lines of fixed height, neither of which may wrap. "· € 12.345,00
                    ponderato" wrapped onto a third line in most columns, so the headers
                    stood at different heights and the cards under them started at
                    different heights too. The weighted figure is now an icon and a
                    rounded amount, and its words are in the tooltip and for screen readers. */}
                  <div className="flex shrink-0 flex-col gap-1 border-b bg-background/50 px-3 py-2.5 backdrop-blur-sm">
                    <div className="flex h-6 items-center justify-between gap-1">
                      <h3
                        className="min-w-0 truncate font-bold text-sm uppercase tracking-tight"
                        style={{ color: stage.color || "inherit" }}
                        title={stageLabel(stage)}
                      >
                        {stageLabel(stage)}
                      </h3>
                      <div className="flex shrink-0 items-center gap-1">
                        <Badge variant="secondary" className="h-5 rounded-full text-[10px]">
                          {stageDeals.length}
                        </Badge>
                        <button
                          type="button"
                          onClick={() => toggleFold(stage.id)}
                          title={t("foldStage")}
                          aria-label={t("foldStage")}
                          className="hidden rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:block"
                        >
                          <ChevronsRightLeft className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="flex h-5 items-center justify-between gap-2 whitespace-nowrap text-muted-foreground text-xs tabular-nums">
                      {/* A bare number with no currency symbol: money that does not say
                        what it is. Amounts are stored in EUR. */}
                      <span className="flex min-w-0 items-center gap-1 font-semibold" title={formatAmount(totalAmount)}>
                        <CoinsIcon className="size-3.5 shrink-0" aria-hidden />
                        <span className="truncate">{formatAmount(totalAmount, { noDecimals: true })}</span>
                      </span>
                      {!stage.isWon && !stage.isLost && weightedAmount > 0 && (
                        <span
                          className="flex shrink-0 items-center gap-1"
                          title={`${t("weighted", { amount: formatAmount(weightedAmount) })} — ${t("weightedHelp")}`}
                        >
                          <Scale className="size-3.5 shrink-0" aria-hidden />
                          <span className="sr-only">{t("list.weighted")}: </span>
                          {formatAmount(weightedAmount, { noDecimals: true })}
                        </span>
                      )}
                    </div>
                  </div>

                  <Droppable droppableId={stage.id}>
                    {(provided, snapshot) => (
                      <div
                        {...provided.droppableProps}
                        ref={provided.innerRef}
                        className={`scrollbar-slim flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2 transition-colors ${
                          snapshot.isDraggingOver ? "bg-primary/5" : "bg-transparent"
                        }`}
                      >
                        {stageDeals.map((deal, index) => (
                          <Draggable key={deal.id} draggableId={deal.id} index={index}>
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                style={{ ...provided.draggableProps.style }}
                                className="group"
                              >
                                {/* ⚠️ Not the `Card` primitive: its 24px of vertical padding and
                                  24px gap are a panel's, and on a 13rem column they left the
                                  figures at 9px in a box that was mostly margin. One padding,
                                  one gap, and every line readable at 12px or more. */}
                                <div
                                  className={cn(
                                    "relative flex flex-col gap-2 rounded-lg border border-l-[3px] bg-card p-3 text-card-foreground shadow-xs transition-all",
                                    snapshot.isDragging
                                      ? "rotate-1 scale-[1.02] shadow-xl ring-2 ring-primary/20"
                                      : "hover:border-foreground/20 hover:shadow-md",
                                  )}
                                  style={{ borderLeftColor: stage.color || "#3b82f6" }}
                                >
                                  {/* Who: the deal, and the customer under it. */}
                                  <div className="flex items-start gap-1">
                                    <div className="min-w-0 flex-1">
                                      <Link
                                        href={`/dashboard/pipeline/${deal.id}`}
                                        className="line-clamp-2 break-words font-semibold text-sm leading-snug transition-colors hover:text-primary"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        {deal.name}
                                      </Link>
                                      {deal.companyName && (
                                        <p className="mt-0.5 flex min-w-0 items-center gap-1 text-muted-foreground text-xs">
                                          <Building2 className="size-3 shrink-0" aria-hidden />
                                          <span className="truncate">{deal.companyName}</span>
                                        </p>
                                      )}
                                    </div>
                                    <div className="-mt-1 -mr-1.5 flex shrink-0 items-center">
                                      {canEdit && (
                                        <DealModal
                                          deal={deal}
                                          stages={initialStages}
                                          companies={companies}
                                          contacts={contacts}
                                        >
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            className="size-7 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 max-md:size-9"
                                            title={t("editDealTitle")}
                                            aria-label={t("editDealTitle")}
                                          >
                                            <PencilIcon className="size-3.5" />
                                          </Button>
                                        </DealModal>
                                      )}
                                      {canEdit && deal.status === "open" && (
                                        // Always drawn: a phone has no hover to reveal it.
                                        <DropdownMenu>
                                          <DropdownMenuTrigger asChild>
                                            <Button
                                              variant="ghost"
                                              size="icon"
                                              className="size-7 text-muted-foreground max-md:size-9"
                                              aria-label={t("quickActions", { name: deal.name })}
                                              onClick={(e) => e.stopPropagation()}
                                            >
                                              <MoreHorizontal className="size-4" />
                                            </Button>
                                          </DropdownMenuTrigger>
                                          <DropdownMenuContent align="end">
                                            {/* A drag is a long press on a touchscreen; this is
                                              the same move, one tap and a list away. */}
                                            <DropdownMenuItem onSelect={() => setMoving(deal)}>
                                              <ArrowRightLeft className="size-4" aria-hidden />
                                              {t("list.move")}
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onSelect={() => setLogging(deal.id)}>
                                              <NotebookPen className="size-4" aria-hidden />
                                              {t("quick.log")}
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                              onSelect={() => setAskNextStep({ id: deal.id, name: deal.name })}
                                            >
                                              <CalendarPlus className="size-4" aria-hidden />
                                              {t("quick.plan")}
                                            </DropdownMenuItem>
                                            {(wonStage || lostStage) && <DropdownMenuSeparator />}
                                            {wonStage && (
                                              <DropdownMenuItem onSelect={() => void commitMove(deal.id, wonStage.id)}>
                                                <Trophy className="size-4" aria-hidden />
                                                {t("quick.won")}
                                              </DropdownMenuItem>
                                            )}
                                            {lostStage && (
                                              <DropdownMenuItem
                                                onSelect={() =>
                                                  setPendingLoss({
                                                    dealId: deal.id,
                                                    dealName: deal.name,
                                                    stageId: lostStage.id,
                                                  })
                                                }
                                              >
                                                <XCircle className="size-4" aria-hidden />
                                                {t("quick.lost")}
                                              </DropdownMenuItem>
                                            )}
                                          </DropdownMenuContent>
                                        </DropdownMenu>
                                      )}
                                    </div>
                                  </div>

                                  {/* How much, and on what odds: the figure the column adds up. */}
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="min-w-0 truncate font-semibold text-base tabular-nums tracking-tight">
                                      {/* What was typed, in its currency — `amount` is the EUR
                                        figure, and printing it with `deal.currency`
                                        put a dollar sign on a euro number. */}
                                      {(() => {
                                        const shown = dealAmountForDisplay(deal);
                                        return formatMoney(shown.value, shown.currency);
                                      })()}
                                    </span>
                                    {(deal.probability ?? 0) > 0 && (
                                      <span
                                        className="shrink-0 rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground text-xs tabular-nums"
                                        title={t("probability")}
                                      >
                                        <span className="sr-only">{t("probability")}: </span>
                                        {deal.probability}%
                                      </span>
                                    )}
                                  </div>

                                  {/* When, and whatever is wrong — in words, not only in colour. */}
                                  {(deal.expectedCloseDate || deal.status === "open") && (
                                    <div className="flex flex-col gap-1 border-t pt-2 text-muted-foreground text-xs">
                                      {(deal.expectedCloseDate || typeof deal.daysInStage === "number") && (
                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                          {deal.expectedCloseDate && (
                                            <span
                                              className={cn(
                                                "flex items-center gap-1",
                                                deal.status === "open" &&
                                                  new Date(deal.expectedCloseDate).getTime() < now &&
                                                  "font-medium text-red-600 dark:text-red-400",
                                              )}
                                              title={t("expectedClose")}
                                            >
                                              <CalendarIcon className="size-3.5 shrink-0" aria-hidden />
                                              <span className="sr-only">{t("expectedClose")}: </span>
                                              {format.dateTime(new Date(deal.expectedCloseDate), {
                                                month: "short",
                                                day: "numeric",
                                              })}
                                            </span>
                                          )}
                                          {deal.status === "open" && typeof deal.daysInStage === "number" && (
                                            // Past the stage's threshold: stuck, and said so.
                                            <span
                                              className={cn(
                                                "flex items-center gap-1",
                                                deal.stale && "font-medium text-amber-700 dark:text-amber-400",
                                              )}
                                            >
                                              <TimerIcon className="size-3.5 shrink-0" aria-hidden />
                                              {deal.stale
                                                ? t("stuckInStage", { days: deal.daysInStage })
                                                : t("daysInStage", { days: deal.daysInStage })}
                                            </span>
                                          )}
                                        </div>
                                      )}
                                      {deal.status === "open" &&
                                        (deal.signals.hasNextStep ? (
                                          <span className="flex items-center gap-1">
                                            <CalendarCheck className="size-3.5 shrink-0" aria-hidden />
                                            {deal.signals.nextStepAt
                                              ? t("nextStepOn", {
                                                  date: format.dateTime(new Date(deal.signals.nextStepAt), {
                                                    month: "short",
                                                    day: "numeric",
                                                  }),
                                                })
                                              : t("nextStepUndated")}
                                          </span>
                                        ) : (
                                          // ⚠️ In words and in red: an open deal with nothing planned is
                                          // the one that quietly dies (§6.3).
                                          <span className="flex items-center gap-1 font-medium text-red-600 dark:text-red-400">
                                            <CalendarX2 className="size-3.5 shrink-0" aria-hidden />
                                            {t("signals.noNextStep")}
                                          </span>
                                        ))}
                                      {deal.status === "open" && deal.signals.stalled && (
                                        <span className="flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400">
                                          <HourglassIcon className="size-3.5 shrink-0" aria-hidden />
                                          {t("signals.idle", { days: deal.signals.idleDays })}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </div>
              );
            })}
          </div>
        </DragDropContext>
      )}
    </div>
  );
}
