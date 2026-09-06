"use client";

import { useEffect, useState } from "react";

import Link from "next/link";

import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import {
  BarChart2,
  CalendarIcon,
  CoinsIcon,
  MoreHorizontal,
  PencilIcon,
  PlusIcon,
  Settings2,
  TrendingUp,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { getLossReasons, updateDealStage } from "@/actions/pipeline";
import { DealModal } from "@/components/crm/deal-modal";
import { type LossAnswer, type LossReason, LostDealDialog } from "@/components/crm/lost-deal-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
  const [isMounted, setIsMounted] = useState(false);
  const [deals, setDeals] = useState(initialDeals);
  const [pendingLoss, setPendingLoss] = useState<{ dealId: string; dealName: string; stageId: string } | null>(null);
  const [lossReasons, setLossReasons] = useState<LossReason[]>([]);

  useEffect(() => {
    setIsMounted(true);
  }, []);

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
    <div className="flex h-[calc(100dvh-120px)] w-full flex-col overflow-hidden">
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

      <div className="mb-6 flex shrink-0 items-center justify-between gap-3 px-1">
        <div className="min-w-0">
          <h2 className="truncate font-bold text-xl">{t("title")}</h2>
          <p className="text-muted-foreground text-sm">{t("boardSubtitle")}</p>
        </div>

        {/*
          Four buttons and a title in one row is 520px of controls on a screen
          that has 343. Below md the three ways of *looking* at the pipeline
          collapse into one menu and only "New deal" — the thing anyone actually
          comes here to do — keeps its button.
        */}
        <div className="flex shrink-0 items-center gap-2">
          <div className="hidden items-center gap-2 md:flex">
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard/pipeline/forecast">
                <TrendingUp className="mr-2 h-4 w-4" /> {t("forecast.title")}
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard/pipeline/report">
                <BarChart2 className="mr-2 h-4 w-4" /> {t("report")}
              </Link>
            </Button>
            {canManageStages && (
              <Button variant="outline" size="sm" asChild>
                <Link href="/dashboard/settings/pipeline">
                  <Settings2 className="mr-2 h-4 w-4" /> {t("manageStages")}
                </Link>
              </Button>
            )}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild className="md:hidden">
              <Button variant="outline" size="icon" aria-label={t("report")}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem asChild>
                <Link href="/dashboard/pipeline/forecast">
                  <TrendingUp className="mr-2 h-4 w-4" /> {t("forecast.title")}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/dashboard/pipeline/report">
                  <BarChart2 className="mr-2 h-4 w-4" /> {t("report")}
                </Link>
              </DropdownMenuItem>
              {canManageStages && (
                <DropdownMenuItem asChild>
                  <Link href="/dashboard/settings/pipeline">
                    <Settings2 className="mr-2 h-4 w-4" /> {t("manageStages")}
                  </Link>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

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
        <div className="flex w-full flex-1 gap-4 overflow-x-auto pb-4">
          {initialStages.map((stage) => {
            const stageDeals = deals.filter((d) => d.stageId === stage.id);
            const totalAmount = stageDeals.reduce((acc, curr) => acc + Number(curr.amount || 0), 0);

            return (
              <div
                key={stage.id}
                className="flex h-full min-w-[280px] flex-1 shrink-0 flex-col overflow-hidden rounded-xl border bg-muted/30 shadow-sm"
              >
                <div className="flex shrink-0 flex-col gap-1 border-b bg-background/50 p-4 backdrop-blur-sm">
                  <div className="flex items-center justify-between">
                    <h3
                      className="truncate font-bold text-sm uppercase tracking-tight"
                      style={{ color: stage.color || "inherit" }}
                    >
                      {stage.name}
                    </h3>
                    <Badge variant="secondary" className="h-5 rounded-full text-[10px]">
                      {stageDeals.length}
                    </Badge>
                  </div>
                  <p className="flex items-center gap-1 font-semibold text-muted-foreground text-xs">
                    <CoinsIcon className="h-3 w-3" />
                    {/* A bare number with no currency symbol: money that does not say
                        what it is. Amounts are stored in EUR. */}
                    {totalAmount.toLocaleString(undefined, {
                      style: "currency",
                      currency: "EUR",
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </p>
                </div>

                <Droppable droppableId={stage.id}>
                  {(provided, snapshot) => (
                    <div
                      {...provided.droppableProps}
                      ref={provided.innerRef}
                      className={`flex flex-1 flex-col gap-3 overflow-y-auto p-3 transition-colors ${
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
                                          title={`Health: ${deal.healthScore ?? 0}/100`}
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
                                      {deal.currency} {Number(deal.amount || 0).toLocaleString()}
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
                                        {new Date(deal.expectedCloseDate).toLocaleDateString(undefined, {
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
