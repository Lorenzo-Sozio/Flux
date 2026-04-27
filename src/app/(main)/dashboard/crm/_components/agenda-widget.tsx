"use client";

import { useState, useTransition } from "react";

import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  CheckSquare,
  Clock,
  PhoneCall,
  Square,
  Users,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { updateTaskStatus } from "@/actions/tasks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgendaItem = {
  id: string;
  kind: "task" | "meeting" | "call";
  title: string;
  timeISO: string | null;      // serialized Date for sorting/display
  priority: string;
  status: string;
  entityName: string | null;   // lead / contact / company name for context
  entityHref: string | null;   // link to entity detail
  taskHref: string | null;     // direct link (ticket or tasks page)
  durationMinutes: number | null;
  estimatedHours: string | null;
  isOverdue: boolean;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const KIND_STYLE = {
  task:    { border: "border-l-blue-400",   dot: "bg-blue-500",    label: "Attività" },
  meeting: { border: "border-l-violet-400", dot: "bg-violet-500",  label: "Riunione" },
  call:    { border: "border-l-emerald-400", dot: "bg-emerald-500", label: "Chiamata" },
} satisfies Record<AgendaItem["kind"], { border: string; dot: string; label: string }>;

const PRIORITY_COLOR: Record<string, string> = {
  urgent: "text-red-600 dark:text-red-400",
  high:   "text-orange-500",
  normal: "text-blue-500",
  low:    "text-slate-400",
};

function fmtTime(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

function fmtOverdueLabel(iso: string | null): string {
  if (!iso) return "Scaduta";
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "Scaduta oggi";
  if (days === 1) return "Ieri";
  return `${days}g fa`;
}

function fmtDuration(mins: number | null): string | null {
  if (!mins) return null;
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// ─── Row ──────────────────────────────────────────────────────────────────────

function AgendaRow({
  item,
  isDone,
  onDone,
}: {
  item: AgendaItem;
  isDone: boolean;
  onDone: (id: string) => void;
}) {
  const style = KIND_STYLE[item.kind];
  const isTask = item.kind === "task";
  const time = item.isOverdue ? fmtOverdueLabel(item.timeISO) : fmtTime(item.timeISO);
  const duration = fmtDuration(item.durationMinutes);

  return (
    <div
      className={`group flex items-start gap-3 rounded-lg border-l-[3px] px-3 py-2.5 transition-colors hover:bg-muted/50
        ${style.border}
        ${item.isOverdue ? "bg-red-50/40 dark:bg-red-950/10" : ""}
        ${isDone ? "opacity-40" : ""}
      `}
    >
      {/* Checkbox (tasks only) */}
      <div className="mt-0.5 shrink-0">
        {isTask ? (
          <button
            type="button"
            onClick={() => !isDone && onDone(item.id)}
            className="text-muted-foreground transition-colors hover:text-emerald-500"
            title="Segna come completata"
          >
            {isDone
              ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              : <Square className="h-4 w-4" />}
          </button>
        ) : (
          <span className={`mt-1 block h-2 w-2 rounded-full ${style.dot}`} />
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className={`text-sm font-medium leading-snug ${isDone ? "line-through text-muted-foreground" : ""} ${item.isOverdue && !isDone ? "text-red-700 dark:text-red-400" : ""}`}>
            {item.title}
          </span>
          {item.entityName && (
            item.entityHref
              ? <Link href={item.entityHref} className="text-xs text-muted-foreground hover:text-primary truncate max-w-[160px]">— {item.entityName}</Link>
              : <span className="text-xs text-muted-foreground truncate max-w-[160px]">— {item.entityName}</span>
          )}
        </div>

        {/* Meta row */}
        <div className="mt-0.5 flex items-center gap-2 flex-wrap">
          {item.isOverdue && !isDone && (
            <span className="flex items-center gap-0.5 text-xs font-medium text-red-500">
              <AlertTriangle className="h-3 w-3" />{time}
            </span>
          )}
          {!item.isOverdue && time && (
            <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />{time}
            </span>
          )}
          {duration && (
            <span className="text-xs text-muted-foreground">{duration}</span>
          )}
          {item.estimatedHours && (
            <span className="text-xs text-muted-foreground">{item.estimatedHours}h stimate</span>
          )}
          {item.priority && item.priority !== "normal" && isTask && (
            <span className={`text-xs font-medium capitalize ${PRIORITY_COLOR[item.priority] ?? ""}`}>
              {item.priority === "urgent" ? "Urgente" : item.priority === "high" ? "Alta" : item.priority}
            </span>
          )}
          {item.status === "in_progress" && (
            <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">In corso</Badge>
          )}
        </div>
      </div>

      {/* Link arrow */}
      {item.taskHref && (
        <Link
          href={item.taskHref}
          className="shrink-0 mt-1 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Apri dettaglio"
        >
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
        </Link>
      )}
    </div>
  );
}

// ─── Section ──────────────────────────────────────────────────────────────────

function Section({
  label,
  icon: Icon,
  iconClass,
  labelClass,
  items,
  doneIds,
  onDone,
}: {
  label: string;
  icon: React.ElementType;
  iconClass: string;
  labelClass: string;
  items: AgendaItem[];
  doneIds: Set<string>;
  onDone: (id: string) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 px-1 py-1">
        <Icon className={`h-3 w-3 ${iconClass}`} />
        <span className={`text-[11px] font-semibold uppercase tracking-wider ${labelClass}`}>{label}</span>
        <span className="text-[11px] text-muted-foreground/60">({items.length})</span>
      </div>
      {items.map((item) => (
        <AgendaRow key={item.id} item={item} isDone={doneIds.has(item.id)} onDone={onDone} />
      ))}
    </div>
  );
}

// ─── Widget ───────────────────────────────────────────────────────────────────

export function AgendaWidget({ items, dateLabel }: { items: AgendaItem[]; dateLabel: string }) {
  const [doneIds, setDoneIds]   = useState<Set<string>>(new Set());
  const [, startTransition]     = useTransition();

  const handleDone = (id: string) => {
    setDoneIds((prev) => new Set([...prev, id]));
    startTransition(async () => {
      try {
        await updateTaskStatus(id, "done", "/dashboard/crm");
      } catch {
        setDoneIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
        toast.error("Errore nell'aggiornamento");
      }
    });
  };

  const overdue  = items.filter((i) => i.isOverdue);
  const todayItems = items
    .filter((i) => !i.isOverdue)
    .sort((a, b) => {
      // meetings/calls with a time go first (sorted by time); tasks without time go last
      if (a.timeISO && b.timeISO) return a.timeISO.localeCompare(b.timeISO);
      if (a.timeISO && a.kind !== "task") return -1;
      if (b.timeISO && b.kind !== "task") return 1;
      return 0;
    });

  const visibleCount = overdue.filter((i) => !doneIds.has(i.id)).length
    + todayItems.filter((i) => !doneIds.has(i.id)).length;

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <CalendarDays className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-base leading-none">Agenda di oggi</CardTitle>
              <p className="text-xs text-muted-foreground mt-1 capitalize">{dateLabel}</p>
            </div>
            {visibleCount > 0 && (
              <span className="rounded-full bg-primary/10 text-primary px-2 py-0.5 text-xs font-semibold">
                {visibleCount}
              </span>
            )}
          </div>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" asChild>
            <Link href="/dashboard/calendar">
              <CalendarDays className="h-3.5 w-3.5" /> Calendario
            </Link>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-4">
        {items.length === 0 ? (
          <div className="flex flex-col items-center py-10 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-400/50 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">Nessun impegno per oggi</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Hai la giornata libera!</p>
            <Button variant="outline" size="sm" className="mt-4 h-8 gap-1.5" asChild>
              <Link href="/dashboard/tasks">
                <CheckSquare className="h-3.5 w-3.5" /> Vedi tutte le attività
              </Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {overdue.length > 0 && (
              <Section
                label="In ritardo"
                icon={AlertTriangle}
                iconClass="text-red-500"
                labelClass="text-red-600 dark:text-red-400"
                items={overdue}
                doneIds={doneIds}
                onDone={handleDone}
              />
            )}
            {todayItems.length > 0 && (
              <Section
                label="Oggi"
                icon={Clock}
                iconClass="text-blue-500"
                labelClass="text-blue-600 dark:text-blue-400"
                items={todayItems}
                doneIds={doneIds}
                onDone={handleDone}
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
