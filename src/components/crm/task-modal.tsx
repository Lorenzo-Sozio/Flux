"use client";

import { useEffect, useState } from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock,
  Link2,
  Loader2Icon,
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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const PRIORITY_CLASS: Record<string, string> = {
  blocker: "bg-red-600 text-white",
  critical: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  high: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  normal: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  low: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

const taskSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  priority: z.string().default("normal"),
  dueDate: z.string().optional(),
  assigneeValue: z.string().optional(),
  estimatedHours: z.string().optional(),
});

type TaskFormValues = z.infer<typeof taskSchema>;

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
  FS: "Finish→Start",
  SS: "Start→Start",
  FF: "Finish→Finish",
  SF: "Start→Finish",
};

export function TaskModal({
  task,
  users,
  currentUserId,
  revalidatePathStr,
  onUpdated,
}: {
  task: any;
  users?: { id: string; name: string | null }[];
  currentUserId?: string;
  revalidatePathStr: string;
  onUpdated?: (updated: any) => void;
}) {
  const [open, setOpen] = useState(false);
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

  const formatDateTime = (date: Date | string | null) => {
    if (!date) return "";
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskSchema),
    defaultValues: {
      title: task.title,
      description: task.description || "",
      priority: task.priority || "normal",
      dueDate: formatDateTime(task.dueDate),
      assigneeValue: encodeAssignee(task.assigneeId, null),
      estimatedHours: task.estimatedHours ? String(task.estimatedHours) : "",
    },
  });

  useEffect(() => {
    if (!open) return;
    getSubtasks(task.id)
      .then(setSubtasks)
      // biome-ignore lint/suspicious/noEmptyBlockStatements: swallow fetch errors
      .catch(() => {});
    getDependencies(task.id)
      .then((d) => setDepPredecessors(d.predecessors))
      // biome-ignore lint/suspicious/noEmptyBlockStatements: swallow fetch errors
      .catch(() => {});
    getAllTasksForGantt()
      .then((list) => setAllTasks(list.filter((t) => t.id !== task.id)))
      // biome-ignore lint/suspicious/noEmptyBlockStatements: swallow fetch errors
      .catch(() => {});
    setActualHours(task.actualHours ?? null);
  }, [open, task.id, task.actualHours]);

  const onSubmit = async (data: TaskFormValues) => {
    try {
      setIsSubmitting(true);
      const { ownerId } = decodeAssignee(data.assigneeValue);
      const estHours = data.estimatedHours ? parseFloat(data.estimatedHours) : null;
      const payload = {
        title: data.title,
        description: data.description,
        priority: data.priority,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        assigneeId: ownerId ?? null,
        estimatedHours: estHours !== null ? String(estHours) : null,
      };
      const updated = await updateTask(task.id, payload as any, revalidatePathStr);
      toast.success("Task updated successfully!");
      onUpdated?.(updated);
      setOpen(false);
    } catch {
      toast.error("Failed to update task.");
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
      toast.success("Subtask created.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to create subtask.");
    }
  };

  const progress = task.progressPct ?? 0;
  const donePct =
    subtasks.length > 0
      ? Math.round((subtasks.filter((s) => s.status === "done").length / subtasks.length) * 100)
      : progress;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-6 w-6">
          <PencilIcon className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[90vh] flex-col p-0 sm:max-w-[540px]">
        <DialogHeader className="shrink-0 border-b px-6 pt-6 pb-3">
          <DialogTitle>Edit Task</DialogTitle>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
            {/* Title */}
            <div className="space-y-1.5">
              <label className="font-medium text-sm">Title</label>
              <Input {...form.register("title")} placeholder="Task title" />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <label className="font-medium text-sm">Description</label>
              <Textarea
                {...form.register("description")}
                placeholder="Details..."
                className="min-h-[60px] resize-none"
              />
            </div>

            {/* Priority + Assign */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="font-medium text-sm">Priority</label>
                <Select
                  onValueChange={(val) => form.setValue("priority", val)}
                  defaultValue={form.getValues("priority")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Priority" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="blocker">
                      <Badge className={cn("h-4 px-1.5 py-0 text-[10px]", PRIORITY_CLASS.blocker)}>Blocker</Badge>
                    </SelectItem>
                    <SelectItem value="critical">
                      <Badge variant="outline" className={cn("h-4 px-1.5 py-0 text-[10px]", PRIORITY_CLASS.critical)}>
                        Critical
                      </Badge>
                    </SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="font-medium text-sm">Quick Assign</label>
                <Controller
                  control={form.control}
                  name="assigneeValue"
                  render={({ field }) => <AssigneeSelect value={field.value ?? null} onChange={field.onChange} />}
                />
              </div>
            </div>

            {/* Due Date + Estimated Hours */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="font-medium text-sm">Due Date & Time</label>
                <Input {...form.register("dueDate")} type="datetime-local" />
              </div>
              <div className="space-y-1.5">
                <label className="font-medium text-sm">Estimated Hours</label>
                <Input
                  {...form.register("estimatedHours")}
                  type="number"
                  step="0.25"
                  min="0"
                  placeholder="e.g. 4"
                  className="h-9"
                />
              </div>
            </div>

            {/* Progress bar */}
            {(subtasks.length > 0 || progress > 0) && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-muted-foreground">Progress</span>
                  <span className="text-muted-foreground tabular-nums">{donePct}%</span>
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

            <div className="border-t pt-3" />

            {/* Subtasks */}
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setSubtasksOpen((v) => !v)}
                className="flex w-full items-center gap-1.5 font-medium text-sm transition-colors hover:text-foreground"
              >
                {subtasksOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                Subtasks
                {subtasks.length > 0 && (
                  <span className="font-normal text-muted-foreground text-xs">
                    ({subtasks.filter((s) => s.status === "done").length}/{subtasks.length})
                  </span>
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
                          onChange={(e) => setNewSubtaskTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleAddSubtask();
                            }
                            if (e.key === "Escape") {
                              setAddingSubtask(false);
                              setNewSubtaskTitle("");
                            }
                          }}
                          placeholder="Subtask title…"
                          className="h-7 text-xs"
                          autoFocus
                        />
                        <Button type="button" size="sm" className="h-7 px-2 text-xs" onClick={handleAddSubtask}>
                          Add
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => {
                            setAddingSubtask(false);
                            setNewSubtaskTitle("");
                          }}
                        >
                          ✕
                        </Button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setAddingSubtask(true)}
                        className="flex items-center gap-1 pt-1 text-muted-foreground/60 text-xs transition-colors hover:text-muted-foreground"
                      >
                        <Plus className="h-3 w-3" />
                        Add subtask
                      </button>
                    ))}

                  {!canAddSubtasks && subtasks.length === 0 && (
                    <p className="py-1 text-muted-foreground/50 text-xs">Max depth reached.</p>
                  )}
                </div>
              )}
            </div>

            {/* RACI Assignees */}
            {users && users.length > 0 && (
              <>
                <div className="border-t pt-3" />
                <MultiAssigneeSelect taskId={task.id} users={users} />
              </>
            )}

            {/* Dependencies */}

            <div className="border-t pt-3" />
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setDepsOpen((v) => !v)}
                className="flex w-full items-center gap-1.5 font-medium text-sm transition-colors hover:text-foreground"
              >
                {depsOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                Dependencies
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
                          toast.success("Dependency removed.");
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
                      Blocked by {depPredecessors.filter((d) => d.taskStatus !== "done").length} incomplete task(s)
                    </p>
                  )}

                  {addingDep ? (
                    <div className="space-y-1.5 pt-1">
                      <Select value={newDepTaskId} onValueChange={setNewDepTaskId}>
                        <SelectTrigger className="h-7 w-full text-xs" autoFocus>
                          <SelectValue placeholder="Select predecessor task…" />
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
                          onChange={(e) => setNewDepLag(e.target.value)}
                          placeholder="Lag (days)"
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
                              toast.success("Dependency added.");
                            } catch (e: unknown) {
                              toast.error(e instanceof Error ? e.message : "Failed to add dependency.");
                            }
                          }}
                        >
                          Add
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => {
                            setAddingDep(false);
                            setNewDepTaskId("");
                          }}
                        >
                          ✕
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
                      Add predecessor
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Time Tracking */}
            {currentUserId && (
              <>
                <div className="border-t pt-3" />
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 font-medium text-sm">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    Time Tracking
                  </div>
                  <TaskTimer
                    taskId={task.id}
                    userId={currentUserId}
                    estimatedHours={form.watch("estimatedHours") || task.estimatedHours || null}
                    actualHours={actualHours}
                    onHoursChanged={() => {
                      getTaskActualHours(task.id)
                        .then((h) => setActualHours(h))
                        // biome-ignore lint/suspicious/noEmptyBlockStatements: swallow fire-and-forget error
                        .catch(() => {});
                    }}
                  />
                </div>
              </>
            )}
          </div>

          <DialogFooter className="shrink-0 border-t px-6 py-4">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
