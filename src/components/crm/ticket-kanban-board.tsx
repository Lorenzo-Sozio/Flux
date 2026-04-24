"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";
import { updateTicketStatusAction } from "@/actions/support";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TicketPriorityBadge } from "@/components/crm/ticket-priority-badge";
import { CreateTicketButton } from "@/components/crm/create-ticket-button";
import {
  Mail,
  MessageCircle,
  Phone,
  Users,
  MessageSquare,
  AlertCircle,
} from "lucide-react";

type Ticket = {
  id: string;
  ticketNumber: string;
  subject: string;
  status: string;
  priority: string;
  channel: string;
  createdAt: Date;
  contact?: { name?: string | null; email?: string | null } | null;
  assignee?: { name?: string | null } | null;
  messages?: unknown[];
};

const COLUMN_CONFIG = [
  { id: "open",        color: "bg-blue-50 dark:bg-blue-950/30",     textColor: "text-blue-700 dark:text-blue-300",    borderColor: "#3b82f6" },
  { id: "in_progress", color: "bg-amber-50 dark:bg-amber-950/30",   textColor: "text-amber-700 dark:text-amber-300",  borderColor: "#f59e0b" },
  { id: "waiting",     color: "bg-orange-50 dark:bg-orange-950/30", textColor: "text-orange-700 dark:text-orange-300", borderColor: "#f97316" },
  { id: "resolved",    color: "bg-green-50 dark:bg-green-950/30",   textColor: "text-green-700 dark:text-green-300",  borderColor: "#22c55e" },
  { id: "closed",      color: "bg-gray-50 dark:bg-gray-900/30",     textColor: "text-gray-600 dark:text-gray-400",    borderColor: "#6b7280" },
] as const;

const PRIORITY_BORDER: Record<string, string> = {
  urgent: "#ef4444",
  high:   "#f97316",
  normal: "#3b82f6",
  low:    "#9ca3af",
};

const CHANNEL_ICONS: Record<string, React.ReactNode> = {
  email:  <Mail className="h-3 w-3" />,
  chat:   <MessageCircle className="h-3 w-3" />,
  phone:  <Phone className="h-3 w-3" />,
  social: <Users className="h-3 w-3" />,
};

function TicketKanbanCard({
  ticket,
  isDragging,
}: {
  ticket: Ticket;
  isDragging: boolean;
}) {
  const priorityBorder = PRIORITY_BORDER[ticket.priority] ?? PRIORITY_BORDER.normal;
  const msgCount = ticket.messages?.length ?? 0;
  const initials = ticket.assignee?.name
    ? ticket.assignee.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : null;

  return (
    <div
      className={`bg-background rounded-lg border border-l-4 p-3 flex flex-col gap-2 transition-all ${
        isDragging ? "shadow-xl ring-2 ring-primary/20 rotate-1 scale-[1.02]" : "hover:shadow-md"
      }`}
      style={{ borderLeftColor: priorityBorder }}
    >
      {/* Header: ticket number + priority */}
      <div className="flex items-center justify-between gap-1">
        <span className="font-mono text-[10px] font-semibold text-muted-foreground truncate">
          {ticket.ticketNumber}
        </span>
        <TicketPriorityBadge priority={ticket.priority} showIcon={false} className="text-[10px] h-4 px-1.5 py-0" />
      </div>

      {/* Subject */}
      <Link
        href={`/dashboard/support/tickets/${ticket.id}`}
        className="text-sm font-semibold leading-snug line-clamp-2 hover:text-primary transition-colors"
        onClick={(e) => e.stopPropagation()}
      >
        {ticket.subject}
      </Link>

      {/* Customer */}
      {ticket.contact?.name && (
        <p className="text-xs text-muted-foreground truncate">
          {ticket.contact.name}
        </p>
      )}

      {/* Footer: channel + messages + assignee */}
      <div className="flex items-center justify-between mt-1">
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className="flex items-center gap-1 text-xs">
            {CHANNEL_ICONS[ticket.channel] ?? <AlertCircle className="h-3 w-3" />}
          </span>
          {msgCount > 0 && (
            <span className="flex items-center gap-0.5 text-[11px]">
              <MessageSquare className="h-3 w-3" />
              {msgCount}
            </span>
          )}
        </div>
        {initials && (
          <div
            className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[9px] font-bold flex-shrink-0"
            title={ticket.assignee?.name ?? ""}
          >
            {initials}
          </div>
        )}
      </div>
    </div>
  );
}

export function TicketKanbanBoard({
  initialTickets,
  canEdit = true,
}: {
  initialTickets: Ticket[];
  canEdit?: boolean;
}) {
  const t = useTranslations("support.tickets");
  const COLUMNS = COLUMN_CONFIG.map((col) => ({
    ...col,
    label: t(`statuses.${col.id}`),
  }));
  const [isMounted, setIsMounted] = useState(false);
  const [tickets, setTickets] = useState(initialTickets);

  useEffect(() => { setIsMounted(true); }, []);
  useEffect(() => { setTickets(initialTickets); }, [initialTickets]);

  const onDragEnd = async (result: DropResult) => {
    const { source, destination, draggableId } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId) return;

    const newStatus = destination.droppableId;

    // Optimistic update
    setTickets((prev) =>
      prev.map((t) => (t.id === draggableId ? { ...t, status: newStatus } : t))
    );

    try {
      await updateTicketStatusAction(draggableId, newStatus);
    } catch {
      setTickets(initialTickets); // revert on failure
    }
  };

  if (!isMounted) return null;

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="h-full flex gap-3 overflow-x-auto pb-4">
          {COLUMNS.map((col) => {
            const colTickets = tickets.filter((t) => t.status === col.id);

            return (
              <div
                key={col.id}
                className={`flex-1 min-w-[240px] flex flex-col rounded-xl border ${col.color} overflow-hidden shadow-sm`}
              >
                {/* Column header */}
                <div className="px-3 py-2.5 border-b bg-background/60 backdrop-blur-sm flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: col.borderColor }}
                    />
                    <h3 className={`text-xs font-bold uppercase tracking-wide ${col.textColor}`}>
                      {col.label}
                    </h3>
                  </div>
                  <Badge variant="secondary" className="rounded-full h-5 text-[10px] px-2">
                    {colTickets.length}
                  </Badge>
                </div>

                {/* Droppable area */}
                <Droppable droppableId={col.id}>
                  {(provided, snapshot) => (
                    <div
                      {...provided.droppableProps}
                      ref={provided.innerRef}
                      className={`flex-1 overflow-y-auto p-2 flex flex-col gap-2 transition-colors min-h-[80px] ${
                        snapshot.isDraggingOver ? "bg-primary/5" : "bg-transparent"
                      }`}
                    >
                      {colTickets.map((ticket, index) => (
                        <Draggable
                          key={ticket.id}
                          draggableId={ticket.id}
                          index={index}
                          isDragDisabled={!canEdit}
                        >
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              style={{ ...provided.draggableProps.style }}
                            >
                              <TicketKanbanCard
                                ticket={ticket}
                                isDragging={snapshot.isDragging}
                              />
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}

                      {colTickets.length === 0 && !snapshot.isDraggingOver && (
                        <div className="flex-1 flex items-center justify-center py-6">
                          <p className="text-xs text-muted-foreground italic">{t("emptyColumn")}</p>
                        </div>
                      )}
                    </div>
                  )}
                </Droppable>

                {/* Add ticket button (Open column only) */}
                {col.id === "open" && canEdit && (
                  <div className="p-2 border-t bg-background/40 shrink-0">
                    <CreateTicketButton variant="ghost" />
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </DragDropContext>
  );
}
