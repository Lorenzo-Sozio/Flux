"use client";

import { useEffect, useState } from "react";

import Link from "next/link";

import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import { BarChart2, CalendarIcon, CoinsIcon, PencilIcon, PlusIcon, Settings2, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";

import { updateDealStage } from "@/actions/pipeline";
import { DealModal } from "@/components/crm/deal-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
  companies: any[];
  contacts: any[];
  canEdit?: boolean;
  canManageStages?: boolean;
}) {
  const t = useTranslations("pipeline");
  const [isMounted, setIsMounted] = useState(false);
  const [deals, setDeals] = useState(initialDeals);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    setDeals(initialDeals);
  }, [initialDeals]);

  const onDragEnd = async (result: DropResult) => {
    const { source, destination, draggableId } = result;

    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    const newDeals = [...deals];
    const dealIndex = newDeals.findIndex((d) => d.id === draggableId);
    if (dealIndex < 0) return;

    const deal = { ...newDeals[dealIndex] };
    deal.stageId = destination.droppableId;

    newDeals.splice(dealIndex, 1); // remove from old position
    // We don't have true sorting logic for deals yet, just simple filtering
    // So we just update the stageId
    setDeals(deals.map((d) => (d.id === draggableId ? deal : d)));

    try {
      await updateDealStage(deal.id, destination.droppableId);
    } catch (e) {
      console.error(e);
      setDeals(initialDeals); // Revert on failure
    }
  };

  if (!isMounted) return null;

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] w-full overflow-hidden">
      <div className="flex items-center justify-between mb-6 shrink-0 px-1">
        <div>
          <h2 className="text-xl font-bold">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">{t("boardSubtitle")}</p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard/pipeline/forecast">
              <TrendingUp className="mr-2 h-4 w-4" /> Forecast
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
          {canEdit && (
            <DealModal stages={initialStages} companies={companies} contacts={contacts}>
              <Button size="sm" className="gap-2">
                <PlusIcon className="w-4 h-4" /> {t("newDeal")}
              </Button>
            </DealModal>
          )}
        </div>
      </div>
      <DragDropContext onDragEnd={onDragEnd}>
        <div className="flex-1 flex gap-4 w-full pb-4">
          {initialStages.map((stage) => {
            const stageDeals = deals.filter((d) => d.stageId === stage.id);
            const totalAmount = stageDeals.reduce((acc, curr) => acc + Number(curr.amount || 0), 0);

            return (
              <div
                key={stage.id}
                className="flex-1 min-w-0 flex flex-col bg-muted/30 rounded-xl border h-full overflow-hidden shadow-sm"
              >
                <div className="p-4 border-b bg-background/50 backdrop-blur-sm flex flex-col gap-1 shrink-0">
                  <div className="flex items-center justify-between">
                    <h3
                      className="font-bold text-sm tracking-tight truncate uppercase"
                      style={{ color: stage.color || "inherit" }}
                    >
                      {stage.name}
                    </h3>
                    <Badge variant="secondary" className="rounded-full h-5 text-[10px]">
                      {stageDeals.length}
                    </Badge>
                  </div>
                  <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                    <CoinsIcon className="w-3 h-3" />
                    {totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </p>
                </div>

                <Droppable droppableId={stage.id}>
                  {(provided, snapshot) => (
                    <div
                      {...provided.droppableProps}
                      ref={provided.innerRef}
                      className={`flex-1 overflow-y-auto p-3 flex flex-col gap-3 transition-colors ${
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
                                className={`relative transition-all border-l-4 ${
                                  snapshot.isDragging
                                    ? "shadow-xl ring-2 ring-primary/20 rotate-1 scale-[1.02]"
                                    : "hover:shadow-md"
                                }`}
                                style={{ borderLeftColor: stage.color || "#3b82f6" }}
                              >
                                <CardHeader className="p-3 pb-1">
                                  <div className="flex justify-between items-start gap-2">
                                    <CardTitle className="text-sm font-bold leading-tight">
                                      <Link
                                        href={`/dashboard/pipeline/${deal.id}`}
                                        className="hover:text-primary transition-colors"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        {deal.name}
                                      </Link>
                                    </CardTitle>
                                    <div className="flex items-center gap-1 shrink-0">
                                      {/* Health score dot */}
                                      {deal.status === "open" && (
                                        <span
                                          title={`Health: ${deal.healthScore ?? 0}/100`}
                                          className={`h-2 w-2 rounded-full shrink-0 ${
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
                                            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                                            title={t("editDealTitle")}
                                          >
                                            <PencilIcon className="h-3 w-3" />
                                          </Button>
                                        </DealModal>
                                      )}
                                    </div>
                                  </div>
                                </CardHeader>
                                <CardContent className="p-3 pt-0 flex flex-col gap-1.5">
                                  <div className="flex items-center justify-between mt-1">
                                    <p className="text-[11px] font-bold text-foreground/80">
                                      {deal.currency} {Number(deal.amount || 0).toLocaleString()}
                                    </p>
                                    {(deal.probability ?? 0) > 0 && (
                                      <span className="text-[9px] font-medium text-muted-foreground">
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
                                            ? "text-red-500 font-medium"
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
