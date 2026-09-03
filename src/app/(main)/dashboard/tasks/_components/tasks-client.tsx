"use client";

import { useMemo, useState, useTransition } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronsUp,
  Circle,
  Clock,
  Filter,
  Flame,
  Headphones,
  Kanban,
  List,
  Lock,
  Minus,
  Trash2,
  User,
  UserCheck,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { deleteTask, updateTaskStatus } from "@/actions/tasks";
import { TaskModal } from "@/components/crm/task-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { NewTaskDialog } from "./new-task-dialog";

// ─── Types ─────────────────────────────────────────────────────────────────────

type Task = {
  id: string;
  title: string;
  description: string | null;
  dueDate: Date | null;
  startDate?: Date | null;
  allDay?: boolean;
  status: string;
  priority: string;
  depth: number;
  progressPct: number;
  parentId: string | null;
  estimatedHours?: string | null;
  actualHours?: string | null;
  createdAt: Date;
  completedAt: Date | null;
  ownerId: string | null;
  assigneeId: string | null;
  ownerName: string | null;
  assigneeName: string | null;
  leadId: string | null;
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
  ticketId: string | null;
  leadName: string | null;
  leadLastName: string | null;
  contactName: string | null;
  contactLastName: string | null;
  companyName: string | null;
  ticketNumber: string | null;
  ticketSubject: string | null;
  blockedByDeps?: number;
};

type TaskUser = { id: string; name: string | null };

// ─── Helpers ───────────────────────────────────────────────────────────────────

const PRIORITY_CLASS: Record<string, string> = {
  blocker: "bg-red-600 text-white",
  critical: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  high: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  normal: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  low: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

const PRIORITY_ORDER: Record<string, number> = {
  blocker: 0,
  critical: 1,
  high: 2,
  normal: 3,
  low: 4,
};

const PRIORITY_ICON: Record<string, React.ElementType> = {
  blocker: Flame,
  critical: ChevronsUp,
  high: ArrowUp,
  normal: Minus,
  low: ArrowDown,
};

const PRIORITY_COLOR: Record<string, string> = {
  blocker: "text-red-600 dark:text-red-500",
  critical: "text-orange-500",
  high: "text-red-400",
  normal: "text-yellow-500",
  low: "text-slate-400 dark:text-slate-500",
};

const PRIORITY_BORDER: Record<string, string> = {
  blocker: "border-l-red-600",
  critical: "border-l-orange-500",
  high: "border-l-red-400",
  normal: "border-l-yellow-400",
  low: "border-l-slate-300 dark:border-l-slate-600",
};

const BOARD_COLUMN_IDS = ["todo", "in_progress", "done"] as const;
type BoardColId = (typeof BOARD_COLUMN_IDS)[number];

const BOARD_COLUMN_COLORS: Record<BoardColId, string> = {
  todo: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  in_progress: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  done: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
};

function entityLink(task: Task): { label: string; href: string; icon: React.ElementType } | null {
  if (task.ticketId)
    return {
      label: task.ticketNumber ? `#${task.ticketNumber}` : "Ticket",
      href: `/dashboard/support/tickets/${task.ticketId}`,
      icon: Headphones,
    };
  if (task.contactId)
    return {
      label: `${task.contactName ?? ""} ${task.contactLastName ?? ""}`.trim(),
      href: `/dashboard/contacts/${task.contactId}`,
      icon: User,
    };
  if (task.leadId)
    return {
      label: `${task.leadName ?? ""} ${task.leadLastName ?? ""}`.trim(),
      href: `/dashboard/leads/${task.leadId}`,
      icon: UserCheck,
    };
  if (task.companyId)
    return { label: task.companyName ?? "Company", href: `/dashboard/companies/${task.companyId}`, icon: Building2 };
  if (task.dealId) return { label: "Deal", href: `/dashboard/pipeline`, icon: Kanban };
  return null;
}

function isOverdue(task: Task) {
  return task.status !== "done" && task.dueDate && new Date(task.dueDate) < new Date();
}

function isDueToday(task: Task) {
  if (!task.dueDate || task.status === "done") return false;
  const d = new Date(task.dueDate);
  const today = new Date();
  return (
    d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate()
  );
}

// ─── Task card (for board view) ─────────────────────────────────────────────────

function TaskCard({
  task,
  index,
  onToggle,
  onDelete,
  onUpdated,
  users,
  currentUserId,
  defaultOpen,
}: {
  task: Task;
  index: number;
  onToggle: (task: Task) => void;
  onDelete: (id: string) => void;
  onUpdated: (updated: Task) => void;
  users: TaskUser[];
  currentUserId: string;
  defaultOpen?: boolean;
}) {
  const t = useTranslations("tasks");
  const overdue = isOverdue(task);
  const today = isDueToday(task);
  const done = task.status === "done";
  const entity = entityLink(task);
  const priorityKey = task.priority as "low" | "normal" | "high" | "critical" | "blocker";
  const priorityLabel = t(`priorities.${priorityKey}`);
  const PriorityIcon = PRIORITY_ICON[task.priority] ?? Minus;
  const priorityColor = PRIORITY_COLOR[task.priority] ?? "text-muted-foreground";
  const priorityBorder = PRIORITY_BORDER[task.priority] ?? "border-l-slate-200";
  const hasProgress = task.progressPct > 0 || task.status === "done";
  const estH = task.estimatedHours ? parseFloat(task.estimatedHours) : null;
  const actH = task.actualHours ? parseFloat(task.actualHours) : null;
  const overBudget = estH !== null && actH !== null && actH > estH;

  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className={cn(
            "cursor-grab select-none space-y-2 rounded-lg border border-l-[3px] bg-background p-3 shadow-xs active:cursor-grabbing",
            priorityBorder,
            snapshot.isDragging && "shadow-lg ring-2 ring-primary/20",
            done && "opacity-60",
          )}
        >
          <div className="flex items-start gap-2">
            <button
              type="button"
              onClick={() => onToggle(task)}
              className="mt-0.5 shrink-0 text-muted-foreground hover:text-primary"
            >
              {done ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Circle className="h-3.5 w-3.5" />}
            </button>
            <p
              className={cn(
                "min-w-0 flex-1 font-medium text-sm leading-snug",
                done && "text-muted-foreground line-through",
              )}
            >
              {task.title}
            </p>
          </div>

          {task.description && <p className="line-clamp-2 pl-5 text-muted-foreground text-xs">{task.description}</p>}

          <div className="flex flex-wrap items-center gap-1.5 pl-5">
            <span className={cn("flex items-center gap-0.5 font-semibold text-[10px]", priorityColor)}>
              <PriorityIcon className="h-2.5 w-2.5 shrink-0" />
              {priorityLabel}
            </span>
            {task.dueDate && (
              <span
                className={cn(
                  "text-[10px]",
                  overdue
                    ? "font-semibold text-destructive"
                    : today
                      ? "font-semibold text-orange-500"
                      : "text-muted-foreground",
                )}
              >
                {overdue && <AlertCircle className="-mt-0.5 mr-0.5 inline h-2.5 w-2.5" />}
                {new Date(task.dueDate).toLocaleDateString(undefined, { day: "2-digit", month: "short" })}
              </span>
            )}
            {entity && (
              <Link
                href={entity.href}
                className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground"
              >
                <entity.icon className="h-2.5 w-2.5 shrink-0" />
                <span className="max-w-[80px] truncate">{entity.label}</span>
              </Link>
            )}
            {(estH !== null || actH !== null) && (
              <span
                className={cn(
                  "text-[10px] tabular-nums",
                  overBudget ? "font-semibold text-destructive" : "text-muted-foreground",
                )}
              >
                {actH !== null ? `${actH}h` : ""}
                {estH !== null ? `/${estH}h` : ""}
              </span>
            )}
            {(task.blockedByDeps ?? 0) > 0 && (
              <span className="flex items-center gap-0.5 font-medium text-[10px] text-destructive">
                <Lock className="h-2.5 w-2.5" />
                Blocked
              </span>
            )}
          </div>

          <div className="flex items-center justify-between pl-5">
            <span className="text-[10px] text-muted-foreground">{task.assigneeName ?? task.ownerName ?? ""}</span>
            <div className="flex items-center gap-0.5">
              <TaskModal
                task={task}
                users={users}
                currentUserId={currentUserId}
                revalidatePathStr="/dashboard/tasks"
                defaultOpen={defaultOpen}
                onUpdated={onUpdated}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 hover:text-destructive"
                onClick={() => onDelete(task.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {hasProgress && (
            <div className="space-y-0.5 pl-5">
              <div className="h-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    task.progressPct >= 100 || done
                      ? "bg-emerald-500"
                      : task.progressPct >= 50
                        ? "bg-blue-500"
                        : "bg-orange-400",
                  )}
                  style={{ width: done ? "100%" : `${task.progressPct}%` }}
                />
              </div>
              {!done && <span className="text-[9px] text-muted-foreground/60 tabular-nums">{task.progressPct}%</span>}
            </div>
          )}
        </div>
      )}
    </Draggable>
  );
}

// ─── Component ─────────────────────────────────────────────────────────────────

interface Props {
  tasks: Task[];
  users: TaskUser[];
  currentUserId: string;
  leads: { id: string; firstName: string; lastName: string }[];
  contacts: { id: string; firstName: string; lastName: string }[];
  companies: { id: string; name: string }[];
  deals: { id: string; name: string }[];
  tickets: { id: string; ticketNumber: string; subject: string }[];
  initialOpenTaskId?: string;
}

export function TasksClient({
  tasks: initialTasks,
  users,
  currentUserId,
  leads,
  contacts,
  companies,
  deals,
  tickets,
  initialOpenTaskId,
}: Props) {
  const t = useTranslations("tasks");
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [tasks, setTasks] = useState(initialTasks);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"list" | "board">("list");

  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPriority, setFilterPriority] = useState("all");
  const [filterAssignee, setFilterAssignee] = useState("all");

  const stats = useMemo(
    () => ({
      total: tasks.length,
      overdue: tasks.filter(isOverdue).length,
      dueToday: tasks.filter(isDueToday).length,
      done: tasks.filter((tk) => tk.status === "done").length,
    }),
    [tasks],
  );

  const filtered = useMemo(() => {
    return tasks.filter((tk) => {
      if (search && !tk.title.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterStatus !== "all") {
        if (filterStatus === "overdue" && !isOverdue(tk)) return false;
        if (filterStatus === "dueToday" && !isDueToday(tk)) return false;
        if (filterStatus === "done" && tk.status !== "done") return false;
        if (filterStatus === "todo" && (tk.status === "done" || isOverdue(tk))) return false;
      }
      if (filterPriority !== "all" && tk.priority !== filterPriority) return false;
      if (filterAssignee !== "all") {
        if (filterAssignee === "me" && tk.assigneeId !== currentUserId && tk.ownerId !== currentUserId) return false;
        if (filterAssignee !== "me" && tk.assigneeId !== filterAssignee) return false;
      }
      return true;
    });
  }, [tasks, search, filterStatus, filterPriority, filterAssignee, currentUserId]);

  const allSelected = filtered.length > 0 && filtered.every((tk) => selected.has(tk.id));
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(filtered.map((tk) => tk.id)));
  };
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });

  const handleToggleStatus = (task: Task) => {
    const newStatus = task.status === "done" ? "todo" : "done";
    startTransition(async () => {
      await updateTaskStatus(task.id, newStatus);
      setTasks((prev) => prev.map((tk) => (tk.id === task.id ? { ...tk, status: newStatus } : tk)));
    });
  };

  const handleBulkComplete = () => {
    startTransition(async () => {
      await Promise.all([...selected].map((id) => updateTaskStatus(id, "done")));
      setTasks((prev) => prev.map((tk) => (selected.has(tk.id) ? { ...tk, status: "done" } : tk)));
      setSelected(new Set());
      toast.success(t("createSuccess"));
    });
  };

  const handleBulkDelete = async () => {
    if (!confirm(`Delete ${selected.size} tasks?`)) return;
    startTransition(async () => {
      await Promise.all([...selected].map((id) => deleteTask(id)));
      setTasks((prev) => prev.filter((tk) => !selected.has(tk.id)));
      setSelected(new Set());
      toast.success(t("deleteSuccess"));
    });
  };

  const handleDelete = async (id: string) => {
    startTransition(async () => {
      await deleteTask(id);
      setTasks((prev) => prev.filter((tk) => tk.id !== id));
      toast.success(t("deleteSuccess"));
    });
  };

  const handleCreated = () => {
    router.refresh();
  };

  const handleDragEnd = (result: DropResult) => {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;

    const newStatus = destination.droppableId as Task["status"];
    startTransition(async () => {
      await updateTaskStatus(draggableId, newStatus);
      setTasks((prev) => prev.map((tk) => (tk.id === draggableId ? { ...tk, status: newStatus } : tk)));
    });
  };

  const STAT_CARDS = [
    {
      labelKey: "stats.total",
      value: stats.total,
      icon: Circle,
      color: "text-muted-foreground",
      filterValue: "all",
      activeRing: "ring-2 ring-muted-foreground/40 border-muted-foreground/40",
    },
    {
      labelKey: "stats.overdue",
      value: stats.overdue,
      icon: AlertCircle,
      color: "text-destructive",
      filterValue: "overdue",
      activeRing: "ring-2 ring-destructive/50 border-destructive/50",
    },
    {
      labelKey: "stats.dueToday",
      value: stats.dueToday,
      icon: Clock,
      color: "text-orange-500",
      filterValue: "dueToday",
      activeRing: "ring-2 ring-orange-400/50 border-orange-400/50",
    },
    {
      labelKey: "stats.completed",
      value: stats.done,
      icon: CheckCircle2,
      color: "text-emerald-500",
      filterValue: "done",
      activeRing: "ring-2 ring-emerald-400/50 border-emerald-400/50",
    },
  ] as const;

  return (
    <div className="space-y-6 p-6">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-2xl tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-md border bg-muted/30 p-0.5">
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={cn(
                "flex items-center gap-1.5 rounded px-2.5 py-1.5 font-medium text-xs transition-colors",
                viewMode === "list"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <List className="h-3.5 w-3.5" /> {t("list")}
            </button>
            <button
              type="button"
              onClick={() => setViewMode("board")}
              className={cn(
                "flex items-center gap-1.5 rounded px-2.5 py-1.5 font-medium text-xs transition-colors",
                viewMode === "board"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Kanban className="h-3.5 w-3.5" /> {t("board")}
            </button>
          </div>
          <NewTaskDialog
            users={users}
            tasks={tasks}
            leads={leads}
            contacts={contacts}
            companies={companies}
            deals={deals}
            tickets={tickets}
            currentUserId={currentUserId}
            onCreated={handleCreated}
          />
        </div>
      </div>

      {/* ── Stats cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {STAT_CARDS.map(({ labelKey, value, icon: Icon, color, filterValue, activeRing }) => {
          const active = filterStatus === filterValue;
          return (
            <button
              key={labelKey}
              type="button"
              onClick={() => setFilterStatus(active ? "all" : filterValue)}
              className={cn(
                "flex items-center gap-3 rounded-lg border bg-card px-4 py-3 text-left transition-all",
                "hover:bg-accent/50",
                active ? activeRing : "hover:border-border/80",
              )}
            >
              <Icon className={cn("h-5 w-5 shrink-0", color)} />
              <div>
                <p className="font-bold text-xl leading-none">{value}</p>
                <p className="mt-0.5 text-muted-foreground text-xs">{t(labelKey)}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder={t("searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 w-48"
        />

        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="h-8 w-32 text-xs">
            <Filter className="mr-1 h-3 w-3" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allStatus")}</SelectItem>
            <SelectItem value="todo">{t("todoFilter")}</SelectItem>
            <SelectItem value="overdue">{t("overdue")}</SelectItem>
            <SelectItem value="done">{t("statuses.done")}</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filterPriority} onValueChange={setFilterPriority}>
          <SelectTrigger className="h-8 w-32 text-xs">
            <SelectValue placeholder={t("allPriorities")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allPriorities")}</SelectItem>
            <SelectItem value="blocker">{t("priorities.blocker")}</SelectItem>
            <SelectItem value="critical">{t("priorities.critical")}</SelectItem>
            <SelectItem value="high">{t("priorities.high")}</SelectItem>
            <SelectItem value="normal">{t("priorities.normal")}</SelectItem>
            <SelectItem value="low">{t("priorities.low")}</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filterAssignee} onValueChange={setFilterAssignee}>
          <SelectTrigger className="h-8 w-36 text-xs">
            <SelectValue placeholder={t("allAssignees")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allAssignees")}</SelectItem>
            <SelectItem value="me">{t("myTasks")}</SelectItem>
            {users.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.name ?? u.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selected.size > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-muted-foreground text-xs">{t("selectedCount", { count: selected.size })}</span>
            <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={handleBulkComplete}>
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t("markDone")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-destructive hover:text-destructive"
              onClick={handleBulkDelete}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t("deleteTask")}
            </Button>
          </div>
        )}
      </div>

      {/* ── Board view ──────────────────────────────────────────────────────── */}
      {viewMode === "board" && (
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {BOARD_COLUMN_IDS.map((colId) => {
              const colLabel = t(
                `statuses.${colId === "in_progress" ? "inProgress" : colId === "todo" ? "todo" : "done"}`,
              );
              const colColor = BOARD_COLUMN_COLORS[colId];
              const colTasks = filtered
                .filter((tk) => {
                  if (colId === "todo") return tk.status !== "done" && tk.status !== "in_progress";
                  if (colId === "in_progress") return tk.status === "in_progress";
                  return tk.status === "done";
                })
                .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3));

              const priorityGroups: { priority: string; tasks: Task[] }[] = [];
              for (const task of colTasks) {
                const last = priorityGroups[priorityGroups.length - 1];
                if (last?.priority === task.priority) {
                  last.tasks.push(task);
                } else {
                  priorityGroups.push({ priority: task.priority, tasks: [task] });
                }
              }

              return (
                <div key={colId} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between px-1">
                    <div className="flex items-center gap-2">
                      <span className={cn("rounded-full px-2 py-0.5 font-semibold text-xs", colColor)}>{colLabel}</span>
                    </div>
                    <span className="text-muted-foreground text-xs tabular-nums">{colTasks.length}</span>
                  </div>

                  <Droppable droppableId={colId}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={cn(
                          "flex min-h-[200px] flex-col gap-1.5 rounded-xl border-2 border-dashed p-2 transition-colors",
                          snapshot.isDraggingOver ? "border-primary/40 bg-primary/5" : "border-transparent bg-muted/20",
                        )}
                      >
                        {(() => {
                          const elements: React.ReactNode[] = [];
                          let runningIndex = 0;
                          for (const { priority, tasks: groupTasks } of priorityGroups) {
                            const PIcon = PRIORITY_ICON[priority] ?? Minus;
                            const pColor = PRIORITY_COLOR[priority] ?? "text-muted-foreground";
                            const pKey = priority as "blocker" | "critical" | "high" | "normal" | "low";
                            elements.push(
                              <div
                                key={`grp-${priority}`}
                                className="flex items-center gap-1 px-0.5 pt-1 pb-0.5 first:pt-0"
                              >
                                <PIcon className={cn("h-3 w-3 shrink-0", pColor)} />
                                <span className={cn("font-semibold uppercase tracking-wider text-[9px]", pColor)}>
                                  {t(`priorities.${pKey}`)}
                                </span>
                                <span className="ml-auto font-medium text-[9px] text-muted-foreground/50 tabular-nums">
                                  {groupTasks.length}
                                </span>
                              </div>,
                            );
                            for (let i = 0; i < groupTasks.length; i++) {
                              const task = groupTasks[i];
                              elements.push(
                                <TaskCard
                                  key={task.id}
                                  task={task}
                                  index={runningIndex + i}
                                  onToggle={handleToggleStatus}
                                  onDelete={handleDelete}
                                  onUpdated={(updated) =>
                                    setTasks((prev) =>
                                      prev.map((tk) => (tk.id === updated.id ? { ...tk, ...updated } : tk)),
                                    )
                                  }
                                  users={users}
                                  currentUserId={currentUserId}
                                  defaultOpen={task.id === initialOpenTaskId}
                                />,
                              );
                            }
                            runningIndex += groupTasks.length;
                          }
                          return elements;
                        })()}
                        {provided.placeholder}
                        {colTasks.length === 0 && !snapshot.isDraggingOver && (
                          <p className="py-6 text-center text-muted-foreground/40 text-xs">{t("dropTasksHere")}</p>
                        )}
                      </div>
                    )}
                  </Droppable>
                </div>
              );
            })}
          </div>
        </DragDropContext>
      )}

      {/* ── Table ───────────────────────────────────────────────────────────── */}
      {viewMode === "list" && (
        <>
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-muted-foreground text-xs">
                  <th className="w-10 px-3 py-2.5 text-left">
                    <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                  </th>
                  <th className="px-3 py-2.5 text-left font-medium">{t("columns.task")}</th>
                  <th className="hidden px-3 py-2.5 text-left font-medium md:table-cell">{t("columns.linkedTo")}</th>
                  <th className="hidden px-3 py-2.5 text-left font-medium sm:table-cell">{t("columns.due")}</th>
                  <th className="hidden px-3 py-2.5 text-left font-medium lg:table-cell">{t("columns.priority")}</th>
                  <th className="hidden px-3 py-2.5 text-left font-medium lg:table-cell">{t("columns.assignee")}</th>
                  <th className="w-10 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-muted-foreground text-sm">
                      {search || filterStatus !== "all" || filterPriority !== "all" || filterAssignee !== "all"
                        ? t("noTasksMatch")
                        : t("noTasksYet")}
                    </td>
                  </tr>
                ) : (
                  filtered.map((task) => {
                    const overdue = isOverdue(task);
                    const today = isDueToday(task);
                    const done = task.status === "done";
                    const entity = entityLink(task);
                    const priorityClass = PRIORITY_CLASS[task.priority] ?? PRIORITY_CLASS.normal;
                    const priorityLabel = t(
                      `priorities.${task.priority as "low" | "normal" | "high" | "critical" | "blocker"}`,
                      { default: task.priority },
                    );

                    return (
                      <tr key={task.id} className={cn("transition-colors hover:bg-muted/30", done && "opacity-60")}>
                        <td className="px-3 py-2.5">
                          <Checkbox checked={selected.has(task.id)} onCheckedChange={() => toggleOne(task.id)} />
                        </td>

                        <td className="px-3 py-2.5">
                          <div className="flex items-start gap-2.5">
                            <button
                              type="button"
                              onClick={() => handleToggleStatus(task)}
                              className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-primary"
                              title={done ? t("markAsTodo") : t("markAsDone")}
                            >
                              {done ? (
                                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                              ) : (
                                <Circle className="h-4 w-4" />
                              )}
                            </button>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p
                                  className={cn(
                                    "font-medium leading-snug",
                                    done && "text-muted-foreground line-through",
                                  )}
                                >
                                  {task.title}
                                </p>
                                {(task.blockedByDeps ?? 0) > 0 && (
                                  <span className="flex shrink-0 items-center gap-0.5 font-medium text-[10px] text-destructive">
                                    <Lock className="h-2.5 w-2.5" />
                                    Blocked
                                  </span>
                                )}
                              </div>
                              {task.description && (
                                <p className="mt-0.5 max-w-xs truncate text-muted-foreground text-xs">
                                  {task.description}
                                </p>
                              )}
                              {(task.progressPct > 0 || done) && (
                                <div className="mt-1 flex items-center gap-1.5">
                                  <div className="h-1 w-20 overflow-hidden rounded-full bg-muted">
                                    <div
                                      className={cn(
                                        "h-full rounded-full transition-all",
                                        task.progressPct >= 100 || done
                                          ? "bg-emerald-500"
                                          : task.progressPct >= 50
                                            ? "bg-blue-500"
                                            : "bg-orange-400",
                                      )}
                                      style={{ width: done ? "100%" : `${task.progressPct}%` }}
                                    />
                                  </div>
                                  {!done && (
                                    <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                                      {task.progressPct}%
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>

                        <td className="hidden px-3 py-2.5 md:table-cell">
                          {entity ? (
                            <Link
                              href={entity.href}
                              className="flex max-w-[160px] items-center gap-1.5 text-muted-foreground text-xs transition-colors hover:text-foreground"
                            >
                              <entity.icon className="h-3 w-3 shrink-0" />
                              <span className="truncate">{entity.label}</span>
                            </Link>
                          ) : (
                            <span className="text-muted-foreground/40 text-xs">—</span>
                          )}
                        </td>

                        <td className="hidden px-3 py-2.5 sm:table-cell">
                          {task.dueDate ? (
                            <span
                              className={cn(
                                "text-xs",
                                overdue
                                  ? "font-semibold text-destructive"
                                  : today
                                    ? "font-semibold text-orange-500"
                                    : "text-muted-foreground",
                              )}
                            >
                              {overdue && <AlertCircle className="-mt-0.5 mr-1 inline h-3 w-3" />}
                              {new Date(task.dueDate).toLocaleDateString(undefined, {
                                day: "2-digit",
                                month: "short",
                                year: "numeric",
                              })}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/40 text-xs">—</span>
                          )}
                        </td>

                        <td className="hidden px-3 py-2.5 lg:table-cell">
                          <Badge variant="outline" className={cn("px-1.5 py-0 text-[10px]", priorityClass)}>
                            {priorityLabel}
                          </Badge>
                        </td>

                        <td className="hidden px-3 py-2.5 lg:table-cell">
                          {task.assigneeName ? (
                            <span className="text-muted-foreground text-xs">{task.assigneeName}</span>
                          ) : task.ownerName ? (
                            <span className="text-muted-foreground text-xs">{task.ownerName}</span>
                          ) : (
                            <span className="text-muted-foreground/40 text-xs">—</span>
                          )}
                        </td>

                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1">
                            <TaskModal
                              task={task}
                              users={users}
                              currentUserId={currentUserId}
                              revalidatePathStr="/dashboard/tasks"
                              defaultOpen={task.id === initialOpenTaskId}
                              onUpdated={(updated) =>
                                setTasks((prev) =>
                                  prev.map((tk) => (tk.id === updated.id ? { ...tk, ...updated } : tk)),
                                )
                              }
                            />
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7">
                                  <ChevronDown className="h-3.5 w-3.5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-44">
                                <DropdownMenuItem onClick={() => handleToggleStatus(task)}>
                                  {done ? t("markAsTodo") : t("markAsDone")}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={() => handleDelete(task.id)}
                                >
                                  {t("deleteTask")}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <p className="text-right text-muted-foreground text-xs">
            {t("showingCount", { filtered: filtered.length, total: tasks.length })}
          </p>
        </>
      )}
    </div>
  );
}
