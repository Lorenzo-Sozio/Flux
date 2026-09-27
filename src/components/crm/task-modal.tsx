"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { enUS, it } from "date-fns/locale";
import {
  AlertCircle,
  Building2,
  CalendarDays,
  CalendarIcon,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  Circle,
  Clock,
  Handshake,
  Info,
  LifeBuoy,
  Link2,
  ListChecks,
  ListTree,
  Loader2,
  Lock,
  PencilIcon,
  Plus,
  Target,
  Timer,
  Trash2,
  User,
  X,
} from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Controller, type FieldErrors, useForm } from "react-hook-form";
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
import { EmptyHint, Metric, MetricStrip } from "@/components/crm/record/record-page";
import { RecordVisit } from "@/components/crm/record-visit";
import { TaskDetailHero, type TaskRelatedLink } from "@/components/crm/task-detail-hero";
import { TaskDialogSection, type TaskDialogTab, TaskDialogTabBar } from "@/components/crm/task-detail-parts";
import { TaskTimer } from "@/components/crm/task-timer";
import { TaskTypePicker } from "@/components/crm/task-type-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TASK_TYPES, taskTypeOf } from "@/lib/task-kinds";
import { cn } from "@/lib/utils";

// ─── Config ────────────────────────────────────────────────────────────────────

const PRIORITY_CONFIG = {
  blocker: { labelKey: "priorities.blocker", color: "#dc2626" },
  critical: { labelKey: "priorities.critical", color: "#ea580c" },
  high: { labelKey: "priorities.high", color: "#ef4444" },
  normal: { labelKey: "priorities.normal", color: "#6366f1" },
  low: { labelKey: "priorities.low", color: "#94a3b8" },
} as const;

const STATUS_CONFIG = {
  todo: { labelKey: "statuses.todo", icon: AlertCircle, color: "text-slate-500" },
  in_progress: { labelKey: "statuses.inProgress", icon: Clock, color: "text-blue-500" },
  done: { labelKey: "statuses.done", icon: CheckSquare, color: "text-emerald-500" },
} as const;

// ─── Schema ────────────────────────────────────────────────────────────────────

const taskSchema = z.object({
  type: z.enum(TASK_TYPES).default("todo"),
  title: z.string().min(1, "titleRequired"),
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

// Dependency types; each label is translated at render time under tasks.modal.depTypes.
const DEP_TYPES = ["FS", "SS", "FF", "SF"] as const;

// The dialog's sections, grouped into tabs below lg. Subtasks and dependencies
// share one tab ("Structure"): four labels do not fit a phone's width in Italian,
// and both answer the same question — what this task is made of and waits on.
type SectionTab = "details" | "structure" | "time";

/** How many subtasks or dependencies show before "Show more". */
const LIST_PREVIEW = 5;

const DAY = 86_400_000;

/** Midnight of a date, so "due today" does not turn overdue at 9am. */
const dayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

// ─── Helpers ───────────────────────────────────────────────────────────────────

function toDateStr(date: Date | string | null | undefined): string | undefined {
  if (!date) return undefined;
  return format(new Date(date), "yyyy-MM-dd");
}

function extractTimeStr(date: Date | string | null | undefined, fallback = "09:00"): string {
  if (!date) return fallback;
  const d = new Date(date);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Migration 0019 set allDay=true for all pre-existing tasks regardless of stored times.
// Infer the real state: if either date has a non-midnight time, it's not all-day.
function inferAllDay(allDayFlag: boolean | null | undefined, startDate: unknown, dueDate: unknown): boolean {
  if (allDayFlag === false) return false;
  const s = extractTimeStr(startDate as Date | string | null | undefined, "00:00");
  const d = extractTimeStr(dueDate as Date | string | null | undefined, "00:00");
  if (s !== "00:00" || d !== "00:00") return false;
  return allDayFlag ?? true;
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

/** The thin bar under a figure, as the deal page draws its probability. */
function ProgressHint({ pct }: { pct: number }) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <span className="mt-1 block h-1 w-full max-w-24 overflow-hidden rounded-full bg-muted" aria-hidden>
      <span
        className={cn("block h-full rounded-full", clamped >= 100 ? "bg-emerald-500" : "bg-primary")}
        style={{ width: `${clamped}%` }}
      />
    </span>
  );
}

/** "Add subtask", "Add predecessor": a full-width dashed row, a thumb's height. */
function AddRow({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-10 w-full items-center gap-2 rounded-md border border-dashed px-3 text-muted-foreground text-sm transition-colors hover:bg-muted/50 hover:text-foreground"
    >
      <Plus className="size-4 shrink-0" />
      {children}
    </button>
  );
}

function ShowMoreToggle({ open, hidden, onToggle }: { open: boolean; hidden: number; onToggle: () => void }) {
  const tR = useTranslations("record");
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex min-h-10 w-full items-center justify-center gap-1.5 rounded-md text-muted-foreground text-sm transition-colors hover:bg-muted/50 hover:text-foreground"
    >
      {open ? tR("showLess") : tR("showMore")}
      {!open && (
        <span className="min-w-5 rounded-full bg-muted px-1.5 text-center text-[11px] tabular-nums leading-5">
          {hidden}
        </span>
      )}
      <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden />
    </button>
  );
}

function DatePicker({
  value,
  onChange,
  placeholder,
  timeValue,
  onTimeChange,
  showTime = false,
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  placeholder: string;
  timeValue?: string;
  onTimeChange?: (v: string) => void;
  showTime?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const t = useTranslations("tasks.modal");
  const dateLocale = useLocale() === "it" ? it : enUS;
  const selected = value ? new Date(value) : undefined;

  return (
    <div className="flex gap-1.5">
      <div className="relative flex flex-1 items-center">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex h-9 w-full items-center gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs",
                "transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                selected ? "pr-7" : "",
                !selected && "text-muted-foreground",
              )}
            >
              <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-left">
                {selected ? format(selected, "d MMM yyyy", { locale: dateLocale }) : placeholder}
              </span>
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
              locale={dateLocale}
              captionLayout="dropdown"
            />
          </PopoverContent>
        </Popover>
        {selected && (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            aria-label={t("clearDate")}
            className="absolute right-1.5 rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {showTime && (
        <input
          type="time"
          value={timeValue ?? "09:00"}
          onChange={(e) => onTimeChange?.(e.target.value)}
          className="h-9 w-[90px] shrink-0 rounded-md border border-input bg-transparent px-2 text-sm tabular-nums shadow-xs transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      )}
    </div>
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
  const t = useTranslations("tasks");
  const tc = useTranslations("common");
  const tR = useTranslations("record");
  const tE = useTranslations("entities.types");
  const fmt = useFormatter();
  const dateLocale = useLocale() === "it" ? it : enUS;
  const [open, setOpen] = useState(defaultOpen ?? false);
  const [tab, setTab] = useState<SectionTab>("details");
  const [showAllSubtasks, setShowAllSubtasks] = useState(false);
  const [showAllDeps, setShowAllDeps] = useState(false);
  const sectionsRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [allDay, setAllDay] = useState<boolean>(() => inferAllDay(task.allDay, task.startDate, task.dueDate));
  const [startTime, setStartTime] = useState<string>(() => extractTimeStr(task.startDate, "09:00"));
  const [dueTime, setDueTime] = useState<string>(() => extractTimeStr(task.dueDate, "18:00"));
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [actualHours, setActualHours] = useState<string | null>(task.actualHours ?? null);
  const [depPredecessors, setDepPredecessors] = useState<DepEntry[]>([]);
  const [addingDep, setAddingDep] = useState(false);
  const [newDepTaskId, setNewDepTaskId] = useState("");
  const [newDepType, setNewDepType] = useState("FS");
  const [newDepLag, setNewDepLag] = useState("0");
  const [allTasks, setAllTasks] = useState<{ id: string; title: string }[]>([]);

  const canAddSubtasks = (task.depth ?? 0) < 3;

  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskSchema),
    defaultValues: {
      type: taskTypeOf(task.type),
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
    details: !!(e.title || e.description || e.status || e.priority || e.startDate || e.dueDate || e.assigneeValue),
    time: !!e.estimatedHours,
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally gated on open+task.id only
  useEffect(() => {
    if (!open) return;
    // Every opening starts on the details, where the title is focused.
    setTab("details");
    setShowAllSubtasks(false);
    setShowAllDeps(false);
    reset({
      type: taskTypeOf(task.type),
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
    setAllDay(inferAllDay(task.allDay, task.startDate, task.dueDate));
    setStartTime(extractTimeStr(task.startDate, "09:00"));
    setDueTime(extractTimeStr(task.dueDate, "18:00"));
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
          type: data.type,
          title: data.title,
          description: data.description,
          status: data.status,
          priority: data.priority,
          allDay,
          startDate: data.startDate ? new Date(`${data.startDate}T${allDay ? "00:00" : startTime}`) : null,
          dueDate: data.dueDate ? new Date(`${data.dueDate}T${allDay ? "00:00" : dueTime}`) : null,
          assigneeId: ownerId ?? null,
          estimatedHours: estHours !== null ? String(estHours) : null,
          // biome-ignore lint/suspicious/noExplicitAny: Drizzle partial insert type
        } as any,
        revalidatePathStr,
      );
      toast.success(t("modal.updated"));
      onUpdated?.(updated);
      setOpen(false);
    } catch {
      toast.error(tc("updateError"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const chooseTab = (id: string) => {
    setTab(id as SectionTab);
    // A tab chosen from far down the previous one starts at its own top — but only
    // when the bar is stuck, i.e. has come apart from the top of the block it
    // opens; above that nothing has scrolled and nothing must jump. (RecordSections' rule.)
    const root = sectionsRef.current;
    const bar = barRef.current;
    if (root && bar && bar.getBoundingClientRect().top - root.getBoundingClientRect().top > 1) {
      root.scrollIntoView({ block: "start" });
    }
  };

  // Validation is the schema's, unchanged; this only makes sure the field that
  // failed is on screen. Below lg the other sections are hidden tabs, and a save
  // that did nothing with its error on another tab would look like a dead button.
  const onInvalid = (errors: FieldErrors<TaskFormValues>) => {
    const onlyTime = Object.keys(errors).every((k) => k === "estimatedHours");
    chooseTab(onlyTime ? "time" : "details");
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
      toast.success(t("subtaskCreated"));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : tc("createError"));
    }
  };

  const progress = task.progressPct ?? 0;
  const doneCount = subtasks.filter((s) => s.status === "done").length;
  const donePct = subtasks.length > 0 ? Math.round((doneCount / subtasks.length) * 100) : progress;

  const currentStatus = watch("status");
  const currentPriority = watch("priority");
  const currentTitle = watch("title");
  const currentDueDate = watch("dueDate");
  const currentEstimate = watch("estimatedHours") || task.estimatedHours || null;
  const openDeps = depPredecessors.filter((d) => d.taskStatus !== "done").length;

  // ── Hero: the due date, with how far away it is ──
  const due = (() => {
    if (!currentDueDate) return null;
    const at = new Date(`${currentDueDate}T${allDay ? "00:00" : dueTime}`);
    if (Number.isNaN(at.getTime())) return null;
    return {
      label: format(at, allDay ? "d MMM yyyy" : "d MMM yyyy, HH:mm", { locale: dateLocale }),
      days: currentStatus === "done" ? null : Math.round((dayOf(at) - dayOf(new Date())) / DAY),
    };
  })();

  // ── Hero: the assignee the form currently holds ──
  // ⚠️ Only a person the dialog can name. The picker loads its own list of users
  // and groups; a group, or somebody outside `users`, is left out of the line
  // rather than shown as "Unassigned", which would be a claim about the task.
  const { ownerId: formOwnerId, groupId: formGroupId } = decodeAssignee(watch("assigneeValue"));
  const assigneeName: string | null | undefined = formGroupId
    ? undefined
    : !formOwnerId
      ? null
      : formOwnerId === task.assigneeId
        ? (task.assigneeName ?? undefined)
        : (users?.find((u) => u.id === formOwnerId)?.name ?? undefined);

  // ── Hero: the record this task belongs to ──
  // Only the list pages' queries carry these (with names); the record pages load
  // their tasks without them. A link back to the page the dialog is open on goes
  // nowhere, so it is left out.
  const personName = (first?: string | null, last?: string | null) => [first, last].filter(Boolean).join(" ");
  const related = (
    [
      task.dealId && {
        key: "deal",
        href: `/dashboard/pipeline/${task.dealId}`,
        label: task.dealName || tE("deal.one"),
        icon: <Handshake aria-hidden />,
      },
      task.leadId && {
        key: "lead",
        href: `/dashboard/leads/${task.leadId}`,
        label: personName(task.leadName, task.leadLastName) || tE("lead.one"),
        icon: <Target aria-hidden />,
      },
      task.contactId && {
        key: "contact",
        href: `/dashboard/contacts/${task.contactId}`,
        label: personName(task.contactName, task.contactLastName) || tE("contact.one"),
        icon: <User aria-hidden />,
      },
      task.companyId && {
        key: "company",
        href: `/dashboard/companies/${task.companyId}`,
        label: task.companyName || tE("company.one"),
        icon: <Building2 aria-hidden />,
      },
      task.ticketId && {
        key: "ticket",
        href: `/dashboard/support/tickets/${task.ticketId}`,
        label: task.ticketNumber || task.ticketSubject || tE("ticket.one"),
        icon: <LifeBuoy aria-hidden />,
      },
    ] as (TaskRelatedLink | null | undefined | "" | false)[]
  ).filter((r): r is TaskRelatedLink => !!r && r.href !== revalidatePathStr);

  // ── Figures: only the ones this task has. A strip of dashes is padding. ──
  const parsedHours = (v: unknown) => {
    const n = Number.parseFloat(String(v ?? ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const estimate = parsedHours(currentEstimate);
  const spent = parsedHours(actualHours);
  const hoursText = (n: number) => fmt.number(n, { maximumFractionDigits: 2 });

  const figures: ReactNode[] = [];
  if (subtasks.length > 0) {
    figures.push(
      <Metric key="subtasks" label={t("subtasks")} hint={<ProgressHint pct={donePct} />}>
        {doneCount}/{subtasks.length}
      </Metric>,
    );
  } else if (progress > 0) {
    figures.push(
      <Metric key="progress" label={t("modal.progress")} hint={<ProgressHint pct={progress} />}>
        {progress}%
      </Metric>,
    );
  }
  if (estimate != null || spent != null) {
    figures.push(
      <Metric
        key="time"
        label={t("modal.hero.timeSpent")}
        tone={estimate != null && spent != null && spent > estimate ? "danger" : undefined}
        hint={
          estimate != null ? t("modal.hero.ofEstimate", { hours: hoursText(estimate) }) : t("modal.hero.noEstimate")
        }
      >
        {t("modal.hero.hours", { hours: hoursText(spent ?? 0) })}
      </Metric>,
    );
  }
  if (depPredecessors.length > 0) {
    figures.push(
      <Metric
        key="deps"
        label={t("modal.dependencies")}
        tone={openDeps > 0 ? "danger" : undefined}
        hint={openDeps > 0 ? t("modal.blockedBy", { count: openDeps }) : t("modal.hero.depsDone")}
      >
        {depPredecessors.length}
      </Metric>,
    );
  }

  const tabs: TaskDialogTab[] = [
    { id: "details", label: tR("tabs.details"), icon: <Info aria-hidden />, error: tabErrors.details },
    {
      id: "structure",
      label: t("modal.tabActivity"),
      icon: <ListTree aria-hidden />,
      count: subtasks.length + depPredecessors.length,
    },
    { id: "time", label: t("modal.sections.time"), icon: <Timer aria-hidden />, error: tabErrors.time },
  ];

  const visibleSubtasks = showAllSubtasks ? subtasks : subtasks.slice(0, LIST_PREVIEW);
  const visibleDeps = showAllDeps ? depPredecessors : depPredecessors.slice(0, LIST_PREVIEW);

  // ── Sections ──
  const detailsSection = (
    <TaskDialogSection title={tR("detailsTitle")} icon={<Info aria-hidden />} framed hidden={tab !== "details"}>
      <div className="space-y-4">
        <Controller
          control={control}
          name="type"
          render={({ field }) => <TaskTypePicker value={field.value} onChange={field.onChange} />}
        />
        <F label={t("dialog.titleLabel")} required error={e.title ? t("modal.titleRequired") : undefined}>
          <Input
            {...register("title")}
            placeholder={t("dialog.titlePlaceholder")}
            autoFocus
            className={cn("text-sm", e.title && "border-destructive")}
          />
        </F>

        <F label={t("dialog.description")}>
          <Textarea
            {...register("description")}
            placeholder={t("form.descriptionPlaceholder")}
            className="min-h-[80px] resize-y text-sm"
          />
        </F>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <F label={t("dialog.status")}>
            <Controller
              control={control}
              name="status"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="h-9 w-full">
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
                            {t(cfg.labelKey)}
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              )}
            />
          </F>

          <F label={t("dialog.priority")}>
            <Controller
              control={control}
              name="priority"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="h-9 w-full">
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
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: cfg.color }} />
                          {t(cfg.labelKey)}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </F>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAllDay((v) => !v)}
            aria-pressed={allDay}
            className={cn(
              "flex min-h-9 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors",
              allDay
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-input bg-transparent text-muted-foreground hover:bg-accent/50",
            )}
          >
            <CalendarDays className="h-3.5 w-3.5" />
            {t("modal.allDay")}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <F label={t("dialog.startDate")}>
            <Controller
              control={control}
              name="startDate"
              render={({ field }) => (
                <DatePicker
                  value={field.value}
                  onChange={field.onChange}
                  placeholder={t("modal.selectDate")}
                  showTime={!allDay}
                  timeValue={startTime}
                  onTimeChange={setStartTime}
                />
              )}
            />
          </F>
          <F label={t("dialog.dueDate")}>
            <Controller
              control={control}
              name="dueDate"
              render={({ field }) => (
                <DatePicker
                  value={field.value}
                  onChange={field.onChange}
                  placeholder={t("modal.selectDate")}
                  showTime={!allDay}
                  timeValue={dueTime}
                  onTimeChange={setDueTime}
                />
              )}
            />
          </F>
        </div>

        <F label={t("columns.assignee")}>
          <Controller
            control={control}
            name="assigneeValue"
            render={({ field }) => (
              <AssigneeSelect value={field.value ?? null} onChange={field.onChange} allowGroups={false} />
            )}
          />
        </F>

        {users && users.length > 0 && (
          <div className="space-y-1.5">
            <Label className="font-medium text-muted-foreground text-xs uppercase tracking-wide">RACI</Label>
            <MultiAssigneeSelect taskId={task.id} users={users} />
          </div>
        )}
      </div>
    </TaskDialogSection>
  );

  const subtasksSection = (
    <TaskDialogSection
      title={t("subtasks")}
      icon={<ListChecks aria-hidden />}
      aside={subtasks.length > 0 ? `${doneCount}/${subtasks.length}` : undefined}
      framed
      hidden={tab !== "structure"}
    >
      {subtasks.length === 0 ? (
        <EmptyHint>{canAddSubtasks ? t("dialog.subtasks.empty") : t("maxDepth")}</EmptyHint>
      ) : (
        <ul className="divide-y">
          {visibleSubtasks.map((sub) => {
            const done = sub.status === "done";
            return (
              <li key={sub.id} className="flex items-center gap-2 py-1">
                <button
                  type="button"
                  onClick={() => handleSubtaskToggle(sub)}
                  aria-label={done ? t("markIncomplete") : t("markComplete")}
                  className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-primary max-md:size-10"
                >
                  {done ? (
                    <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <Circle className="size-4" />
                  )}
                </button>
                <span
                  className={cn("min-w-0 flex-1 break-words text-sm", done && "text-muted-foreground line-through")}
                >
                  {sub.title}
                </span>
                {/* Always drawn, muted: a delete that appears on hover does not exist on a phone. */}
                <button
                  type="button"
                  onClick={() => handleSubtaskDelete(sub.id)}
                  aria-label={tc("delete")}
                  className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-destructive max-md:size-10"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {subtasks.length > LIST_PREVIEW && (
        <ShowMoreToggle
          open={showAllSubtasks}
          hidden={subtasks.length - LIST_PREVIEW}
          onToggle={() => setShowAllSubtasks((v) => !v)}
        />
      )}

      {canAddSubtasks &&
        (addingSubtask ? (
          <div className="flex items-center gap-2">
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
              placeholder={t("subtaskPlaceholder")}
              aria-label={t("subtaskPlaceholder")}
              className="min-w-0 flex-1 text-sm"
              autoFocus
            />
            <Button type="button" className="shrink-0 max-md:h-11" onClick={handleAddSubtask}>
              {tc("add")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0 max-md:size-11"
              aria-label={tc("cancel")}
              onClick={() => {
                setAddingSubtask(false);
                setNewSubtaskTitle("");
              }}
            >
              <X className="size-4" />
            </Button>
          </div>
        ) : (
          <AddRow onClick={() => setAddingSubtask(true)}>{t("addSubtask")}</AddRow>
        ))}
    </TaskDialogSection>
  );

  const dependenciesSection = (
    <TaskDialogSection
      title={t("modal.dependencies")}
      icon={<Link2 aria-hidden />}
      aside={depPredecessors.length > 0 ? depPredecessors.length : undefined}
      framed
      hidden={tab !== "structure"}
    >
      {depPredecessors.length > 0 && (
        <ul className="divide-y">
          {visibleDeps.map((dep) => {
            const done = dep.taskStatus === "done";
            return (
              <li key={dep.id} className="flex items-center gap-2 py-1 text-sm">
                <span className="flex size-8 shrink-0 items-center justify-center max-md:size-10" aria-hidden>
                  {done ? (
                    <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <Lock className="size-3.5 text-destructive" />
                  )}
                </span>
                <span className={cn("min-w-0 flex-1 break-words", done && "text-muted-foreground line-through")}>
                  {dep.taskTitle}
                </span>
                <Badge
                  variant="outline"
                  className="shrink-0 px-1.5 text-[10px]"
                  title={DEP_TYPES.includes(dep.type as never) ? t(`modal.depTypes.${dep.type}`) : undefined}
                >
                  {dep.type}
                </Badge>
                {dep.lagDays !== 0 && (
                  <span className="shrink-0 text-muted-foreground text-xs">
                    {t("modal.lagDays", { n: dep.lagDays > 0 ? `+${dep.lagDays}` : String(dep.lagDays) })}
                  </span>
                )}
                <button
                  type="button"
                  onClick={async () => {
                    await removeDependency(dep.id);
                    setDepPredecessors((prev) => prev.filter((d) => d.id !== dep.id));
                    toast.success(t("modal.dependencyRemoved"));
                  }}
                  aria-label={tc("delete")}
                  className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-destructive max-md:size-10"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {depPredecessors.length > LIST_PREVIEW && (
        <ShowMoreToggle
          open={showAllDeps}
          hidden={depPredecessors.length - LIST_PREVIEW}
          onToggle={() => setShowAllDeps((v) => !v)}
        />
      )}

      {openDeps > 0 && (
        <p className="flex items-center gap-1.5 font-medium text-destructive text-xs">
          <Lock className="size-3 shrink-0" />
          {t("modal.blockedBy", { count: openDeps })}
        </p>
      )}

      {addingDep ? (
        <div className="space-y-2 rounded-md border p-3">
          <Select value={newDepTaskId} onValueChange={setNewDepTaskId}>
            <SelectTrigger className="w-full text-sm">
              <SelectValue placeholder={t("modal.selectPredecessor")} />
            </SelectTrigger>
            <SelectContent className="max-h-48">
              {allTasks
                .filter((t) => !depPredecessors.some((d) => d.taskId === t.id))
                .map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    <span className="max-w-[260px] truncate">{t.title}</span>
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Select value={newDepType} onValueChange={setNewDepType}>
              <SelectTrigger className="w-full text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DEP_TYPES.map((v) => (
                  <SelectItem key={v} value={v}>
                    {t(`modal.depTypes.${v}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="number"
              value={newDepLag}
              onChange={(ev) => setNewDepLag(ev.target.value)}
              placeholder={t("modal.lagPlaceholder")}
              aria-label={t("modal.lagPlaceholder")}
              className="min-w-0 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              className="max-sm:flex-1 max-md:h-11"
              onClick={() => {
                setAddingDep(false);
                setNewDepTaskId("");
              }}
            >
              {tc("cancel")}
            </Button>
            <Button
              type="button"
              className="max-sm:flex-1 max-md:h-11"
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
                  toast.success(t("modal.dependencyAdded"));
                } catch (err: unknown) {
                  toast.error(err instanceof Error ? err.message : t("modal.dependencyAddFailed"));
                }
              }}
            >
              {tc("add")}
            </Button>
          </div>
        </div>
      ) : (
        <AddRow onClick={() => setAddingDep(true)}>{t("modal.addPredecessor")}</AddRow>
      )}
    </TaskDialogSection>
  );

  const timeSection = (
    <TaskDialogSection title={t("modal.sections.time")} icon={<Timer aria-hidden />} framed hidden={tab !== "time"}>
      <div className="space-y-4">
        <F label={t("dialog.estimatedHours")} error={e.estimatedHours?.message}>
          <div className="relative">
            <Clock className="-translate-y-1/2 absolute top-1/2 left-3 h-3.5 w-3.5 text-muted-foreground" />
            <Input {...register("estimatedHours")} type="number" min={0} step={0.25} placeholder="0" className="pl-8" />
          </div>
        </F>

        {currentUserId && (
          <div className="space-y-1.5">
            <Label className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
              {t("modal.timeTracking")}
            </Label>
            <TaskTimer
              taskId={task.id}
              userId={currentUserId}
              estimatedHours={currentEstimate}
              actualHours={actualHours}
              onHoursChanged={() => {
                getTaskActualHours(task.id)
                  .then((h) => setActualHours(h))
                  .catch(console.error);
              }}
            />
          </div>
        )}
      </div>
    </TaskDialogSection>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {/* 24px is a mouse target; below `md` it is a finger's (36px). */}
        <Button variant="ghost" size="icon" className="h-6 w-6 max-md:size-9" aria-label={t("editTask")}>
          <PencilIcon className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>

      {/*
        One task, laid out like a record page inside a dialog: the hero (state,
        title, who and where, the figures), then the sections. From lg they sit in
        two columns — the details as the work, structure and time beside them —
        and below lg one tab at a time behind a sticky segmented bar.

        On a phone DialogContent is already the whole screen, pinned inside the
        safe area. The hero scrolls away with the body; the bar sticks; the
        footer is outside the scroll, so Save is always one tap away.
      */}
      <DialogContent className="flex flex-col gap-0 p-0 sm:max-w-[680px] lg:max-w-[960px]">
        {open && task?.id && <RecordVisit type="task" id={task.id} label={task.title ?? ""} />}

        <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <DialogHeader className="gap-0 border-b px-4 pt-5 pb-4 md:px-6 md:pt-6">
              <TaskDetailHero
                title={currentTitle || task.title}
                status={currentStatus}
                priority={currentPriority}
                due={due}
                related={related}
                assignee={assigneeName}
              >
                {figures.length > 0 && (
                  // Two per row on a phone: an odd last figure takes the whole row
                  // rather than leaving a grey hole beside it.
                  <div className="max-sm:[&>dl>*:last-child:nth-child(odd)]:col-span-2">
                    <MetricStrip>{figures}</MetricStrip>
                  </div>
                )}
              </TaskDetailHero>
            </DialogHeader>

            <div ref={sectionsRef} className="min-w-0">
              <div
                ref={barRef}
                className="sticky top-0 z-20 border-b bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:px-6 lg:hidden"
              >
                <TaskDialogTabBar tabs={tabs} active={tab} onChange={chooseTab} label={tR("sectionsLabel")} />
              </div>

              {/* Below lg both columns are `contents`, so their sections become rows
                  of the one grid and a hidden one leaves no gap. The minimum height
                  keeps the centred dialog from jumping as the tabs change. */}
              <div className="grid min-w-0 grid-cols-1 items-start gap-6 px-4 py-5 sm:max-lg:min-h-[420px] md:px-6 lg:grid-cols-5">
                <div className="min-w-0 max-lg:contents lg:col-span-3">{detailsSection}</div>
                <div className="min-w-0 max-lg:contents lg:col-span-2 lg:flex lg:flex-col lg:gap-6">
                  {subtasksSection}
                  {dependenciesSection}
                  {timeSection}
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          {/* Side by side on a phone too: stacked, the two buttons took a sixth of the screen from the form. */}
          <DialogFooter className="border-t bg-muted/30 px-4 py-3 max-sm:flex-row md:px-6 md:py-4">
            <Button
              type="button"
              variant="outline"
              className="max-sm:h-11 max-sm:flex-1"
              onClick={() => setOpen(false)}
            >
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={isSubmitting} className="min-w-[140px] gap-2 max-sm:h-11 max-sm:flex-1">
              {isSubmitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {tc("saving")}
                </>
              ) : (
                <>
                  <CheckSquare className="h-3.5 w-3.5" />
                  {t("modal.saveChanges")}
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
