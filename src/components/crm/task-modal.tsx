"use client";

import { useEffect, useState } from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import {
  AlertCircle,
  CalendarIcon,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock,
  Link2,
  Loader2,
  Lock,
  PencilIcon,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import {
  addDependency,
  createSubtask,
  deleteTask,
  getAllTasksForGantt,
  getDependencies,
  getSubtasks,
  getTaskActualHours,
  removeDependency,
  updateTask,
  updateTaskStatus,
} from "@/actions/tasks";
import { AssigneeSelect, decodeAssignee, encodeAssignee } from "@/components/crm/assignee-select";
import { MultiAssigneeSelect } from "@/components/crm/multi-assignee-select";
import { TaskTimer } from "@/components/crm/task-timer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// ─── Config ────────────────────────────────────────────────────────────────────

const PRIORITY_CONFIG = {
  blocker: { label: "Bloccante", color: "#dc2626" },
  critical: { label: "Critica", color: "#ea580c" },
  high: { label: "Alta", color: "#ef4444" },
  normal: { label: "Normale", color: "#6366f1" },
  low: { label: "Bassa", color: "#94a3b8" },
} as const;

const STATUS_CONFIG = {
  todo: { label: "Da fare", icon: AlertCircle, color: "text-slate-500" },
  in_progress: { label: "In corso", icon: Clock, color: "text-blue-500" },
  done: { label: "Completata", icon: CheckSquare, color: "text-emerald-500" },
} as const;

// ─── Schema ────────────────────────────────────────────────────────────────────

const taskSchema = z.object({
  title: z.string().min(1, "Titolo obbligatorio"),
  description: z.string().optional(),
  status: z.enum(["todo", "in_progress", "done"]).default("todo"),
  priority: z.string().default("normal"),
  startDate: z.string().optional(),
  dueDate: z.string().optional(),
  assigneeValue: z.string().optional(),
  estimatedHours: z.string().optional(),
});

type TaskFormValues = z.infer<typeof taskSchema>;

// ─── Sub-types ─────────────────────────────────────────────────────────────────

type Subtask = {
  id: string;
  title: string;
  status: string;
  priority: string;
  depth: number;
  progressPct: number;
  dueDate: Date | null;
  assigneeName: string | null;
  ownerName: string | null;
};

type DepEntry = {
  id: string;
  type: string;
  lagDays: number;
  taskId: string;
  taskTitle: string;
  taskStatus: string | null;
};

const DEP_TYPE_LABELS: Record<string, string> = {
  FS: "Fine→Inizio",
  SS: "Inizio→Inizio",
  FF: "Fine→Fine",
  SF: "Inizio→Fine",
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function toDateStr(date: Date | string | null | undefined): string | undefined {
  if (!date) return undefined;
  return format(new Date(date), "yyyy-MM-dd");
}

function F({
  label,
  error,
  required,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}

function TabDot({ has }: { has: boolean }) {
  return has ? <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-destructive" /> : null;
}

function DatePicker({
  value,
  onChange,
  placeholder,
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? new Date(value) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-9 w-full items-center gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs",
            "transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            !selected && "text-muted-foreground",
          )}
        >
          <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="flex-1 text-left">
            {selected ? format(selected, "d MMM yyyy", { locale: it }) : placeholder}
          </span>
          {selected && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange(undefined);
              }}
              className="rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(date) => {
            onChange(date ? format(date, "yyyy-MM-dd") : undefined);
            setOpen(false);
          }}
          locale={it}
          captionLayout="dropdown"
        />
      </PopoverContent>
    </Popover>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function TaskModal({
  task,
  users,
  currentUserId,
  revalidatePathStr,
  onUpdated,
  defaultOpen,
}: {
  // biome-ignore lint/suspicious/noExplicitAny: task shape varies by caller
  task: any;
  users?: { id: string; name: string | null }[];
  currentUserId?: string;
  revalidatePathStr: string;
  // biome-ignore lint/suspicious/noExplicitAny: mirrors task shape
  onUpdated?: (updated: any) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [subtasksOpen, setSubtasksOpen] = useState(true);
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [actualHours, setActualHours] = useState<string | null>(task.actualHours ?? null);
  const [depPredecessors, setDepPredecessors] = useState<DepEntry[]>([]);
  const [depsOpen, setDepsOpen] = useState(true);
  const [addingDep, setAddingDep] = useState(false);
  const [newDepTaskId, setNewDepTaskId] = useState("");
  const [newDepType, setNewDepType] = useState("FS");
  const [newDepLag, setNewDepLag] = useState("0");
  const [allTasks, setAllTasks] = useState<{ id: string; title: string }[]>([]);

  const canAddSubtasks = (task.depth ?? 0) < 3;

  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskSchema),
    defaultValues: {
      title: task.title,
      description: task.description || "",
      status: task.status || "todo",
      priority: task.priority || "normal",
      startDate: toDateStr(task.startDate),
      dueDate: toDateStr(task.dueDate),
      assigneeValue: encodeAssignee(task.assigneeId, null),
      estimatedHours: task.estimatedHours ? String(task.estimatedHours) : "",
    },
  });

  const {
    formState: { errors: e },
    control,
    register,
    handleSubmit,
    watch,
    reset,
  } = form;

  const tabErrors = {
    details: !!(e.title || e.description || e.status || e.priority || e.startDate || e.dueDate),
    assignment: !!(e.assigneeValue || e.estimatedHours),
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally gated on open+task.id only
  useEffect(() => {
    if (!open) return;
    reset({
      title: task.title,
      description: task.description || "",
      status: task.status || "todo",
      priority: task.priority || "normal",
      startDate: toDateStr(task.startDate),
      dueDate: toDateStr(task.dueDate),
      assigneeValue: encodeAssignee(task.assigneeId, null),
      estimatedHours: task.estimatedHours ? String(task.estimatedHours) : "",
    });
    setActualHours(task.actualHours ?? null);
    getSubtasks(task.id).then(setSubtasks).catch(console.error);
    getDependencies(task.id)
      .then((d) => setDepPredecessors(d.predecessors))
      .catch(console.error);
    getAllTasksForGantt()
      .then((list) => setAllTasks(list.filter((t) => t.id !== task.id)))
      .catch(console.error);
  }, [open, task.id]);

  const onSubmit = async (data: TaskFormValues) => {
    try {
      setIsSubmitting(true);
      const { ownerId } = decodeAssignee(data.assigneeValue);
      const estHours = data.estimatedHours ? parseFloat(data.estimatedHours) : null;
      const updated = await updateTask(
        task.id,
        {
          title: data.title,
          description: data.description,
          status: data.status,
          priority: data.priority,
          startDate: data.startDate ? new Date(data.startDate) : null,
          dueDate: data.dueDate ? new Date(data.dueDate) : null,
          assigneeId: ownerId ?? null,
          estimatedHours: estHours !== null ? String(estHours) : null,
          // biome-ignore lint/suspicious/noExplicitAny: Drizzle partial insert type
        } as any,
        revalidatePathStr,
      );
      toast.success("Attività aggiornata");
      onUpdated?.(updated);
      setOpen(false);
    } catch {
      toast.error("Aggiornamento fallito");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubtaskToggle = async (sub: Subtask) => {
    const next = sub.status === "done" ? "todo" : "done";
    await updateTaskStatus(sub.id, next, revalidatePathStr);
    setSubtasks((prev) => prev.map((s) => (s.id === sub.id ? { ...s, status: next } : s)));
  };

  const handleSubtaskDelete = async (id: string) => {
    await deleteTask(id, revalidatePathStr);
    setSubtasks((prev) => prev.filter((s) => s.id !== id));
  };

  const handleAddSubtask = async () => {
    if (!newSubtaskTitle.trim()) return;
    try {
      await createSubtask(task.id, { title: newSubtaskTitle.trim() });
      const updated = await getSubtasks(task.id);
      setSubtasks(updated);
      setNewSubtaskTitle("");
      setAddingSubtask(false);
      toast.success("Sotto-attività creata");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Creazione fallita");
    }
  };

  const progress = task.progressPct ?? 0;
  const donePct =
    subtasks.length > 0
      ? Math.round((subtasks.filter((s) => s.status === "done").length / subtasks.length) * 100)
      : progress;

  const currentStatus = watch("status");
  const statusCfg = STATUS_CONFIG[currentStatus as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.todo;
  const StatusIcon = statusCfg.icon;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-6 w-6">
          <PencilIcon className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>

      <DialogContent className="flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-[680px]">
        {/* Header */}
        <DialogHeader className="border-b px-6 pt-6 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <CheckSquare className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate font-semibold text-base">{task.title}</DialogTitle>
              <div className="mt-0.5 flex items-center gap-1.5">
                <StatusIcon className={cn("h-3 w-3", statusCfg.color)} />
                <span className="text-muted-foreground text-xs">{statusCfg.label}</span>
              </div>
            </div>
          </div>
        </DialogHeader>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <Tabs defaultValue="details" className="flex min-h-[420px] flex-col">
              <TabsList className="mb-5 w-full">
                <TabsTrigger value="details" className="relative flex-1 gap-1.5 text-xs">
                  <CheckSquare className="h-3.5 w-3.5" />
                  Dettagli
                  <TabDot has={tabErrors.details} />
                </TabsTrigger>
                <TabsTrigger value="assignment" className="relative flex-1 gap-1.5 text-xs">
                  <Clock className="h-3.5 w-3.5" />
                  Assegnazione
                  <TabDot has={tabErrors.assignment} />
                </TabsTrigger>
                <TabsTrigger value="activity" className="relative flex-1 gap-1.5 text-xs">
                  <Link2 className="h-3.5 w-3.5" />
                  Attività
                </TabsTrigger>
              </TabsList>

              {/* ── Tab 1: Dettagli ──────────────────────────────────────────── */}
              <TabsContent value="details" className="mt-0 space-y-4">
                <F label="Titolo" required error={e.title?.message}>
                  <Input
                    {...register("title")}
                    placeholder="Titolo attività"
                    autoFocus
                    className={cn("text-sm", e.title && "border-destructive")}
                  />
                </F>

                <F label="Descrizione">
                  <Textarea
                    {...register("description")}
                    placeholder="Dettagli…"
                    className="min-h-[80px] resize-y text-sm"
                  />
                </F>

                <div className="grid grid-cols-2 gap-4">
                  <F label="Stato">
                    <Controller
                      control={control}
                      name="status"
                      render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger className="h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(
                              Object.entries(STATUS_CONFIG) as [
                                keyof typeof STATUS_CONFIG,
                                (typeof STATUS_CONFIG)[keyof typeof STATUS_CONFIG],
                              ][]
                            ).map(([key, cfg]) => {
                              const Icon = cfg.icon;
                              return (
                                <SelectItem key={key} value={key}>
                                  <span className="flex items-center gap-2">
                                    <Icon className={cn("h-3.5 w-3.5", cfg.color)} />
                                    {cfg.label}
                                  </span>
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </F>

                  <F label="Priorità">
                    <Controller
                      control={control}
                      name="priority"
                      render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger className="h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(
                              Object.entries(PRIORITY_CONFIG) as [
                                keyof typeof PRIORITY_CONFIG,
                                (typeof PRIORITY_CONFIG)[keyof typeof PRIORITY_CONFIG],
                              ][]
                            ).map(([key, cfg]) => (
                              <SelectItem key={key} value={key}>
                                <span className="flex items-center gap-2">
                                  <span
                                    className="h-2 w-2 shrink-0 rounded-full"
                                    style={{ backgroundColor: cfg.color }}
                                  />
                                  {cfg.label}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </F>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <F label="Data inizio">
                    <Controller
                      control={control}
                      name="startDate"
                      render={({ field }) => (
                        <DatePicker value={field.value} onChange={field.onChange} placeholder="Seleziona data" />
                      )}
                    />
                  </F>
                  <F label="Scadenza">
                    <Controller
                      control={control}
                      name="dueDate"
                      render={({ field }) => (
                        <DatePicker value={field.value} onChange={field.onChange} placeholder="Seleziona data" />
                      )}
                    />
                  </F>
                </div>

                {(subtasks.length > 0 || progress > 0) && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                        Avanzamento
                      </Label>
                      <span className="text-muted-foreground text-xs tabular-nums">{donePct}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          donePct >= 100 ? "bg-emerald-500" : donePct >= 50 ? "bg-blue-500" : "bg-orange-400",
                        )}
                        style={{ width: `${donePct}%` }}
                      />
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* ── Tab 2: Assegnazione ──────────────────────────────────────── */}
              <TabsContent value="assignment" className="mt-0 space-y-4">
                <F label="Assegnato a">
                  <Controller
                    control={control}
                    name="assigneeValue"
                    render={({ field }) => <AssigneeSelect value={field.value ?? null} onChange={field.onChange} />}
                  />
                </F>

                <F label="Ore stimate" error={e.estimatedHours?.message}>
                  <div className="relative">
                    <Clock className="-translate-y-1/2 absolute top-1/2 left-3 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      {...register("estimatedHours")}
                      type="number"
                      min={0}
                      step={0.25}
                      placeholder="0"
                      className="pl-8"
                    />
                  </div>
                </F>

                {users && users.length > 0 && (
                  <div className="space-y-1.5">
                    <Label className="font-medium text-muted-foreground text-xs uppercase tracking-wide">RACI</Label>
                    <MultiAssigneeSelect taskId={task.id} users={users} />
                  </div>
                )}

                {currentUserId && (
                  <div className="space-y-1.5">
                    <Label className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                      Tracciamento tempo
                    </Label>
                    <TaskTimer
                      taskId={task.id}
                      userId={currentUserId}
                      estimatedHours={watch("estimatedHours") || task.estimatedHours || null}
                      actualHours={actualHours}
                      onHoursChanged={() => {
                        getTaskActualHours(task.id)
                          .then((h) => setActualHours(h))
                          .catch(console.error);
                      }}
                    />
                  </div>
                )}
              </TabsContent>

              {/* ── Tab 3: Attività (subtasks + deps) ───────────────────────── */}
              <TabsContent value="activity" className="mt-0 space-y-5">
                {/* Subtasks */}
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setSubtasksOpen((v) => !v)}
                    className="flex w-full items-center gap-1.5 font-medium text-sm transition-colors hover:text-foreground"
                  >
                    {subtasksOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    Sotto-attività
                    {subtasks.length > 0 ? (
                      <span className="font-normal text-muted-foreground text-xs">
                        ({subtasks.filter((s) => s.status === "done").length}/{subtasks.length})
                      </span>
                    ) : (
                      <span className="font-normal text-muted-foreground text-xs">Nessuna</span>
                    )}
                  </button>

                  {subtasksOpen && (
                    <div className="space-y-1 border-muted border-l-2 pl-4">
                      {subtasks.map((sub) => (
                        <div
                          key={sub.id}
                          className="group flex items-center gap-2 rounded px-2 py-1 transition-colors hover:bg-muted/40"
                        >
                          <button
                            type="button"
                            onClick={() => handleSubtaskToggle(sub)}
                            className="shrink-0 text-muted-foreground hover:text-primary"
                          >
                            {sub.status === "done" ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                            ) : (
                              <Circle className="h-3.5 w-3.5" />
                            )}
                          </button>
                          <span
                            className={cn(
                              "min-w-0 flex-1 truncate text-sm",
                              sub.status === "done" && "text-muted-foreground line-through",
                            )}
                          >
                            {sub.title}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleSubtaskDelete(sub.id)}
                            className="shrink-0 text-muted-foreground/40 opacity-0 transition-all hover:text-destructive group-hover:opacity-100"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))}

                      {canAddSubtasks &&
                        (addingSubtask ? (
                          <div className="flex items-center gap-1.5 pt-1">
                            <Input
                              value={newSubtaskTitle}
                              onChange={(ev) => setNewSubtaskTitle(ev.target.value)}
                              onKeyDown={(ev) => {
                                if (ev.key === "Enter") {
                                  ev.preventDefault();
                                  handleAddSubtask();
                                }
                                if (ev.key === "Escape") {
                                  setAddingSubtask(false);
                                  setNewSubtaskTitle("");
                                }
                              }}
                              placeholder="Titolo sotto-attività…"
                              className="h-7 text-xs"
                              autoFocus
                            />
                            <Button type="button" size="sm" className="h-7 px-2 text-xs" onClick={handleAddSubtask}>
                              Aggiungi
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0"
                              onClick={() => {
                                setAddingSubtask(false);
                                setNewSubtaskTitle("");
                              }}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setAddingSubtask(true)}
                            className="flex items-center gap-1 pt-1 text-muted-foreground/60 text-xs transition-colors hover:text-muted-foreground"
                          >
                            <Plus className="h-3 w-3" />
                            Aggiungi sotto-attività
                          </button>
                        ))}

                      {!canAddSubtasks && subtasks.length === 0 && (
                        <p className="py-1 text-muted-foreground/50 text-xs">Profondità massima raggiunta.</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Dependencies */}
                <div className="space-y-2 border-t pt-4">
                  <button
                    type="button"
                    onClick={() => setDepsOpen((v) => !v)}
                    className="flex w-full items-center gap-1.5 font-medium text-sm transition-colors hover:text-foreground"
                  >
                    {depsOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                    Dipendenze
                    {depPredecessors.length > 0 && (
                      <span className="font-normal text-muted-foreground text-xs">({depPredecessors.length})</span>
                    )}
                  </button>

                  {depsOpen && (
                    <div className="space-y-1 border-muted border-l-2 pl-4">
                      {depPredecessors.map((dep) => (
                        <div
                          key={dep.id}
                          className="group flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted/40"
                        >
                          {dep.taskStatus !== "done" && <Lock className="h-3 w-3 shrink-0 text-destructive" />}
                          <span
                            className={cn(
                              "flex-1 truncate",
                              dep.taskStatus === "done" && "text-muted-foreground line-through",
                            )}
                          >
                            {dep.taskTitle}
                          </span>
                          <Badge variant="outline" className="h-4 shrink-0 px-1 py-0 text-[10px]">
                            {dep.type}
                          </Badge>
                          {dep.lagDays !== 0 && (
                            <span className="shrink-0 text-muted-foreground">
                              {dep.lagDays > 0 ? `+${dep.lagDays}d` : `${dep.lagDays}d`}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={async () => {
                              await removeDependency(dep.id);
                              setDepPredecessors((prev) => prev.filter((d) => d.id !== dep.id));
                              toast.success("Dipendenza rimossa");
                            }}
                            className="shrink-0 text-muted-foreground/40 opacity-0 transition-all hover:text-destructive group-hover:opacity-100"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}

                      {depPredecessors.filter((d) => d.taskStatus !== "done").length > 0 && (
                        <p className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-destructive">
                          <Lock className="h-3 w-3" />
                          Bloccata da {depPredecessors.filter((d) => d.taskStatus !== "done").length} attività
                        </p>
                      )}

                      {addingDep ? (
                        <div className="space-y-1.5 pt-1">
                          <Select value={newDepTaskId} onValueChange={setNewDepTaskId}>
                            <SelectTrigger className="h-7 w-full text-xs">
                              <SelectValue placeholder="Seleziona predecessore…" />
                            </SelectTrigger>
                            <SelectContent className="max-h-48">
                              {allTasks
                                .filter((t) => !depPredecessors.some((d) => d.taskId === t.id))
                                .map((t) => (
                                  <SelectItem key={t.id} value={t.id} className="text-xs">
                                    <span className="max-w-[260px] truncate">{t.title}</span>
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                          <div className="flex items-center gap-1.5">
                            <Select value={newDepType} onValueChange={setNewDepType}>
                              <SelectTrigger className="h-7 w-36 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {Object.entries(DEP_TYPE_LABELS).map(([v, l]) => (
                                  <SelectItem key={v} value={v} className="text-xs">
                                    {l}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Input
                              type="number"
                              value={newDepLag}
                              onChange={(ev) => setNewDepLag(ev.target.value)}
                              placeholder="Lag (giorni)"
                              className="h-7 w-20 text-xs"
                            />
                            <Button
                              type="button"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={async () => {
                                if (!newDepTaskId.trim()) return;
                                try {
                                  await addDependency(newDepTaskId.trim(), task.id, newDepType, Number(newDepLag) || 0);
                                  const d = await getDependencies(task.id);
                                  setDepPredecessors(d.predecessors);
                                  setNewDepTaskId("");
                                  setNewDepType("FS");
                                  setNewDepLag("0");
                                  setAddingDep(false);
                                  toast.success("Dipendenza aggiunta");
                                } catch (err: unknown) {
                                  toast.error(err instanceof Error ? err.message : "Aggiunta fallita");
                                }
                              }}
                            >
                              Aggiungi
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0"
                              onClick={() => {
                                setAddingDep(false);
                                setNewDepTaskId("");
                              }}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setAddingDep(true)}
                          className="flex items-center gap-1 pt-1 text-muted-foreground/60 text-xs transition-colors hover:text-muted-foreground"
                        >
                          <Plus className="h-3 w-3" />
                          Aggiungi predecessore
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* Footer */}
          <DialogFooter className="border-t bg-muted/30 px-6 py-4">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Annulla
            </Button>
            <Button type="submit" disabled={isSubmitting} className="min-w-[140px] gap-2">
              {isSubmitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Salvataggio…
                </>
              ) : (
                <>
                  <CheckSquare className="h-3.5 w-3.5" />
                  Salva modifiche
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
