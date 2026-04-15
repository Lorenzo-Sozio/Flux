"use client";

import { useState, useMemo, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";
import {
  CheckCircle2,
  Circle,
  AlertCircle,
  Clock,
  Filter,
  Plus,
  Trash2,
  User,
  Building2,
  UserCheck,
  Kanban,
  List,
  ChevronDown,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { updateTaskStatus, deleteTask } from "@/actions/tasks";
import { TaskModal } from "@/components/crm/task-modal";
import { NewTaskDialog } from "./new-task-dialog";

// ─── Types ─────────────────────────────────────────────────────────────────────

type Task = {
  id: string;
  title: string;
  description: string | null;
  dueDate: Date | null;
  status: string;
  priority: string;
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
  leadName: string | null;
  leadLastName: string | null;
  contactName: string | null;
  contactLastName: string | null;
  companyName: string | null;
};

type User = { id: string; name: string | null };

// ─── Helpers ───────────────────────────────────────────────────────────────────

const PRIORITY_CONFIG = {
  high:   { label: "High",   class: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  normal: { label: "Normal", class: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" },
  low:    { label: "Low",    class: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400" },
};

function entityLink(task: Task): { label: string; href: string; icon: React.ElementType } | null {
  if (task.contactId)
    return { label: `${task.contactName ?? ""} ${task.contactLastName ?? ""}`.trim(), href: `/dashboard/contacts/${task.contactId}`, icon: User };
  if (task.leadId)
    return { label: `${task.leadName ?? ""} ${task.leadLastName ?? ""}`.trim(), href: `/dashboard/leads/${task.leadId}`, icon: UserCheck };
  if (task.companyId)
    return { label: task.companyName ?? "Company", href: `/dashboard/companies/${task.companyId}`, icon: Building2 };
  if (task.dealId)
    return { label: "Deal", href: `/dashboard/pipeline`, icon: Kanban };
  return null;
}

function isOverdue(task: Task) {
  return task.status !== "done" && task.dueDate && new Date(task.dueDate) < new Date();
}

function isDueToday(task: Task) {
  if (!task.dueDate || task.status === "done") return false;
  const d = new Date(task.dueDate);
  const today = new Date();
  return d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
}

// ─── Board column config ────────────────────────────────────────────────────────

const BOARD_COLUMNS = [
  { id: "todo",        label: "To Do",       color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  { id: "in_progress", label: "In Progress", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  { id: "done",        label: "Done",        color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
] as const;

// ─── Task card (for board view) ─────────────────────────────────────────────────

function TaskCard({ task, index, onToggle, onDelete }: {
  task: Task;
  index: number;
  onToggle: (task: Task) => void;
  onDelete: (id: string) => void;
}) {
  const overdue = isOverdue(task);
  const today   = isDueToday(task);
  const done    = task.status === "done";
  const entity  = entityLink(task);
  const priority = PRIORITY_CONFIG[task.priority as keyof typeof PRIORITY_CONFIG] ?? PRIORITY_CONFIG.normal;

  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className={cn(
            "rounded-lg border bg-background p-3 shadow-xs space-y-2 cursor-grab active:cursor-grabbing select-none",
            snapshot.isDragging && "shadow-lg ring-2 ring-primary/20",
            done && "opacity-60",
          )}
        >
          {/* Title row */}
          <div className="flex items-start gap-2">
            <button
              type="button"
              onClick={() => onToggle(task)}
              className="mt-0.5 shrink-0 text-muted-foreground hover:text-primary"
            >
              {done
                ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                : <Circle className="h-3.5 w-3.5" />}
            </button>
            <p className={cn("text-sm font-medium leading-snug flex-1 min-w-0", done && "line-through text-muted-foreground")}>
              {task.title}
            </p>
          </div>

          {/* Description */}
          {task.description && (
            <p className="text-xs text-muted-foreground line-clamp-2 pl-5">{task.description}</p>
          )}

          {/* Meta row */}
          <div className="flex items-center gap-1.5 flex-wrap pl-5">
            <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 h-4", priority.class)}>
              {priority.label}
            </Badge>
            {task.dueDate && (
              <span className={cn(
                "text-[10px]",
                overdue ? "text-destructive font-semibold" :
                today   ? "text-orange-500 font-semibold" :
                "text-muted-foreground",
              )}>
                {overdue && <AlertCircle className="inline h-2.5 w-2.5 mr-0.5 -mt-0.5" />}
                {new Date(task.dueDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
              </span>
            )}
            {entity && (
              <Link href={entity.href} className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5">
                <entity.icon className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate max-w-[80px]">{entity.label}</span>
              </Link>
            )}
          </div>

          {/* Assignee + delete */}
          <div className="flex items-center justify-between pl-5">
            <span className="text-[10px] text-muted-foreground">
              {task.assigneeName ?? task.ownerName ?? ""}
            </span>
            <button
              type="button"
              onClick={() => onDelete(task.id)}
              className="text-muted-foreground/40 hover:text-destructive transition-colors"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </Draggable>
  );
}

// ─── Component ─────────────────────────────────────────────────────────────────

interface Props {
  tasks: Task[];
  users: User[];
  currentUserId: string;
}

export function TasksClient({ tasks: initialTasks, users, currentUserId }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [tasks, setTasks] = useState(initialTasks);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"list" | "board">("list");

  // ── Filters
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPriority, setFilterPriority] = useState("all");
  const [filterAssignee, setFilterAssignee] = useState("all");

  // ── Stats
  const stats = useMemo(() => ({
    total:    tasks.length,
    overdue:  tasks.filter(isOverdue).length,
    dueToday: tasks.filter(isDueToday).length,
    done:     tasks.filter((t) => t.status === "done").length,
  }), [tasks]);

  // ── Filtered list
  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterStatus !== "all") {
        if (filterStatus === "overdue" && !isOverdue(t)) return false;
        if (filterStatus === "done" && t.status !== "done") return false;
        if (filterStatus === "todo" && (t.status === "done" || isOverdue(t))) return false;
      }
      if (filterPriority !== "all" && t.priority !== filterPriority) return false;
      if (filterAssignee !== "all") {
        if (filterAssignee === "me" && t.assigneeId !== currentUserId && t.ownerId !== currentUserId) return false;
        if (filterAssignee !== "me" && t.assigneeId !== filterAssignee) return false;
      }
      return true;
    });
  }, [tasks, search, filterStatus, filterPriority, filterAssignee, currentUserId]);

  // ── Selection
  const allSelected = filtered.length > 0 && filtered.every((t) => selected.has(t.id));
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(filtered.map((t) => t.id)));
  };
  const toggleOne = (id: string) =>
    setSelected((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  // ── Actions
  const handleToggleStatus = (task: Task) => {
    const newStatus = task.status === "done" ? "todo" : "done";
    startTransition(async () => {
      await updateTaskStatus(task.id, newStatus);
      setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, status: newStatus } : t));
    });
  };

  const handleBulkComplete = () => {
    startTransition(async () => {
      await Promise.all([...selected].map((id) => updateTaskStatus(id, "done")));
      setTasks((prev) => prev.map((t) => selected.has(t.id) ? { ...t, status: "done" } : t));
      setSelected(new Set());
      toast.success(`${selected.size} task${selected.size > 1 ? "s" : ""} completed.`);
    });
  };

  const handleBulkDelete = async () => {
    if (!confirm(`Delete ${selected.size} task${selected.size > 1 ? "s" : ""}?`)) return;
    startTransition(async () => {
      await Promise.all([...selected].map((id) => deleteTask(id)));
      setTasks((prev) => prev.filter((t) => !selected.has(t.id)));
      setSelected(new Set());
      toast.success("Tasks deleted.");
    });
  };

  const handleDelete = async (id: string) => {
    startTransition(async () => {
      await deleteTask(id);
      setTasks((prev) => prev.filter((t) => t.id !== id));
      toast.success("Task deleted.");
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
      setTasks((prev) => prev.map((t) => t.id === draggableId ? { ...t, status: newStatus } : t));
    });
  };

  return (
    <div className="space-y-5">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tasks</h1>
          <p className="text-muted-foreground text-sm">All tasks across leads, contacts and deals.</p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center rounded-md border bg-muted/30 p-0.5 gap-0.5">
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-colors",
                viewMode === "list"
                  ? "bg-background shadow-xs text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <List className="h-3.5 w-3.5" /> List
            </button>
            <button
              type="button"
              onClick={() => setViewMode("board")}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-colors",
                viewMode === "board"
                  ? "bg-background shadow-xs text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Kanban className="h-3.5 w-3.5" /> Board
            </button>
          </div>
          <NewTaskDialog users={users} currentUserId={currentUserId} onCreated={handleCreated} />
        </div>
      </div>

      {/* ── Stats cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total",     value: stats.total,    icon: Circle,        color: "text-muted-foreground" },
          { label: "Overdue",   value: stats.overdue,  icon: AlertCircle,   color: "text-destructive" },
          { label: "Due Today", value: stats.dueToday, icon: Clock,         color: "text-orange-500" },
          { label: "Completed", value: stats.done,     icon: CheckCircle2,  color: "text-emerald-500" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="rounded-lg border bg-card px-4 py-3 flex items-center gap-3">
            <Icon className={cn("h-5 w-5 shrink-0", color)} />
            <div>
              <p className="text-xl font-bold leading-none">{value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search tasks…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 w-48"
        />

        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="h-8 w-32 text-xs">
            <Filter className="h-3 w-3 mr-1" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="todo">To do</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
            <SelectItem value="done">Done</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filterPriority} onValueChange={setFilterPriority}>
          <SelectTrigger className="h-8 w-32 text-xs">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All priorities</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="normal">Normal</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filterAssignee} onValueChange={setFilterAssignee}>
          <SelectTrigger className="h-8 w-36 text-xs">
            <SelectValue placeholder="Assignee" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All assignees</SelectItem>
            <SelectItem value="me">My tasks</SelectItem>
            {users.map((u) => (
              <SelectItem key={u.id} value={u.id}>{u.name ?? u.id}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Bulk actions — appear when rows are selected */}
        {selected.size > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{selected.size} selected</span>
            <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={handleBulkComplete}>
              <CheckCircle2 className="h-3.5 w-3.5" />
              Mark done
            </Button>
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-destructive hover:text-destructive" onClick={handleBulkDelete}>
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          </div>
        )}
      </div>

      {/* ── Board view ──────────────────────────────────────────────────────── */}
      {viewMode === "board" && (
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {BOARD_COLUMNS.map((col) => {
              const colTasks = filtered.filter((t) => {
                if (col.id === "todo")        return t.status !== "done" && t.status !== "in_progress";
                if (col.id === "in_progress") return t.status === "in_progress";
                return t.status === "done";
              });
              return (
                <div key={col.id} className="flex flex-col gap-2">
                  {/* Column header */}
                  <div className="flex items-center justify-between px-1">
                    <div className="flex items-center gap-2">
                      <span className={cn("px-2 py-0.5 rounded-full text-xs font-semibold", col.color)}>
                        {col.label}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums">{colTasks.length}</span>
                  </div>

                  {/* Drop zone */}
                  <Droppable droppableId={col.id}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={cn(
                          "flex flex-col gap-2 min-h-[200px] rounded-xl border-2 border-dashed p-2 transition-colors",
                          snapshot.isDraggingOver
                            ? "border-primary/40 bg-primary/5"
                            : "border-transparent bg-muted/20",
                        )}
                      >
                        {colTasks.map((task, idx) => (
                          <TaskCard
                            key={task.id}
                            task={task}
                            index={idx}
                            onToggle={handleToggleStatus}
                            onDelete={handleDelete}
                          />
                        ))}
                        {provided.placeholder}
                        {colTasks.length === 0 && !snapshot.isDraggingOver && (
                          <p className="text-xs text-muted-foreground/40 text-center py-6">
                            Drop tasks here
                          </p>
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
      {viewMode === "list" && <>
      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
              <th className="w-10 px-3 py-2.5 text-left">
                <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
              </th>
              <th className="px-3 py-2.5 text-left font-medium">Task</th>
              <th className="px-3 py-2.5 text-left font-medium hidden md:table-cell">Linked to</th>
              <th className="px-3 py-2.5 text-left font-medium hidden sm:table-cell">Due</th>
              <th className="px-3 py-2.5 text-left font-medium hidden lg:table-cell">Priority</th>
              <th className="px-3 py-2.5 text-left font-medium hidden lg:table-cell">Assignee</th>
              <th className="w-10 px-3 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-muted-foreground text-sm">
                  {search || filterStatus !== "all" || filterPriority !== "all" || filterAssignee !== "all"
                    ? "No tasks match the current filters."
                    : "No tasks yet. Create one to get started."}
                </td>
              </tr>
            ) : (
              filtered.map((task) => {
                const overdue = isOverdue(task);
                const today = isDueToday(task);
                const done = task.status === "done";
                const entity = entityLink(task);
                const priority = PRIORITY_CONFIG[task.priority as keyof typeof PRIORITY_CONFIG] ?? PRIORITY_CONFIG.normal;

                return (
                  <tr
                    key={task.id}
                    className={cn(
                      "hover:bg-muted/30 transition-colors",
                      done && "opacity-60",
                    )}
                  >
                    {/* Checkbox */}
                    <td className="px-3 py-2.5">
                      <Checkbox checked={selected.has(task.id)} onCheckedChange={() => toggleOne(task.id)} />
                    </td>

                    {/* Title + status toggle */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-start gap-2.5">
                        <button
                          type="button"
                          onClick={() => handleToggleStatus(task)}
                          className="mt-0.5 shrink-0 text-muted-foreground hover:text-primary transition-colors"
                          title={done ? "Mark as todo" : "Mark as done"}
                        >
                          {done
                            ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                            : <Circle className="h-4 w-4" />}
                        </button>
                        <div className="min-w-0">
                          <p className={cn("font-medium leading-snug", done && "line-through text-muted-foreground")}>
                            {task.title}
                          </p>
                          {task.description && (
                            <p className="text-xs text-muted-foreground truncate max-w-xs mt-0.5">{task.description}</p>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Linked entity */}
                    <td className="px-3 py-2.5 hidden md:table-cell">
                      {entity ? (
                        <Link
                          href={entity.href}
                          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors max-w-[160px]"
                        >
                          <entity.icon className="h-3 w-3 shrink-0" />
                          <span className="truncate">{entity.label}</span>
                        </Link>
                      ) : (
                        <span className="text-muted-foreground/40 text-xs">—</span>
                      )}
                    </td>

                    {/* Due date */}
                    <td className="px-3 py-2.5 hidden sm:table-cell">
                      {task.dueDate ? (
                        <span className={cn(
                          "text-xs",
                          overdue ? "font-semibold text-destructive" :
                          today ? "font-semibold text-orange-500" :
                          "text-muted-foreground",
                        )}>
                          {overdue && <AlertCircle className="inline h-3 w-3 mr-1 -mt-0.5" />}
                          {new Date(task.dueDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/40 text-xs">—</span>
                      )}
                    </td>

                    {/* Priority */}
                    <td className="px-3 py-2.5 hidden lg:table-cell">
                      <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", priority.class)}>
                        {priority.label}
                      </Badge>
                    </td>

                    {/* Assignee */}
                    <td className="px-3 py-2.5 hidden lg:table-cell">
                      {task.assigneeName ? (
                        <span className="text-xs text-muted-foreground">{task.assigneeName}</span>
                      ) : task.ownerName ? (
                        <span className="text-xs text-muted-foreground">{task.ownerName}</span>
                      ) : (
                        <span className="text-muted-foreground/40 text-xs">—</span>
                      )}
                    </td>

                    {/* Row actions */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1">
                        <TaskModal
                          task={task}
                          users={users}
                          revalidatePathStr="/dashboard/tasks"
                          onUpdated={(updated) =>
                            setTasks((prev) => prev.map((t) => t.id === updated.id ? { ...t, ...updated } : t))
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
                              {done ? "Mark as to-do" : "Mark as done"}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => handleDelete(task.id)}
                            >
                              Delete
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

      <p className="text-xs text-muted-foreground text-right">
        Showing {filtered.length} of {tasks.length} tasks
      </p>
      </>}
    </div>
  );
}
