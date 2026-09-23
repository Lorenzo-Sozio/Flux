"use client";

import { useEffect, useState } from "react";

import Link from "next/link";

import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import {
  CalendarIcon,
  ChevronsLeftRight,
  ChevronsRightLeft,
  CoinsIcon,
  PencilIcon,
  PlusIcon,
  Settings2,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { getLossReasons, updateDealStage } from "@/actions/pipeline";
import { DealModal } from "@/components/crm/deal-modal";
import { type LossAnswer, type LossReason, LostDealDialog } from "@/components/crm/lost-deal-dialog";
import { useWorkspaceScope } from "@/components/crm/workspace-scope";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCurrency } from "@/hooks/use-currency";
import { cn } from "@/lib/utils";

type Deal = {
  id: string;
  name: string;
  amount: string | null;
  currency: string;
  probability: number | null;
  expectedCloseDate: Date | null;
  healthScore: number | null;
  stageId: string | null;
  companyId: string | null;
  contactId: string | null;
  ownerId: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

type Stage = {
  id: string;
  name: string;
  order: number;
  color: string | null;
  // Which columns end the deal. The board needs to know, because dropping a card
  // into the losing one is the moment to ask why (audit rilievo S-09).
  isWon?: boolean;
  isLost?: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/** Where the folded stages are remembered, per workspace. */
const FOLDED_KEY = "flux.pipeline.folded:";

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
  companies: { id: string; name: string }[];
  contacts: { id: string; firstName: string | null; lastName: string | null }[];
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
  const [lossReasons, setLossReasons] = useState<LossReason[]>([]);

  useEffect(() => {
    setIsMounted(true);
  }, []);

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

  const onDragEnd = async (result: DropResult) => {
    const { source, destination, draggableId } = result;

    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    const deal = deals.find((d) => d.id === draggableId);
    if (!deal) return;

    // Dropping into the losing column is the one moment the reason is still
    // known. Ask now; asked at the sales meeting a week later, nobody remembers.
    const target = initialStages.find((st) => st.id === destination.droppableId);
    if (target?.isLost) {
      setPendingLoss({ dealId: deal.id, dealName: deal.name, stageId: destination.droppableId });
      return;
    }

    await commitMove(deal.id, destination.droppableId);
  };

  if (!isMounted) return null;

  return (
    // Fills the height the section gives it (see the section layout) rather than
    // subtracting a measured constant from the viewport, which was wrong the moment
    // the filters wrapped onto a second line. The floor is there for the short
    // window a phone in landscape leaves: a board of 200px is not a board.
    <div className="flex h-full min-h-[26rem] w-full flex-col overflow-hidden">
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
      <div className="mb-4 flex shrink-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-semibold text-lg tracking-tight">{t("title")}</h2>
          <p className="truncate text-muted-foreground text-sm">{t("boardSubtitle")}</p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
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
      <DragDropContext onDragEnd={onDragEnd}>
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
        <div className="scrollbar-slim flex min-h-0 w-full flex-1 gap-3 overflow-x-auto pb-3">
          {initialStages.map((stage) => {
            const stageDeals = deals.filter((d) => d.stageId === stage.id);
            const totalAmount = stageDeals.reduce((acc, curr) => acc + Number(curr.amount || 0), 0);

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
                        "flex h-full w-11 shrink-0 flex-col items-center gap-2 rounded-xl border bg-muted/30 py-3 shadow-sm transition-colors",
                        snapshot.isDraggingOver && "border-primary/40 bg-primary/10",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => toggleFold(stage.id)}
                        title={t("unfoldStage")}
                        aria-label={t("unfoldStage")}
                        className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
                        {stage.name}
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
                  // the edge of the next one is what says the board scrolls.
                  "max-sm:w-[85%] max-sm:min-w-0 max-sm:flex-none",
                )}
              >
                <div className="flex shrink-0 flex-col gap-1 border-b bg-background/50 p-4 backdrop-blur-sm">
                  <div className="flex items-center justify-between gap-1">
                    <h3
                      className="min-w-0 truncate font-bold text-sm uppercase tracking-tight"
                      style={{ color: stage.color || "inherit" }}
                    >
                      {stage.name}
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
                  <p className="flex items-center gap-1 font-semibold text-muted-foreground text-xs">
                    <CoinsIcon className="h-3 w-3" />
                    {/* A bare number with no currency symbol: money that does not say
                        what it is. Amounts are stored in EUR. */}
                    {formatAmount(totalAmount)}
                  </p>
                </div>

                <Droppable droppableId={stage.id}>
                  {(provided, snapshot) => (
                    <div
                      {...provided.droppableProps}
                      ref={provided.innerRef}
                      className={`scrollbar-slim flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 transition-colors ${
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
                              <Card
                                className={`relative border-l-4 transition-all ${
                                  snapshot.isDragging
                                    ? "rotate-1 scale-[1.02] shadow-xl ring-2 ring-primary/20"
                                    : "hover:shadow-md"
                                }`}
                                style={{ borderLeftColor: stage.color || "#3b82f6" }}
                              >
                                <CardHeader className="p-3 pb-1">
                                  <div className="flex items-start justify-between gap-2">
                                    <CardTitle className="font-bold text-sm leading-tight">
                                      <Link
                                        href={`/dashboard/pipeline/${deal.id}`}
                                        className="transition-colors hover:text-primary"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        {deal.name}
                                      </Link>
                                    </CardTitle>
                                    <div className="flex shrink-0 items-center gap-1">
                                      {/* Health score dot */}
                                      {deal.status === "open" && (
                                        <span
                                          title={t("healthScore", { score: deal.healthScore ?? 0 })}
                                          className={`h-2 w-2 shrink-0 rounded-full ${
                                            (deal.healthScore ?? 0) >= 70
                                              ? "bg-green-500"
                                              : (deal.healthScore ?? 0) >= 40
                                                ? "bg-amber-400"
                                                : "bg-red-500"
                                          }`}
                                        />
                                      )}
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
                                            className="h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
                                            title={t("editDealTitle")}
                                          >
                                            <PencilIcon className="h-3 w-3" />
                                          </Button>
                                        </DealModal>
                                      )}
                                    </div>
                                  </div>
                                </CardHeader>
                                <CardContent className="flex flex-col gap-1.5 p-3 pt-0">
                                  <div className="mt-1 flex items-center justify-between">
                                    <p className="font-bold text-[11px] text-foreground/80">
                                      {formatMoney(deal.amount ?? 0, deal.currency)}
                                    </p>
                                    {(deal.probability ?? 0) > 0 && (
                                      <span className="font-medium text-[9px] text-muted-foreground">
                                        {deal.probability}%
                                      </span>
                                    )}
                                  </div>
                                  {deal.expectedCloseDate && (
                                    <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
                                      <CalendarIcon className="h-2.5 w-2.5" />
                                      <span
                                        className={
                                          new Date(deal.expectedCloseDate) < new Date()
                                            ? "font-medium text-red-500"
                                            : ""
                                        }
                                      >
                                        {format.dateTime(new Date(deal.expectedCloseDate), {
                                          month: "short",
                                          day: "numeric",
                                        })}
                                      </span>
                                    </div>
                                  )}
                                </CardContent>
                              </Card>
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
    </div>
  );
}
