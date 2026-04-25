"use client";

import { useState } from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import {
  AlertCircle,
  Building2,
  CalendarIcon,
  Check,
  CheckSquare,
  ChevronsUpDown,
  Clock,
  Flame,
  Kanban,
  Link2,
  Loader2,
  Plus,
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

type EntityType = "contact" | "company" | "lead" | "deal";
type EntityOption = { id: string; label: string; sub?: string };

const ENTITY_TYPES: { value: EntityType; label: string; icon: React.ElementType }[] = [
  { value: "contact", label: "Contatto", icon: UserCircle },
  { value: "company", label: "Azienda", icon: Building2 },
  { value: "lead", label: "Lead", icon: UserSearch },
  { value: "deal", label: "Trattativa", icon: Kanban },
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

// ─── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  users: { id: string; name: string | null }[];
  tasks: { id: string; title: string; depth: number }[];
  leads: { id: string; firstName: string; lastName: string }[];
  contacts: { id: string; firstName: string; lastName: string }[];
  companies: { id: string; name: string }[];
  deals: { id: string; name: string }[];
  currentUserId: string;
  onCreated: () => void;
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function NewTaskDialog({ users, tasks, leads, contacts, companies, deals, currentUserId, onCreated }: Props) {
  const t = useTranslations("tasks");
  const [open, setOpen] = useState(false);
  const [entityType, setEntityType] = useState<EntityType>("contact");

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
          : (watch("dealId") ?? null);

  const handleEntitySelect = (id: string | null) => {
    setValue("contactId", undefined);
    setValue("companyId", undefined);
    setValue("leadId", undefined);
    setValue("dealId", undefined);
    if (id) {
      if (entityType === "contact") setValue("contactId", id);
      else if (entityType === "company") setValue("companyId", id);
      else if (entityType === "lead") setValue("leadId", id);
      else setValue("dealId", id);
    }
  };

  const entityOptions: EntityOption[] =
    entityType === "contact"
      ? contacts.map((c) => ({ id: c.id, label: `${c.firstName} ${c.lastName}` }))
      : entityType === "company"
        ? companies.map((co) => ({ id: co.id, label: co.name }))
        : entityType === "lead"
          ? leads.map((l) => ({ id: l.id, label: `${l.firstName} ${l.lastName}` }))
          : deals.map((d) => ({ id: d.id, label: d.name }));

  const onSubmit = async (data: FormValues) => {
    try {
      await createTask({
        title: data.title,
        description: data.description || undefined,
        status: data.status,
        priority: data.priority,
        startDate: data.startDate ? new Date(data.startDate) : undefined,
        dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
        ownerId: currentUserId,
        assigneeId: data.assigneeId && data.assigneeId !== "_none" ? data.assigneeId : undefined,
        estimatedHours: data.estimatedHours != null ? String(data.estimatedHours) : undefined,
        parentId: data.parentId && data.parentId !== "_none" ? data.parentId : undefined,
        leadId: data.leadId || undefined,
        contactId: data.contactId || undefined,
        companyId: data.companyId || undefined,
        dealId: data.dealId || undefined,
      });
      toast.success(t("createSuccess"));
      setOpen(false);
      form.reset();
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
          setEntityType("contact");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />
          {t("newTask")}
        </Button>
      </DialogTrigger>

      <DialogContent className="flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-[680px]">
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

                <div className="grid grid-cols-2 gap-4">
                  <F label={t("dialog.startDate")}>
                    <Controller
                      control={control}
                      name="startDate"
                      render={({ field }) => (
                        <DatePicker value={field.value} onChange={field.onChange} placeholder={t("dialog.startDate")} />
                      )}
                    />
                  </F>
                  <F label={t("dialog.dueDate")}>
                    <Controller
                      control={control}
                      name="dueDate"
                      render={({ field }) => (
                        <DatePicker value={field.value} onChange={field.onChange} placeholder={t("dialog.dueDate")} />
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
