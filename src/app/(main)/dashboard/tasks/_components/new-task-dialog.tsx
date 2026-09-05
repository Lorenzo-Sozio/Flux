"use client";

import { useState } from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import {
  AlertCircle,
  Building2,
  CalendarDays,
  CalendarIcon,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronsUpDown,
  Clock,
  Flame,
  Headphones,
  Kanban,
  Link2,
  ListChecks,
  Loader2,
  Plus,
  Trash2,
  TrendingUp,
  User,
  UserCircle,
  UserSearch,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { createTask } from "@/actions/tasks";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// ─── Schema ────────────────────────────────────────────────────────────────────

const schema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(["todo", "in_progress", "done"]).default("todo"),
  priority: z.enum(["low", "normal", "high", "critical", "blocker"]).default("normal"),
  startDate: z.string().optional(),
  dueDate: z.string().optional(),
  assigneeId: z.string().optional(),
  estimatedHours: z.coerce.number().min(0).optional().nullable(),
  parentId: z.string().optional(),
  leadId: z.string().optional(),
  contactId: z.string().optional(),
  companyId: z.string().optional(),
  dealId: z.string().optional(),
  ticketId: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

// ─── Helpers ───────────────────────────────────────────────────────────────────

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

type EntityType = "contact" | "company" | "lead" | "deal" | "ticket";
type EntityOption = { id: string; label: string; sub?: string };

const ENTITY_TYPES: { value: EntityType; label: string; icon: React.ElementType }[] = [
  { value: "contact", label: "Contatto", icon: UserCircle },
  { value: "company", label: "Azienda", icon: Building2 },
  { value: "lead", label: "Lead", icon: UserSearch },
  { value: "deal", label: "Trattativa", icon: Kanban },
  { value: "ticket", label: "Ticket", icon: Headphones },
];

function EntityPicker({
  entityType,
  onTypeChange,
  options,
  selectedId,
  onSelect,
}: {
  entityType: EntityType;
  onTypeChange: (t: EntityType) => void;
  options: EntityOption[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const selected = options.find((o) => o.id === selectedId) ?? null;
  const TypeIcon = ENTITY_TYPES.find((t) => t.value === entityType)?.icon ?? UserCircle;
  const typeLabel = ENTITY_TYPES.find((t) => t.value === entityType)?.label ?? "";

  return (
    <div className="space-y-2">
      {/* Type toggle */}
      <div className="flex overflow-hidden rounded-md border font-medium text-xs">
        {ENTITY_TYPES.map((et) => {
          const Icon = et.icon;
          const active = entityType === et.value;
          return (
            <button
              key={et.value}
              type="button"
              onClick={() => {
                onTypeChange(et.value);
                onSelect(null);
                setPopoverOpen(false);
              }}
              className={cn(
                "flex flex-1 select-none items-center justify-center gap-1 py-1.5 transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                "not-last:border-r",
              )}
            >
              <Icon className="h-3 w-3 shrink-0" />
              <span className="hidden sm:inline">{et.label}</span>
            </button>
          );
        })}
      </div>

      {/* Searchable picker */}
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            role="combobox"
            aria-expanded={popoverOpen}
            className={cn(
              "flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs",
              "transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            )}
          >
            {selected ? (
              <span className="flex min-w-0 items-center gap-2">
                <TypeIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate font-medium">{selected.label}</span>
                {selected.sub && <span className="truncate text-muted-foreground text-xs">{selected.sub}</span>}
              </span>
            ) : (
              <span className="text-muted-foreground">Cerca {typeLabel.toLowerCase()}…</span>
            )}
            <div className="ml-2 flex shrink-0 items-center gap-1">
              {selected && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(null);
                  }}
                  className="rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command>
            <CommandInput placeholder={`Cerca ${typeLabel.toLowerCase()}…`} />
            <CommandList>
              <CommandEmpty>Nessun risultato.</CommandEmpty>
              <CommandGroup>
                {options.map((opt) => (
                  <CommandItem
                    key={opt.id}
                    value={`${opt.label} ${opt.sub ?? ""}`}
                    onSelect={() => {
                      onSelect(opt.id === selectedId ? null : opt.id);
                      setPopoverOpen(false);
                    }}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{opt.label}</span>
                      {opt.sub && <span className="truncate text-muted-foreground text-xs">{opt.sub}</span>}
                    </span>
                    <Check className={cn("h-4 w-4 shrink-0", opt.id === selectedId ? "opacity-100" : "opacity-0")} />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
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
                {selected ? format(selected, "d MMM yyyy", { locale: it }) : placeholder}
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
              locale={it}
              captionLayout="dropdown"
            />
          </PopoverContent>
        </Popover>
        {selected && (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            aria-label="Cancella data"
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

// ─── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  users: { id: string; name: string | null }[];
  tasks: { id: string; title: string; depth: number }[];
  leads: { id: string; firstName: string; lastName: string }[];
  contacts: { id: string; firstName: string; lastName: string }[];
  companies: { id: string; name: string }[];
  deals: { id: string; name: string }[];
  tickets: { id: string; ticketNumber: string; subject: string }[];
  currentUserId: string;
  onCreated: () => void;
  defaultTicketId?: string;
}

// ─── Component ─────────────────────────────────────────────────────────────────

type SubtaskDraft = {
  _id: string;
  title: string;
  description: string;
  priority: string;
  estimatedHours: string;
  assigneeId: string;
  startDate: string;
  dueDate: string;
};

function newSubtask(): SubtaskDraft {
  return {
    _id: crypto.randomUUID(),
    title: "",
    description: "",
    priority: "normal",
    estimatedHours: "",
    assigneeId: "_none",
    startDate: "",
    dueDate: "",
  };
}

export function NewTaskDialog({
  users,
  tasks,
  leads,
  contacts,
  companies,
  deals,
  tickets,
  currentUserId,
  onCreated,
  defaultTicketId,
}: Props) {
  const t = useTranslations("tasks");
  const [open, setOpen] = useState(false);
  const [allDay, setAllDay] = useState(true);
  const [startTime, setStartTime] = useState("09:00");
  const [dueTime, setDueTime] = useState("18:00");
  const [entityType, setEntityType] = useState<EntityType>(defaultTicketId ? "ticket" : "contact");
  const [subtasks, setSubtasks] = useState<SubtaskDraft[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpanded = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const updateSubtask = <K extends keyof SubtaskDraft>(id: string, key: K, value: SubtaskDraft[K]) =>
    setSubtasks((prev) => prev.map((s) => (s._id === id ? { ...s, [key]: value } : s)));

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: "",
      description: "",
      status: "todo",
      priority: "normal",
      startDate: "",
      dueDate: "",
      assigneeId: "_none",
      estimatedHours: null,
      parentId: "_none",
      leadId: undefined,
      contactId: undefined,
      companyId: undefined,
      dealId: undefined,
      ticketId: defaultTicketId ?? undefined,
    },
  });

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
    setValue,
    watch,
  } = form;
  const e = errors;

  const tabErrors = {
    details: !!(e.title || e.description || e.status || e.priority || e.startDate || e.dueDate),
    assignment: !!(e.assigneeId || e.estimatedHours),
    links: !!(e.parentId || e.leadId || e.contactId || e.companyId || e.dealId),
  };

  // Current selected entity id based on active type
  const selectedEntityId =
    entityType === "contact"
      ? (watch("contactId") ?? null)
      : entityType === "company"
        ? (watch("companyId") ?? null)
        : entityType === "lead"
          ? (watch("leadId") ?? null)
          : entityType === "deal"
            ? (watch("dealId") ?? null)
            : (watch("ticketId") ?? null);

  const handleEntitySelect = (id: string | null) => {
    setValue("contactId", undefined);
    setValue("companyId", undefined);
    setValue("leadId", undefined);
    setValue("dealId", undefined);
    setValue("ticketId", undefined);
    if (id) {
      if (entityType === "contact") setValue("contactId", id);
      else if (entityType === "company") setValue("companyId", id);
      else if (entityType === "lead") setValue("leadId", id);
      else if (entityType === "deal") setValue("dealId", id);
      else setValue("ticketId", id);
    }
  };

  const entityOptions: EntityOption[] =
    entityType === "contact"
      ? contacts.map((c) => ({ id: c.id, label: `${c.firstName} ${c.lastName}` }))
      : entityType === "company"
        ? companies.map((co) => ({ id: co.id, label: co.name }))
        : entityType === "lead"
          ? leads.map((l) => ({ id: l.id, label: `${l.firstName} ${l.lastName}` }))
          : entityType === "deal"
            ? deals.map((d) => ({ id: d.id, label: d.name }))
            : tickets.map((tk) => ({ id: tk.id, label: `#${tk.ticketNumber}`, sub: tk.subject }));

  const onSubmit = async (data: FormValues) => {
    try {
      const parent = await createTask({
        title: data.title,
        description: data.description || undefined,
        status: data.status,
        priority: data.priority,
        allDay,
        startDate: data.startDate ? new Date(`${data.startDate}T${allDay ? "00:00" : startTime}`) : undefined,
        dueDate: data.dueDate ? new Date(`${data.dueDate}T${allDay ? "00:00" : dueTime}`) : undefined,
        ownerId: currentUserId,
        assigneeId: data.assigneeId && data.assigneeId !== "_none" ? data.assigneeId : undefined,
        estimatedHours: data.estimatedHours != null ? String(data.estimatedHours) : undefined,
        parentId: data.parentId && data.parentId !== "_none" ? data.parentId : undefined,
        leadId: data.leadId || undefined,
        contactId: data.contactId || undefined,
        companyId: data.companyId || undefined,
        dealId: data.dealId || undefined,
        ticketId: data.ticketId || undefined,
      });

      const validSubtasks = subtasks.filter((s) => s.title.trim());
      if (validSubtasks.length > 0) {
        await Promise.all(
          validSubtasks.map((s) =>
            createTask({
              title: s.title.trim(),
              description: s.description.trim() || undefined,
              priority: s.priority,
              ownerId: currentUserId,
              assigneeId: s.assigneeId !== "_none" ? s.assigneeId : undefined,
              estimatedHours: s.estimatedHours || undefined,
              startDate: s.startDate ? new Date(s.startDate) : undefined,
              dueDate: s.dueDate ? new Date(s.dueDate) : undefined,
              parentId: parent.id,
              status: "todo",
            }),
          ),
        );
      }

      toast.success(t("createSuccess"));
      setOpen(false);
      form.reset();
      setSubtasks([]);
      setExpandedIds(new Set());
      onCreated();
    } catch {
      toast.error(t("dialog.saveFailed"));
    }
  };

  const parentTaskOptions = [
    { value: "_none", label: t("dialog.noParent") },
    ...tasks.filter((tk) => tk.depth <= 2).map((tk) => ({ value: tk.id, label: tk.title })),
  ];

  const userOptions = [
    { value: "_none", label: t("dialog.unassigned") },
    ...users.map((u) => ({ value: u.id, label: u.name ?? u.id })),
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          form.reset();
          setSubtasks([]);
          setExpandedIds(new Set());
          setEntityType(defaultTicketId ? "ticket" : "contact");
          setAllDay(true);
          setStartTime("09:00");
          setDueTime("18:00");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />
          {t("newTask")}
        </Button>
      </DialogTrigger>

      <DialogContent className="flex flex-col gap-0 p-0 sm:max-w-[680px]">
        {/* Header */}
        <DialogHeader className="border-b px-6 pt-6 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <CheckSquare className="h-4 w-4 text-primary" />
            </div>
            <div>
              <DialogTitle className="font-semibold text-base">{t("dialog.newTitle")}</DialogTitle>
              <p className="mt-0.5 text-muted-foreground text-xs">{t("dialog.subtitle")}</p>
            </div>
          </div>
        </DialogHeader>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <Tabs defaultValue="details">
              <TabsList className="mb-5 w-full">
                <TabsTrigger value="details" className="relative flex-1 gap-1.5 text-xs">
                  <CheckSquare className="h-3.5 w-3.5" />
                  {t("dialog.tabs.details")}
                  <TabDot has={tabErrors.details} />
                </TabsTrigger>
                <TabsTrigger value="assignment" className="relative flex-1 gap-1.5 text-xs">
                  <User className="h-3.5 w-3.5" />
                  {t("dialog.tabs.assignment")}
                  <TabDot has={tabErrors.assignment} />
                </TabsTrigger>
                <TabsTrigger value="links" className="relative flex-1 gap-1.5 text-xs">
                  <Link2 className="h-3.5 w-3.5" />
                  {t("dialog.tabs.links")}
                  <TabDot has={tabErrors.links} />
                </TabsTrigger>
                <TabsTrigger value="subtasks" className="relative flex-1 gap-1.5 text-xs">
                  <ListChecks className="h-3.5 w-3.5" />
                  {t("dialog.tabs.subtasks")}
                  {subtasks.length > 0 && (
                    <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-medium text-[10px] text-primary-foreground">
                      {subtasks.length}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>

              {/* ── Tab 1: Dettagli ──────────────────────────────────────────── */}
              <TabsContent value="details" className="mt-0 space-y-4">
                <F label={t("dialog.titleLabel")} required error={e.title?.message}>
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
                    placeholder={t("dialog.descriptionPlaceholder")}
                    className="min-h-[90px] resize-y text-sm"
                  />
                </F>

                <div className="grid grid-cols-2 gap-4">
                  <F label={t("dialog.status")}>
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

                  <F label={t("dialog.priority")}>
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

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setAllDay((v) => !v)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors",
                      allDay
                        ? "border-primary/30 bg-primary/10 text-primary"
                        : "border-input bg-transparent text-muted-foreground hover:bg-accent/50",
                    )}
                  >
                    <CalendarDays className="h-3.5 w-3.5" />
                    Tutto il giorno
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <F label={t("dialog.startDate")}>
                    <Controller
                      control={control}
                      name="startDate"
                      render={({ field }) => (
                        <DatePicker
                          value={field.value}
                          onChange={field.onChange}
                          placeholder={t("dialog.startDate")}
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
                          placeholder={t("dialog.dueDate")}
                          showTime={!allDay}
                          timeValue={dueTime}
                          onTimeChange={setDueTime}
                        />
                      )}
                    />
                  </F>
                </div>
              </TabsContent>

              {/* ── Tab 2: Assegnazione ──────────────────────────────────────── */}
              <TabsContent value="assignment" className="mt-0 space-y-4">
                <F label={t("dialog.assignTo")}>
                  <Controller
                    control={control}
                    name="assigneeId"
                    render={({ field }) => (
                      <SearchableSelect
                        options={userOptions}
                        value={field.value ?? "_none"}
                        onChange={field.onChange}
                        placeholder={t("dialog.unassigned")}
                        searchPlaceholder={t("dialog.searchUsers")}
                        emptyText={t("dialog.noUsers")}
                      />
                    )}
                  />
                </F>

                <div className="grid grid-cols-2 gap-4">
                  <F label={t("dialog.estimatedHours")} error={e.estimatedHours?.message}>
                    <div className="relative">
                      <Clock className="-translate-y-1/2 absolute top-1/2 left-3 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        {...register("estimatedHours")}
                        type="number"
                        min={0}
                        step={0.5}
                        placeholder="0"
                        className="pl-8"
                      />
                    </div>
                  </F>
                </div>

                <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-3">
                  <div className="flex items-start gap-3">
                    <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="space-y-0.5">
                      <p className="font-medium text-xs">{t("dialog.assignmentHint")}</p>
                      <p className="text-muted-foreground text-xs">{t("dialog.assignmentHintDesc")}</p>
                    </div>
                  </div>
                </div>
              </TabsContent>

              {/* ── Tab 3: Collegamento ──────────────────────────────────────── */}
              <TabsContent value="links" className="mt-0 space-y-5">
                <F label={t("dialog.parentTask")}>
                  <Controller
                    control={control}
                    name="parentId"
                    render={({ field }) => (
                      <SearchableSelect
                        options={parentTaskOptions}
                        value={field.value ?? "_none"}
                        onChange={field.onChange}
                        placeholder={t("dialog.noParent")}
                        searchPlaceholder={t("dialog.searchTasks")}
                        emptyText={t("dialog.noTasksFound")}
                      />
                    )}
                  />
                </F>

                <div className="space-y-2 border-t pt-4">
                  <Label className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                    {t("dialog.linkToCRM")}
                  </Label>
                  <EntityPicker
                    entityType={entityType}
                    onTypeChange={setEntityType}
                    options={entityOptions}
                    selectedId={selectedEntityId}
                    onSelect={handleEntitySelect}
                  />
                </div>
              </TabsContent>

              {/* ── Tab 4: Sottoattività ─────────────────────────────────────── */}
              <TabsContent value="subtasks" className="mt-0 space-y-3">
                {subtasks.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed bg-muted/30 py-8 text-center">
                    <ListChecks className="h-8 w-8 text-muted-foreground/50" />
                    <div>
                      <p className="font-medium text-sm">{t("dialog.subtasks.empty")}</p>
                      <p className="mt-0.5 text-muted-foreground text-xs">{t("dialog.subtasks.emptyDesc")}</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {subtasks.map((sub, idx) => {
                      const expanded = expandedIds.has(sub._id);
                      const priorityCfg = PRIORITY_CONFIG[sub.priority as keyof typeof PRIORITY_CONFIG];
                      return (
                        <div key={sub._id} className="rounded-md border bg-muted/20">
                          {/* ── Header row ── */}
                          <div className="flex items-center gap-2 p-2">
                            <span className="w-5 shrink-0 text-center font-medium text-muted-foreground text-xs">
                              {idx + 1}
                            </span>
                            <Input
                              value={sub.title}
                              onChange={(e) => updateSubtask(sub._id, "title", e.target.value)}
                              placeholder={t("dialog.subtasks.titlePlaceholder")}
                              className="h-8 flex-1 text-sm"
                            />
                            {/* priority dot badge */}
                            {priorityCfg && (
                              <span
                                className="h-2.5 w-2.5 shrink-0 rounded-full"
                                style={{ backgroundColor: priorityCfg.color }}
                                title={priorityCfg.label}
                              />
                            )}
                            <button
                              type="button"
                              onClick={() => toggleExpanded(sub._id)}
                              className={cn(
                                "shrink-0 rounded-sm p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                              )}
                              title={expanded ? t("dialog.subtasks.collapse") : t("dialog.subtasks.expand")}
                            >
                              <ChevronDown
                                className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")}
                              />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setSubtasks((prev) => prev.filter((s) => s._id !== sub._id));
                                setExpandedIds((prev) => {
                                  const next = new Set(prev);
                                  next.delete(sub._id);
                                  return next;
                                });
                              }}
                              className="shrink-0 rounded-sm p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>

                          {/* ── Expanded body ── */}
                          {expanded && (
                            <div className="space-y-3 border-t px-3 py-3">
                              {/* Description */}
                              <div className="flex flex-col gap-1">
                                <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                                  {t("dialog.description")}
                                </span>
                                <Textarea
                                  value={sub.description}
                                  onChange={(e) => updateSubtask(sub._id, "description", e.target.value)}
                                  placeholder={t("dialog.descriptionPlaceholder")}
                                  className="min-h-[60px] resize-y text-sm"
                                />
                              </div>

                              {/* Priority + Assignee + Hours */}
                              <div className="grid grid-cols-3 gap-2">
                                <div className="flex flex-col gap-1">
                                  <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                                    {t("dialog.priority")}
                                  </span>
                                  <Select
                                    value={sub.priority}
                                    onValueChange={(v) => updateSubtask(sub._id, "priority", v)}
                                  >
                                    <SelectTrigger className="h-8">
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
                                </div>
                                <div className="flex flex-col gap-1">
                                  <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                                    {t("dialog.assignTo")}
                                  </span>
                                  <SearchableSelect
                                    options={userOptions}
                                    value={sub.assigneeId}
                                    onChange={(v) => updateSubtask(sub._id, "assigneeId", v)}
                                    placeholder={t("dialog.unassigned")}
                                    searchPlaceholder={t("dialog.searchUsers")}
                                    emptyText={t("dialog.noUsers")}
                                  />
                                </div>
                                <div className="flex flex-col gap-1">
                                  <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                                    {t("dialog.estimatedHours")}
                                  </span>
                                  <div className="relative">
                                    <Clock className="-translate-y-1/2 absolute top-1/2 left-2 h-3 w-3 text-muted-foreground" />
                                    <Input
                                      type="number"
                                      min={0}
                                      step={0.5}
                                      value={sub.estimatedHours}
                                      onChange={(e) => updateSubtask(sub._id, "estimatedHours", e.target.value)}
                                      placeholder="0h"
                                      className="h-8 pl-6 text-sm"
                                    />
                                  </div>
                                </div>
                              </div>

                              {/* Start date + Due date */}
                              <div className="grid grid-cols-2 gap-2">
                                <div className="flex flex-col gap-1">
                                  <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                                    {t("dialog.startDate")}
                                  </span>
                                  <DatePicker
                                    value={sub.startDate || undefined}
                                    onChange={(v) => updateSubtask(sub._id, "startDate", v ?? "")}
                                    placeholder={t("dialog.startDate")}
                                  />
                                </div>
                                <div className="flex flex-col gap-1">
                                  <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                                    {t("dialog.dueDate")}
                                  </span>
                                  <DatePicker
                                    value={sub.dueDate || undefined}
                                    onChange={(v) => updateSubtask(sub._id, "dueDate", v ?? "")}
                                    placeholder={t("dialog.dueDate")}
                                  />
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full gap-1.5"
                  onClick={() => setSubtasks((prev) => [...prev, newSubtask()])}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t("dialog.subtasks.add")}
                </Button>

                {subtasks.length > 0 && (
                  <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-2.5">
                    <p className="text-muted-foreground text-xs">
                      {t("dialog.subtasks.hint", {
                        count: subtasks.filter((s) => s.title.trim()).length,
                        total: subtasks.length,
                        hours: subtasks.reduce((acc, s) => acc + (Number(s.estimatedHours) || 0), 0),
                      })}
                    </p>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>

          {/* Footer */}
          <DialogFooter className="border-t bg-muted/30 px-6 py-4">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t("dialog.cancel")}
            </Button>
            <Button type="submit" disabled={isSubmitting} className="min-w-[130px] gap-2">
              {isSubmitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t("dialog.saving")}
                </>
              ) : (
                <>
                  <Flame className="h-3.5 w-3.5" />
                  {t("dialog.createButton")}
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
