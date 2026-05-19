"use client";

import { useEffect, useState } from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Bell,
  CheckSquare,
  GitMergeIcon,
  Loader2Icon,
  Mail,
  PencilLine,
  Plus,
  RocketIcon,
  Send,
  Trash2,
  Zap,
} from "lucide-react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";

import { createAutomationRule, updateAutomationRule } from "@/actions/automation";
import { getAllUsers } from "@/actions/crm";
import { getEmailTemplates } from "@/actions/marketing";
import {
  type AutomationRuleFormData,
  AutomationRuleFormSchema,
  CONDITION_OPERATORS,
  ENTITY_FIELDS,
  OPERATORS_BY_TYPE,
  TARGET_ENTITIES,
  TRIGGER_EVENTS,
} from "@/components/crm/automation/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { ConditionExpressionEditor } from "./condition-expression-editor";
import { parseScheduledTrigger, SCHEDULED_TRIGGER_PREFIX } from "./scheduler-utils";

// ── Update-field options per entity ──────────────────────────────────────────

type UpdField = {
  value: string;
  label: string;
  kind: "enum" | "number" | "text" | "textarea";
  options?: { value: string; label: string }[];
};

const SOURCE_OPTIONS = [
  { value: "website", label: "Website" },
  { value: "referral", label: "Referral" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "cold_outreach", label: "Cold Outreach" },
  { value: "trade_show", label: "Trade Show" },
  { value: "advertisement", label: "Advertisement" },
  { value: "email_campaign", label: "Email Campaign" },
  { value: "other", label: "Other" },
];

const UPDATE_FIELDS_BY_ENTITY: Record<string, UpdField[]> = {
  deal: [
    {
      value: "status",
      label: "Status",
      kind: "enum",
      options: [
        { value: "open", label: "Open" },
        { value: "won", label: "Won" },
        { value: "lost", label: "Lost" },
      ],
    },
    { value: "probability", label: "Probability (%)", kind: "number" },
    {
      value: "currency",
      label: "Currency",
      kind: "enum",
      options: [
        { value: "EUR", label: "EUR (€)" },
        { value: "USD", label: "USD ($)" },
        { value: "GBP", label: "GBP (£)" },
      ],
    },
    { value: "notes", label: "Notes", kind: "textarea" },
  ],
  lead: [
    {
      value: "status",
      label: "Status",
      kind: "enum",
      options: [
        { value: "new", label: "New" },
        { value: "contacting", label: "Contacting" },
        { value: "engaged", label: "Engaged" },
        { value: "qualified", label: "Qualified" },
        { value: "unqualified", label: "Unqualified" },
      ],
    },
    {
      value: "rating",
      label: "Rating",
      kind: "enum",
      options: [
        { value: "hot", label: "🔥 Hot" },
        { value: "warm", label: "☀️ Warm" },
        { value: "cold", label: "❄️ Cold" },
      ],
    },
    { value: "source", label: "Source", kind: "enum", options: SOURCE_OPTIONS },
    { value: "leadScore", label: "Lead Score (0–100)", kind: "number" },
    { value: "notes", label: "Notes", kind: "textarea" },
  ],
  contact: [
    { value: "status", label: "Status", kind: "text" },
    { value: "source", label: "Source", kind: "enum", options: SOURCE_OPTIONS },
    { value: "jobTitle", label: "Job Title", kind: "text" },
    { value: "leadScore", label: "Lead Score (0–100)", kind: "number" },
    { value: "notes", label: "Notes", kind: "textarea" },
  ],
  company: [
    { value: "status", label: "Status", kind: "text" },
    {
      value: "type",
      label: "Type",
      kind: "enum",
      options: [
        { value: "prospect", label: "Prospect" },
        { value: "customer", label: "Customer" },
        { value: "partner", label: "Partner" },
        { value: "vendor", label: "Vendor" },
      ],
    },
    { value: "industry", label: "Industry", kind: "text" },
  ],
  ticket: [
    {
      value: "status",
      label: "Status",
      kind: "enum",
      options: [
        { value: "new", label: "New" },
        { value: "open", label: "Open" },
        { value: "in_progress", label: "In Progress" },
        { value: "waiting", label: "Waiting" },
        { value: "on_hold", label: "On Hold" },
        { value: "resolved", label: "Resolved" },
        { value: "closed", label: "Closed" },
      ],
    },
    {
      value: "priority",
      label: "Priority",
      kind: "enum",
      options: [
        { value: "low", label: "Low" },
        { value: "normal", label: "Normal" },
        { value: "high", label: "High" },
        { value: "urgent", label: "Urgent" },
      ],
    },
  ],
};

// ── Constants ─────────────────────────────────────────────────────────────────

const ENTITY_META: Record<string, { label: string; emoji: string }> = {
  deal: { label: "Deal", emoji: "💼" },
  lead: { label: "Lead", emoji: "🎯" },
  contact: { label: "Contact", emoji: "👤" },
  company: { label: "Company", emoji: "🏢" },
  ticket: { label: "Ticket", emoji: "🎫" },
};

const OPERATOR_LABELS: Record<string, string> = {
  equals: "equals",
  not_equals: "does not equal",
  greater_than: "greater than",
  less_than: "less than",
  greater_than_or_equal: "≥ at least",
  less_than_or_equal: "≤ at most",
  contains: "contains",
  not_contains: "does not contain",
  is_empty: "is empty",
  is_not_empty: "is not empty",
  changed: "changed",
  changed_to: "changed to",
  changed_from: "changed from",
};

const ACTION_META: Record<string, { label: string; icon: React.ReactNode; color: string; bg: string }> = {
  create_task: {
    label: "Create Task",
    icon: <CheckSquare className="h-4 w-4" />,
    color: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800",
  },
  send_notification: {
    label: "Send Notification",
    icon: <Bell className="h-4 w-4" />,
    color: "text-violet-600 dark:text-violet-400",
    bg: "bg-violet-50 dark:bg-violet-950/30 border-violet-200 dark:border-violet-800",
  },
  send_email: {
    label: "Send Email",
    icon: <Mail className="h-4 w-4" />,
    color: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800",
  },
  send_webhook: {
    label: "Send Webhook",
    icon: <Send className="h-4 w-4" />,
    color: "text-slate-600 dark:text-slate-400",
    bg: "bg-slate-50 dark:bg-slate-950/30 border-slate-200 dark:border-slate-800",
  },
  update_field: {
    label: "Update Field",
    icon: <PencilLine className="h-4 w-4" />,
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800",
  },
};

const NO_VALUE_OPERATORS = new Set(["is_empty", "is_not_empty", "changed"]);

// ── Field Helper (identical style to LeadModal) ───────────────────────────────

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

// ── Tab error dot (identical to LeadModal) ────────────────────────────────────

const TabDot = ({ has }: { has: boolean }) =>
  has ? <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-destructive" /> : null;

// ── Default form values ───────────────────────────────────────────────────────

const EMPTY_DEFAULTS: AutomationRuleFormData = {
  name: "",
  description: "",
  isActive: true,
  targetEntity: "deal",
  triggerOn: ["onUpdate"],
  conditionLogic: "AND",
  conditions: [{ field: "status", operator: "changed_to", value: "", logic: "AND" }],
  actions: [{ type: "create_task", params: { title: "", priority: "normal", dueDateDays: 3 } }],
};

// ── Main Component ────────────────────────────────────────────────────────────

interface RuleModalProps {
  /** When provided → edit mode; omit → create mode */
  rule?: {
    id: string;
    name: string;
    description: string | null;
    isActive: boolean;
    targetEntity: string;
    triggerOn: string[] | null;
    conditionLogic: string;
    conditions: string;
    actions: string;
  };
  children: React.ReactNode;
  onSaved?: () => void;
}

export function RuleModal({ rule, children, onSaved }: RuleModalProps) {
  const [open, setOpen] = useState(false);
  const [userList, setUserList] = useState<{ id: string; name: string | null; email: string | null }[]>([]);
  const [templateList, setTemplateList] = useState<
    { id: string; name: string; subject: string; body: string; category: string }[]
  >([]);
  const isEditing = !!rule;

  useEffect(() => {
    if (open) {
      getAllUsers().then(setUserList);
      getEmailTemplates().then((tpls) =>
        setTemplateList(
          tpls.map((t) => ({ id: t.id, name: t.name, subject: t.subject, body: t.body, category: t.category })),
        ),
      );
    }
  }, [open]);

  const defaultValues: AutomationRuleFormData = rule
    ? {
        name: rule.name,
        description: rule.description ?? "",
        isActive: rule.isActive,
        targetEntity: rule.targetEntity as AutomationRuleFormData["targetEntity"],
        triggerOn: (rule.triggerOn ?? []) as AutomationRuleFormData["triggerOn"],
        conditionLogic: (rule.conditionLogic ?? "AND") as "AND" | "OR",
        conditions: JSON.parse(rule.conditions),
        actions: JSON.parse(rule.actions),
      }
    : EMPTY_DEFAULTS;

  const form = useForm<AutomationRuleFormData>({
    resolver: zodResolver(AutomationRuleFormSchema),
    defaultValues,
  });

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = form;
  const e = errors;

  const {
    fields: conditionFields,
    append: addCondition,
    remove: removeCondition,
  } = useFieldArray({ control, name: "conditions" });
  const {
    fields: actionFields,
    append: addAction,
    remove: removeAction,
    update: updateAction,
  } = useFieldArray({ control, name: "actions" });

  const targetEntity = watch("targetEntity");
  const _conditionLogic = watch("conditionLogic");
  const entityFields = ENTITY_FIELDS[targetEntity] ?? [];

  // Tab-level error detection
  const tabErrors = {
    details: !!e.name,
    trigger: !!(e.targetEntity || e.triggerOn),
    conditions: !!e.conditions,
    actions: !!e.actions,
  };

  const onSubmit = handleSubmit(async (data) => {
    try {
      if (isEditing) {
        const res = await updateAutomationRule(rule.id, data);
        if (!res.success) throw new Error(res.error);
        toast.success("Rule updated.");
      } else {
        const res = await createAutomationRule(data);
        if (!res.success) throw new Error(res.error);
        toast.success("Rule created.");
      }
      setOpen(false);
      form.reset(EMPTY_DEFAULTS);
      onSaved?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save rule.");
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) form.reset(isEditing ? defaultValues : EMPTY_DEFAULTS);
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>

      <DialogContent className="flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-[700px]">
        <DialogHeader className="border-b px-6 pt-6 pb-4">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Zap className="h-5 w-5 text-yellow-500" />
            {isEditing ? `Edit Rule — ${rule.name}` : "New Automation Rule"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <Tabs defaultValue="details">
              <TabsList className="mb-5 w-full">
                <TabsTrigger value="details" className="relative flex-1 gap-1.5">
                  <Zap className="h-3.5 w-3.5" />
                  Details
                  <TabDot has={tabErrors.details} />
                </TabsTrigger>
                <TabsTrigger value="trigger" className="relative flex-1 gap-1.5">
                  <RocketIcon className="h-3.5 w-3.5" />
                  Trigger
                  <TabDot has={tabErrors.trigger} />
                </TabsTrigger>
                <TabsTrigger value="conditions" className="relative flex-1 gap-1.5">
                  <GitMergeIcon className="h-3.5 w-3.5" />
                  Conditions
                  <TabDot has={tabErrors.conditions} />
                </TabsTrigger>
                <TabsTrigger value="actions" className="relative flex-1 gap-1.5">
                  <CheckSquare className="h-3.5 w-3.5" />
                  Actions
                  <TabDot has={tabErrors.actions} />
                </TabsTrigger>
              </TabsList>

              {/* ── Tab 1: Details ──────────────────────────────────────── */}
              <TabsContent value="details" className="mt-0 space-y-4">
                <F label="Rule Name" required error={e.name?.message}>
                  <Input {...register("name")} placeholder="e.g. Legal Review on Large Proposal" />
                </F>
                <F label="Description">
                  <Textarea
                    {...register("description")}
                    rows={3}
                    placeholder="Optional — describe what this rule does…"
                    className="resize-none"
                  />
                </F>
                <Controller
                  control={control}
                  name="isActive"
                  render={({ field }) => (
                    <div className="flex items-center justify-between rounded-lg border px-4 py-3">
                      <div>
                        <p className="font-medium text-sm">Active</p>
                        <p className="text-muted-foreground text-xs">
                          {field.value ? "Rule will fire automatically" : "Rule is currently paused"}
                        </p>
                      </div>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </div>
                  )}
                />
              </TabsContent>

              {/* ── Tab 2: Trigger ──────────────────────────────────────── */}
              <TabsContent value="trigger" className="mt-0 space-y-5">
                <F label="Entity" required>
                  <Controller
                    control={control}
                    name="targetEntity"
                    render={({ field }) => (
                      <div className="mt-0.5 grid grid-cols-4 gap-2">
                        {TARGET_ENTITIES.map((e) => {
                          const meta = ENTITY_META[e];
                          return (
                            <button
                              key={e}
                              type="button"
                              onClick={() => {
                                field.onChange(e);
                                const firstField = ENTITY_FIELDS[e]?.[0]?.key ?? "status";
                                setValue("conditions", [
                                  { field: firstField, operator: "changed_to", value: "", logic: "AND" },
                                ]);
                              }}
                              className={cn(
                                "flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 font-medium text-xs transition-all",
                                field.value === e
                                  ? "border-primary bg-primary/5 text-primary shadow-sm"
                                  : "border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground",
                              )}
                            >
                              <span className="text-xl leading-none">{meta.emoji}</span>
                              {meta.label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  />
                </F>

                <F label="Fire when" required error={e.triggerOn?.message as string | undefined}>
                  <div className="mt-0.5 grid grid-cols-2 gap-2">
                    {TRIGGER_EVENTS.map((ev) => (
                      <Controller
                        key={ev}
                        control={control}
                        name="triggerOn"
                        render={({ field }) => {
                          const checked = field.value.includes(ev);
                          return (
                            <button
                              type="button"
                              onClick={() => {
                                const next = checked ? field.value.filter((v) => v !== ev) : [...field.value, ev];
                                field.onChange(next);
                              }}
                              className={cn(
                                "flex items-center gap-3 rounded-lg border px-4 py-3 text-left font-medium text-sm transition-all",
                                checked
                                  ? "border-primary bg-primary/5 text-primary shadow-sm"
                                  : "border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground",
                              )}
                            >
                              <Checkbox
                                checked={checked}
                                onCheckedChange={console.error}
                                className="pointer-events-none"
                              />
                              {ev === "onCreate"
                                ? "Record Created"
                                : ev === "onUpdate"
                                  ? "Record Updated"
                                  : "SLA Breach"}
                            </button>
                          );
                        }}
                      />
                    ))}
                  </div>
                </F>

                {/* ── Scheduled Triggers ── */}
                <div className="mt-4 border-t pt-4">
                  <p className="mb-3 font-semibold text-muted-foreground text-xs">Or schedule this automation:</p>
                  <div className="space-y-3">
                    <Controller
                      control={control}
                      name="triggerOn"
                      render={({ field }) => {
                        const scheduledTrigger = field.value?.find((t: string) =>
                          t.startsWith(SCHEDULED_TRIGGER_PREFIX),
                        );
                        const cronExpr = scheduledTrigger ? parseScheduledTrigger(scheduledTrigger) : null;

                        // Derive HH:MM from stored cron ("30 9 * * *" → "09:30")
                        const timeValue = (() => {
                          if (!cronExpr) return "08:00";
                          const parts = cronExpr.split(" ");
                          const h = parts[1]?.padStart(2, "0") ?? "08";
                          const m = parts[0]?.padStart(2, "0") ?? "00";
                          return `${h}:${m}`;
                        })();

                        return (
                          <div className="space-y-2">
                            <span className="font-medium text-xs">Daily Schedule (time)</span>
                            <div className="flex gap-2">
                              <Input
                                type="time"
                                value={timeValue}
                                className="h-8 flex-1 text-sm"
                                onChange={(ev) => {
                                  const [hours, minutes] = ev.target.value.split(":");
                                  const cron = `${parseInt(minutes, 10)} ${parseInt(hours, 10)} * * *`;
                                  const encoded = `${SCHEDULED_TRIGGER_PREFIX}${cron}`;
                                  const next =
                                    field.value?.filter((t: string) => !t.startsWith(SCHEDULED_TRIGGER_PREFIX)) ?? [];
                                  field.onChange([...next, encoded]);
                                }}
                              />
                              {scheduledTrigger && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="text-destructive"
                                  onClick={() => {
                                    field.onChange(
                                      field.value?.filter((t: string) => !t.startsWith(SCHEDULED_TRIGGER_PREFIX)) ?? [],
                                    );
                                  }}
                                >
                                  Remove
                                </Button>
                              )}
                            </div>
                            {scheduledTrigger && (
                              <p className="text-emerald-600 text-xs dark:text-emerald-400">
                                Scheduled daily at {timeValue}
                              </p>
                            )}
                          </div>
                        );
                      }}
                    />
                  </div>
                </div>
              </TabsContent>
              {/* ── Tab 3: Conditions ───────────────────────────────────── */}
              <TabsContent value="conditions" className="mt-0 space-y-3">
                {/* Conditions list */}
                <div className="space-y-3">
                  {conditionFields.length === 0 ? (
                    <div className="rounded border border-dashed bg-muted/30 py-8 text-center text-muted-foreground text-sm">
                      <p>Nessuna condizione aggiunta</p>
                      <p className="mt-1 text-xs">Clicca il pulsante sottostante per iniziare</p>
                    </div>
                  ) : (
                    conditionFields.map((field, index) => {
                      const selectedFieldKey = watch(`conditions.${index}.field`);
                      const fieldDef = entityFields.find((f) => f.key === selectedFieldKey);
                      const allowedOps = fieldDef ? OPERATORS_BY_TYPE[fieldDef.type] : CONDITION_OPERATORS;
                      const selectedOp = watch(`conditions.${index}.operator`);
                      const needsValue = !NO_VALUE_OPERATORS.has(selectedOp);

                      return (
                        <div key={field.id} className="space-y-2">
                          {/* Logic separator */}
                          {index > 0 && (
                            <div className="flex items-center gap-2 px-3 py-2">
                              <div className="h-px flex-1 bg-border" />
                              <Controller
                                control={control}
                                name={`conditions.${index}.logic`}
                                render={({ field: f }) => (
                                  <div className="flex gap-1 overflow-hidden rounded border bg-background">
                                    {(["AND", "OR"] as const).map((op) => (
                                      <button
                                        key={op}
                                        type="button"
                                        onClick={() => f.onChange(op)}
                                        className={cn(
                                          "px-3 py-1 font-semibold text-xs transition-colors",
                                          f.value === op
                                            ? "bg-primary text-primary-foreground"
                                            : "text-muted-foreground hover:text-foreground",
                                        )}
                                      >
                                        {op}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              />
                              <div className="h-px flex-1 bg-border" />
                            </div>
                          )}

                          {/* Condition controls */}
                          <div className="flex items-center gap-2 rounded-lg border bg-card p-3 shadow-sm">
                            <span className="min-w-fit font-bold font-mono text-muted-foreground text-xs">
                              C{index}
                            </span>

                            {/* Field selector */}
                            <Controller
                              control={control}
                              name={`conditions.${index}.field`}
                              render={({ field: f }) => (
                                <Select value={f.value} onValueChange={f.onChange}>
                                  <SelectTrigger className="h-8 flex-1 text-xs">
                                    <SelectValue placeholder="Select field..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {entityFields.map((ef) => (
                                      <SelectItem key={ef.key} value={ef.key}>
                                        {ef.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                            />

                            {/* Operator selector */}
                            <Controller
                              control={control}
                              name={`conditions.${index}.operator`}
                              render={({ field: f }) => (
                                <Select
                                  value={f.value}
                                  onValueChange={(v) => {
                                    f.onChange(v);
                                    if (NO_VALUE_OPERATORS.has(v)) setValue(`conditions.${index}.value`, undefined);
                                  }}
                                >
                                  <SelectTrigger className="h-8 w-40 flex-shrink-0 text-xs">
                                    <SelectValue placeholder="Operator..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {allowedOps.map((op) => (
                                      <SelectItem key={op} value={op}>
                                        {OPERATOR_LABELS[op] ?? op}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                            />

                            {/* Value input */}
                            {needsValue &&
                              (fieldDef?.type === "enum" && fieldDef.options ? (
                                <Controller
                                  control={control}
                                  name={`conditions.${index}.value`}
                                  render={({ field: f }) => (
                                    <Select value={String(f.value ?? "")} onValueChange={f.onChange}>
                                      <SelectTrigger className="h-8 w-32 flex-shrink-0 text-xs">
                                        <SelectValue placeholder="Value..." />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {fieldDef.options?.map((opt) => (
                                          <SelectItem key={opt.value} value={opt.value}>
                                            {opt.label}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  )}
                                />
                              ) : (
                                <Input
                                  className="h-8 w-32 flex-shrink-0 text-xs"
                                  placeholder="Value..."
                                  type={fieldDef?.type === "number" ? "number" : "text"}
                                  {...register(`conditions.${index}.value`)}
                                />
                              ))}

                            {/* Delete button */}
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 flex-shrink-0 text-destructive hover:text-destructive"
                              onClick={() => removeCondition(index)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Action buttons */}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() =>
                      addCondition({
                        field: entityFields[0]?.key ?? "status",
                        operator: "equals",
                        value: "",
                        logic: "AND",
                      })
                    }
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Aggiungi Condizione
                  </Button>
                </div>

                {/* ── Advanced Expression Editor ── */}
                <div className="mt-6 border-t pt-4">
                  <details className="group">
                    <summary className="flex cursor-pointer select-none items-center gap-2 font-semibold text-muted-foreground text-sm hover:text-foreground">
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded border border-border transition-transform group-open:rotate-90">
                        ▶
                      </span>
                      🔧 Logica Avanzata (Parentesi & Operatori)
                    </summary>
                    <div className="mt-4 space-y-4 pt-4">
                      <ConditionExpressionEditor
                        conditions={watch("conditions")}
                        expression={watch("conditionExpression") ?? ""}
                        onChange={(expr) => setValue("conditionExpression", expr)}
                        onValidationChange={(_isValid) => {
                          // Puoi usare questo per disabilitare il pulsante save se l'espressione non è valida
                        }}
                      />
                    </div>
                  </details>
                </div>
              </TabsContent>

              {/* ── Tab 4: Actions ──────────────────────────────────────── */}
              <TabsContent value="actions" className="mt-0 space-y-3">
                {actionFields.length === 0 && (
                  <p className="py-4 text-center text-muted-foreground text-sm">No actions yet. Add at least one.</p>
                )}
                {actionFields.map((field, index) => {
                  const actionType = watch(`actions.${index}.type`);
                  const meta = ACTION_META[actionType];
                  // biome-ignore lint/suspicious/noExplicitAny: form errors shape is dynamic
                  const actionErrs = (e.actions as any)?.[index]?.params;

                  // For update_field: derive the selected field def and its kind
                  const updFields = UPDATE_FIELDS_BY_ENTITY[targetEntity] ?? UPDATE_FIELDS_BY_ENTITY.deal;
                  // biome-ignore lint/suspicious/noExplicitAny: dynamic field path
                  const selectedUpd = watch(`actions.${index}.params.field` as any) as string;
                  const updFieldDef = updFields.find((f) => f.value === selectedUpd) ?? updFields[0];

                  return (
                    <div key={field.id} className={cn("space-y-3 rounded-xl border-2 p-4", meta?.bg)}>
                      {/* ── Card header: index + type selector + delete ── */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border bg-background/70 font-bold text-[10px] text-muted-foreground">
                            {index + 1}
                          </span>
                          <Controller
                            control={control}
                            name={`actions.${index}.type`}
                            render={({ field: f }) => (
                              <Select
                                value={f.value}
                                onValueChange={(v) => {
                                  if (v === "create_task")
                                    updateAction(index, {
                                      type: "create_task",
                                      params: { title: "", priority: "normal", dueDateDays: 3, assigneeId: "" },
                                    });
                                  else if (v === "send_notification")
                                    updateAction(index, {
                                      type: "send_notification",
                                      params: { userId: "entity_owner", title: "", message: "" },
                                    });
                                  else if (v === "send_email")
                                    updateAction(index, {
                                      type: "send_email",
                                      params: { to: "", subject: "", body: "", trackOpens: false, trackClicks: false },
                                    });
                                  else if (v === "send_webhook")
                                    updateAction(index, {
                                      type: "send_webhook",
                                      params: {
                                        url: "",
                                        method: "POST",
                                        headers: {},
                                        body: {},
                                        retryCount: 3,
                                        timeoutMs: 10000,
                                      },
                                    });
                                  else if (v === "update_field")
                                    updateAction(index, {
                                      type: "update_field",
                                      // biome-ignore lint/suspicious/noExplicitAny: union field cast
                                      params: { field: (updFields[0]?.value ?? "status") as any, value: "" },
                                    });
                                }}
                              >
                                <SelectTrigger
                                  className={cn(
                                    "h-7 w-auto gap-1 border-0 bg-transparent p-0 font-semibold text-sm shadow-none focus:ring-0",
                                    meta?.color,
                                  )}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {Object.entries(ACTION_META).map(([k, v]) => (
                                    <SelectItem key={k} value={k} className="text-sm">
                                      <span className="flex items-center gap-2">
                                        {v.icon} {v.label}
                                      </span>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 flex-shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => removeAction(index)}
                          disabled={actionFields.length === 1}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>

                      <div className="h-px bg-border/50" />

                      {/* ── create_task params ── */}
                      {actionType === "create_task" && (
                        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                          <div className="col-span-2">
                            <F label="Task Title" required error={actionErrs?.title?.message}>
                              <Input
                                className="h-8 bg-background text-sm"
                                placeholder="e.g. Legal Review"
                                // biome-ignore lint/suspicious/noExplicitAny: dynamic RHF path
                                {...register(`actions.${index}.params.title` as any)}
                              />
                            </F>
                          </div>

                          <F label="Assign to">
                            <Controller
                              control={control}
                              // biome-ignore lint/suspicious/noExplicitAny: dynamic RHF path
                              name={`actions.${index}.params.assigneeId` as any}
                              render={({ field: f }) => (
                                <Select
                                  value={f.value ?? "__unassigned__"}
                                  onValueChange={(v) => f.onChange(v === "__unassigned__" ? "" : v)}
                                >
                                  <SelectTrigger className="h-8 bg-background text-sm">
                                    <SelectValue placeholder="— Unassigned —" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__unassigned__">— Unassigned —</SelectItem>
                                    {userList.map((u) => (
                                      <SelectItem key={u.id} value={u.id}>
                                        {u.name ?? u.email}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                            />
                          </F>

                          <F label="Priority">
                            <Controller
                              control={control}
                              // biome-ignore lint/suspicious/noExplicitAny: dynamic RHF path
                              name={`actions.${index}.params.priority` as any}
                              render={({ field: f }) => (
                                <Select value={f.value ?? "normal"} onValueChange={f.onChange}>
                                  <SelectTrigger className="h-8 bg-background text-sm">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="low">🟢 Low</SelectItem>
                                    <SelectItem value="normal">🟡 Normal</SelectItem>
                                    <SelectItem value="high">🔴 High</SelectItem>
                                  </SelectContent>
                                </Select>
                              )}
                            />
                          </F>

                          <div className="col-span-2">
                            <F label="Due in (days)" error={actionErrs?.dueDateDays?.message}>
                              <div className="relative">
                                <Input
                                  type="number"
                                  min={0}
                                  max={365}
                                  placeholder="e.g. 3"
                                  className="h-8 bg-background pr-16 text-sm"
                                  {...register(`actions.${index}.params.dueDateDays` as any, { valueAsNumber: true })}
                                />
                                <span className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-3 text-muted-foreground text-xs">
                                  days
                                </span>
                              </div>
                            </F>
                          </div>

                          <div className="col-span-2">
                            <F label="Description">
                              <Textarea
                                rows={2}
                                placeholder="Optional task description…"
                                className="resize-none bg-background text-sm"
                                {...register(`actions.${index}.params.description` as any)}
                              />
                            </F>
                          </div>
                        </div>
                      )}

                      {/* ── send_notification params ── */}
                      {actionType === "send_notification" && (
                        <div className="space-y-3">
                          <F label="Notify" error={actionErrs?.userId?.message}>
                            <Controller
                              control={control}
                              name={`actions.${index}.params.userId` as any}
                              render={({ field: f }) => (
                                <Select value={f.value ?? "entity_owner"} onValueChange={f.onChange}>
                                  <SelectTrigger className="h-8 bg-background text-sm">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="entity_owner">
                                      <span className="flex items-center gap-2">
                                        👤 Record Owner <span className="text-muted-foreground text-xs">(dynamic)</span>
                                      </span>
                                    </SelectItem>
                                    {userList.length > 0 && (
                                      <>
                                        <div className="px-2 py-1 font-semibold text-[10px] text-muted-foreground uppercase tracking-wider">
                                          Specific User
                                        </div>
                                        {userList.map((u) => (
                                          <SelectItem key={u.id} value={u.id}>
                                            {u.name ?? u.email}
                                          </SelectItem>
                                        ))}
                                      </>
                                    )}
                                  </SelectContent>
                                </Select>
                              )}
                            />
                          </F>
                          <F label="Title" required error={actionErrs?.title?.message}>
                            <Input
                              className="h-8 bg-background text-sm"
                              placeholder="e.g. Deal needs attention"
                              {...register(`actions.${index}.params.title` as any)}
                            />
                          </F>
                          <F label="Message" error={actionErrs?.message?.message}>
                            <Textarea
                              rows={2}
                              placeholder="Notification body…"
                              className="resize-none bg-background text-sm"
                              {...register(`actions.${index}.params.message` as any)}
                            />
                          </F>
                        </div>
                      )}

                      {/* ── send_email params ── */}
                      {actionType === "send_email" && (
                        <div className="space-y-3">
                          {/* Template selector */}
                          <Controller
                            control={control}
                            name={`actions.${index}.params.templateId` as any}
                            render={({ field: f }) => {
                              const activeTpl = templateList.find((t) => t.id === f.value);
                              return (
                                <div className="space-y-1.5">
                                  <div className="flex items-center justify-between">
                                    <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                                      Email Template
                                    </span>
                                    {activeTpl && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          f.onChange(undefined);
                                        }}
                                        className="text-[11px] text-muted-foreground underline hover:text-destructive"
                                      >
                                        Clear
                                      </button>
                                    )}
                                  </div>
                                  <Select
                                    value={f.value ?? "__none__"}
                                    onValueChange={(v) => {
                                      if (v === "__none__") {
                                        f.onChange(undefined);
                                        return;
                                      }
                                      const tpl = templateList.find((t) => t.id === v);
                                      if (!tpl) return;
                                      f.onChange(v);
                                      // Pre-fill subject/body from template
                                      setValue(`actions.${index}.params.subject` as any, tpl.subject);
                                      setValue(`actions.${index}.params.body` as any, tpl.body);
                                    }}
                                  >
                                    <SelectTrigger className="h-8 bg-background text-sm">
                                      <SelectValue placeholder="— No template (manual) —" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="__none__">— No template (manual) —</SelectItem>
                                      {templateList.length > 0 && (
                                        <>
                                          <div className="px-2 py-1 font-semibold text-[10px] text-muted-foreground uppercase tracking-wider">
                                            Templates
                                          </div>
                                          {templateList.map((t) => (
                                            <SelectItem key={t.id} value={t.id}>
                                              <span className="flex items-center gap-2">
                                                <Badge variant="outline" className="h-4 px-1 py-0 text-[10px]">
                                                  {t.category}
                                                </Badge>
                                                {t.name}
                                              </span>
                                            </SelectItem>
                                          ))}
                                        </>
                                      )}
                                    </SelectContent>
                                  </Select>
                                  {activeTpl && (
                                    <p className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-600 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-400">
                                      ✓ Template content will be loaded at execution time — subject &amp; body below are
                                      editable overrides.
                                    </p>
                                  )}
                                </div>
                              );
                            }}
                          />

                          <div className="h-px bg-border/50" />

                          <F label="To" required error={actionErrs?.to?.message}>
                            <Input
                              className="h-8 bg-background text-sm"
                              placeholder="e.g. {{contact.email}} or email@example.com"
                              {...register(`actions.${index}.params.to` as any)}
                            />
                          </F>
                          <div className="grid grid-cols-2 gap-x-4">
                            <F label="CC">
                              <Input
                                className="h-8 bg-background text-sm"
                                placeholder="Optional, comma-separated"
                                {...register(`actions.${index}.params.cc` as any)}
                              />
                            </F>
                            <F label="BCC">
                              <Input
                                className="h-8 bg-background text-sm"
                                placeholder="Optional, comma-separated"
                                {...register(`actions.${index}.params.bcc` as any)}
                              />
                            </F>
                          </div>
                          <F label="Subject" error={actionErrs?.subject?.message}>
                            <Input
                              className="h-8 bg-background text-sm"
                              placeholder="e.g. Deal {{deal.name}} needs review"
                              {...register(`actions.${index}.params.subject` as any)}
                            />
                          </F>
                          <F label="Body (HTML)" error={actionErrs?.body?.message}>
                            <Textarea
                              rows={5}
                              placeholder="HTML content with {{merge.fields}}…"
                              className="resize-none bg-background font-mono text-sm text-xs"
                              {...register(`actions.${index}.params.body` as any)}
                            />
                          </F>
                          <div className="grid grid-cols-2 gap-3">
                            <Controller
                              control={control}
                              name={`actions.${index}.params.trackOpens` as any}
                              render={({ field: f }) => (
                                <div className="flex items-center gap-2 rounded border px-3 py-2">
                                  <Checkbox checked={f.value ?? false} onCheckedChange={f.onChange} />
                                  <span className="text-xs">Track Opens</span>
                                </div>
                              )}
                            />
                            <Controller
                              control={control}
                              name={`actions.${index}.params.trackClicks` as any}
                              render={({ field: f }) => (
                                <div className="flex items-center gap-2 rounded border px-3 py-2">
                                  <Checkbox checked={f.value ?? false} onCheckedChange={f.onChange} />
                                  <span className="text-xs">Track Clicks</span>
                                </div>
                              )}
                            />
                          </div>
                          <p className="rounded bg-muted/50 p-2 text-[11px] text-muted-foreground">
                            💡 Merge fields: deal.name, contact.email, owner.name, contact.firstName, etc.
                          </p>
                        </div>
                      )}

                      {/* ── send_webhook params ── */}
                      {actionType === "send_webhook" && (
                        <div className="space-y-3">
                          <F label="Webhook URL" required error={actionErrs?.url?.message}>
                            <Input
                              className="h-8 bg-background text-sm"
                              placeholder="https://example.com/webhook (supports {{merge.fields}})"
                              {...register(`actions.${index}.params.url` as any)}
                            />
                          </F>

                          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                            <F label="HTTP Method">
                              <Controller
                                control={control}
                                name={`actions.${index}.params.method` as any}
                                render={({ field: f }) => (
                                  <Select value={f.value ?? "POST"} onValueChange={f.onChange}>
                                    <SelectTrigger className="h-8 bg-background text-sm">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="GET">GET</SelectItem>
                                      <SelectItem value="POST">POST</SelectItem>
                                      <SelectItem value="PUT">PUT</SelectItem>
                                      <SelectItem value="PATCH">PATCH</SelectItem>
                                      <SelectItem value="DELETE">DELETE</SelectItem>
                                    </SelectContent>
                                  </Select>
                                )}
                              />
                            </F>

                            <F label="Timeout (ms)">
                              <Input
                                type="number"
                                className="h-8 bg-background text-sm"
                                defaultValue="10000"
                                {...register(`actions.${index}.params.timeoutMs` as any, { valueAsNumber: true })}
                              />
                            </F>
                          </div>

                          <F label="Request Body (JSON with {{merge.fields}})">
                            <Textarea
                              className="min-h-24 bg-background font-mono text-sm"
                              placeholder='{"message": "Deal {{deal.name}} is {{deal.status}}"}'
                              {...register(`actions.${index}.params.body` as any)}
                            />
                          </F>

                          <p className="rounded bg-muted/50 p-2 text-[11px] text-muted-foreground">
                            💡 Merge fields: deal.name, contact.email, owner.name, deal.amount, etc.
                          </p>
                        </div>
                      )}

                      {/* ── update_field params ── */}
                      {actionType === "update_field" && (
                        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                          {/* Field selector — context-aware per entity */}
                          <F label="Field" error={actionErrs?.field?.message}>
                            <Controller
                              control={control}
                              name={`actions.${index}.params.field` as any}
                              render={({ field: f }) => (
                                <Select
                                  value={f.value ?? updFields[0]?.value}
                                  onValueChange={(v) => {
                                    f.onChange(v);
                                    // Reset value when field type changes
                                    setValue(`actions.${index}.params.value` as any, "");
                                  }}
                                >
                                  <SelectTrigger className="h-8 bg-background text-sm">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {updFields.map((uf) => (
                                      <SelectItem key={uf.value} value={uf.value}>
                                        {uf.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                            />
                          </F>

                          {/* Value — adapts to the selected field's kind */}
                          <F label="New Value" required error={actionErrs?.value?.message}>
                            {updFieldDef?.kind === "enum" && updFieldDef.options ? (
                              <Controller
                                control={control}
                                name={`actions.${index}.params.value` as any}
                                render={({ field: f }) => (
                                  <Select value={f.value ?? ""} onValueChange={f.onChange}>
                                    <SelectTrigger className="h-8 bg-background text-sm">
                                      <SelectValue placeholder="Select…" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {updFieldDef.options?.map((opt) => (
                                        <SelectItem key={opt.value} value={opt.value}>
                                          {opt.label}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                )}
                              />
                            ) : updFieldDef?.kind === "number" ? (
                              <Input
                                type="number"
                                placeholder="0"
                                className="h-8 bg-background text-sm"
                                {...register(`actions.${index}.params.value` as any)}
                              />
                            ) : updFieldDef?.kind === "textarea" ? (
                              <Textarea
                                rows={2}
                                placeholder="Text…"
                                className="resize-none bg-background text-sm"
                                {...register(`actions.${index}.params.value` as any)}
                              />
                            ) : (
                              <Input
                                placeholder="Value"
                                className="h-8 bg-background text-sm"
                                {...register(`actions.${index}.params.value` as any)}
                              />
                            )}
                          </F>
                        </div>
                      )}
                    </div>
                  );
                })}

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full border-dashed text-xs"
                  onClick={() =>
                    addAction({
                      type: "create_task",
                      params: { title: "", priority: "normal", dueDateDays: 3, assigneeId: "" },
                    } as any)
                  }
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Action
                </Button>
              </TabsContent>
            </Tabs>
          </div>

          <DialogFooter className="border-t bg-muted/30 px-6 py-4">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} className="min-w-[120px]">
              {isSubmitting && <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? "Save Changes" : "Create Rule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
