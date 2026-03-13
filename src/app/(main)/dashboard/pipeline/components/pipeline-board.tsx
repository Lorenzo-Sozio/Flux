"use client";

import { useState, useEffect } from "react";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { updateDealStage } from "@/actions/pipeline";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Deal = {
  id: string;
  name: string;
  amount: string | null;
  currency: string;
  expectedCloseDate: Date | null;
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
}: {
  initialStages: Stage[];
  initialDeals: Deal[];
}) {
  const [isMounted, setIsMounted] = useState(false);
  const [stages, setStages] = useState(initialStages);
  const [deals, setDeals] = useState(initialDeals);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    setStages(initialStages);
    setDeals(initialDeals);
  }, [initialStages, initialDeals]);

  const onDragEnd = async (result: DropResult) => {
    const { source, destination, draggableId } = result;

    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    const newDeals = [...deals];
    const dealIndex = newDeals.findIndex((d) => d.id === draggableId);
    if (dealIndex < 0) return;

    const deal = newDeals[dealIndex];
    deal.stageId = destination.droppableId;
    setDeals(newDeals);

    try {
      await updateDealStage(deal.id, destination.droppableId);
    } catch (e) {
      console.error(e);
      setDeals(initialDeals); // Revert on failure
    }
  };

  if (!isMounted) return null;

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex gap-4 overflow-x-auto pb-4 h-[calc(100vh-10rem)]">
        {stages.map((stage) => {
          const stageDeals = deals.filter((d) => d.stageId === stage.id);
          return (
            <div key={stage.id} className="min-w-[300px] flex flex-col gap-2 bg-muted/30 p-4 rounded-lg">
              <div className="font-semibold text-lg pb-2 border-b flex items-center justify-between mb-2">
                <span style={{ color: stage.color || "inherit" }}>{stage.name}</span>
                <Badge variant="secondary">{stageDeals.length}</Badge>
              </div>
              <Droppable droppableId={stage.id}>
                {(provided, snapshot) => (
                  <div
                    {...provided.droppableProps}
                    ref={provided.innerRef}
                    className={`flex-1 flex flex-col gap-3 min-h-[150px] transition-colors ${
                      snapshot.isDraggingOver ? "bg-muted/50" : "bg-transparent"
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
                          >
                            <Card className={snapshot.isDragging ? "shadow-lg scale-105" : ""}>
                              <CardHeader className="p-4 pb-2">
                                <CardTitle className="text-md font-medium">{deal.name}</CardTitle>
                              </CardHeader>
                              <CardContent className="p-4 pt-0 text-sm text-muted-foreground">
                                {deal.amount ? `${deal.currency} ${deal.amount}` : "No value"}
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
  );
}
