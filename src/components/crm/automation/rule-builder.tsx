"use client";

import { useEffect, useState } from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowDown,
  ArrowUp,
  Bell,
  CheckSquare,
  GitMergeIcon,
  ListOrdered,
  Loader2Icon,
  Mail,
  PencilLine,
  Plus,
  RocketIcon,
  Send,
  Trash2,
  UserRoundCheck,
  Zap,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";

import { createAutomationRule, updateAutomationRule } from "@/actions/automation";
import { getAllUsers } from "@/actions/crm";
import { getEmailTemplates } from "@/actions/marketing";
import { getSequencesForEnrolling } from "@/actions/sequences";
import { getTerritories } from "@/actions/territories";
import {
  type AutomationRuleFormData,
  AutomationRuleFormSchema,
  CONDITION_OPERATORS,
  ENTITY_FIELDS,
  OPERATORS_BY_TYPE,
  ruleFormMessageKey,
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
import { isOwnedEntity } from "@/lib/round-robin";
import { cn } from "@/lib/utils";

import { ConditionExpressionEditor } from "./condition-expression-editor";
import { parseScheduledTrigger, SCHEDULED_TRIGGER_PREFIX } from "./scheduler-utils";

// ── Update-field options per entity ──────────────────────────────────────────

/**
 * Labels are looked up at render time: `fields.<labelKey ?? value>` for the field and
 * `options.<entity>.<field>.<value>` for an option (source options come from
 * `common.sources`). `label` on an option is a literal that is not language.
 */
type UpdField = {
  value: string;
  labelKey?: string;
  kind: "enum" | "number" | "text" | "textarea";
  options?: { value: string; label?: string; emoji?: string }[];
};

const SOURCE_OPTIONS = [
  "website",
  "referral",
  "linkedin",
  "cold_outreach",
  "trade_show",
  "advertisement",
  "email_campaign",
  "other",
].map((value) => ({ value }));

const UPDATE_FIELDS_BY_ENTITY: Record<string, UpdField[]> = {
  deal: [
    {
      value: "status",
      kind: "enum",
      options: [{ value: "open" }, { value: "won" }, { value: "lost" }],
    },
    { value: "probability", kind: "number" },
    {
      value: "currency",
      kind: "enum",
      options: [
        { value: "EUR", label: "EUR (€)" },
        { value: "USD", label: "USD ($)" },
        { value: "GBP", label: "GBP (£)" },
      ],
    },
    { value: "notes", kind: "textarea" },
  ],
  lead: [
    {
      value: "status",
      kind: "enum",
      options: [
        { value: "new" },
        { value: "contacting" },
        { value: "engaged" },
        { value: "qualified" },
        { value: "unqualified" },
      ],
    },
    {
      value: "rating",
      kind: "enum",
      options: [
        { value: "hot", emoji: "🔥" },
        { value: "warm", emoji: "☀️" },
        { value: "cold", emoji: "❄️" },
      ],
    },
    { value: "source", kind: "enum", options: SOURCE_OPTIONS },
    { value: "leadScore", labelKey: "leadScoreRange", kind: "number" },
    { value: "notes", kind: "textarea" },
  ],
  contact: [
    { value: "status", kind: "text" },
    { value: "source", kind: "enum", options: SOURCE_OPTIONS },
    { value: "jobTitle", kind: "text" },
    { value: "leadScore", labelKey: "leadScoreRange", kind: "number" },
    { value: "notes", kind: "textarea" },
  ],
  company: [
    { value: "status", kind: "text" },
    {
      value: "type",
      kind: "enum",
      options: [{ value: "prospect" }, { value: "customer" }, { value: "partner" }, { value: "vendor" }],
    },
    { value: "industry", kind: "text" },
  ],
  ticket: [
    {
      value: "status",
      kind: "enum",
      options: [
        { value: "new" },
        { value: "open" },
        { value: "in_progress" },
        { value: "waiting" },
        { value: "on_hold" },
        { value: "resolved" },
        { value: "closed" },
      ],
    },
    {
      value: "priority",
      kind: "enum",
      options: [{ value: "low" }, { value: "normal" }, { value: "high" }, { value: "urgent" }],
    },
  ],
  // Only what a rule has any business rewriting on an order: its state and the
  // note that travels with it. The figures are what the customer agreed to.
  order: [
    {
      value: "status",
      kind: "enum",
      options: [{ value: "draft" }, { value: "processing" }, { value: "completed" }, { value: "cancelled" }],
    },
    { value: "notes", kind: "textarea" },
  ],
};

// ── Constants ─────────────────────────────────────────────────────────────────

const ENTITY_EMOJI: Record<string, string> = {
  deal: "💼",
  lead: "🎯",
  contact: "👤",
  company: "🏢",
  ticket: "🎫",
  order: "🛒",
};

const ACTION_META: Record<string, { icon: React.ReactNode; color: string; bg: string }> = {
  create_task: {
    icon: <CheckSquare className="h-4 w-4" />,
    color: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800",
  },
  send_notification: {
    icon: <Bell className="h-4 w-4" />,
    color: "text-violet-600 dark:text-violet-400",
    bg: "bg-violet-50 dark:bg-violet-950/30 border-violet-200 dark:border-violet-800",
  },
  send_email: {
    icon: <Mail className="h-4 w-4" />,
    color: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800",
  },
  send_webhook: {
    icon: <Send className="h-4 w-4" />,
    color: "text-slate-600 dark:text-slate-400",
    bg: "bg-slate-50 dark:bg-slate-950/30 border-slate-200 dark:border-slate-800",
  },
  update_field: {
    icon: <PencilLine className="h-4 w-4" />,
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800",
  },
  assign_owner: {
    icon: <UserRoundCheck className="h-4 w-4" />,
    color: "text-sky-600 dark:text-sky-400",
    bg: "bg-sky-50 dark:bg-sky-950/30 border-sky-200 dark:border-sky-800",
  },
  enroll_in_sequence: {
    icon: <ListOrdered className="h-4 w-4" />,
    color: "text-teal-600 dark:text-teal-400",
    bg: "bg-teal-50 dark:bg-teal-950/30 border-teal-200 dark:border-teal-800",
  },
};

/** Merge-field examples shown in hints and placeholders: syntax, not language, so outside the messages. */
const MERGE_FIELDS_EMAIL = "deal.name, contact.email, owner.name, contact.firstName";
const MERGE_FIELDS_WEBHOOK = "deal.name, contact.email, owner.name, deal.amount";
const MERGE_TOKEN = "{{merge.fields}}";

/**
 * The prefix of a condition on something an assistant collected.
 *
 * ⚠️ It matches the `customFields` jsonb column, and the evaluator resolves dotted paths,
 * so `customFields.budget` reads the value written by whoever asked for it. The key is the
 * owner's own — a fixed list could never contain it.
 */
const RACCOLTO = "customFields.";

const NO_VALUE_OPERATORS = new Set(["is_empty", "is_not_empty", "changed"]);

// ── Field Helper (identical style to LeadModal) ───────────────────────────────

type PickableUser = { id: string; name: string | null; email: string | null };

/** People ticked in order; the number beside a name is its place in the rotation. */
function PeoplePicker({
  users,
  value,
  onChange,
  idPrefix,
}: {
  users: PickableUser[];
  value: string[];
  onChange: (next: string[]) => void;
  idPrefix: string;
}) {
  const t = useTranslations("automation.ruleBuilder");
  return (
    <div className="max-h-56 space-y-1 overflow-y-auto rounded border bg-background p-2">
      {users.length === 0 && <p className="px-1 py-2 text-muted-foreground text-xs">{t("assign.loadingPeople")}</p>}
      {users.map((u) => {
        const position = value.indexOf(u.id);
        const inputId = `${idPrefix}-${u.id}`;
        return (
          <div key={u.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/50">
            <Checkbox
              id={inputId}
              checked={position >= 0}
              onCheckedChange={(on) => onChange(on === true ? [...value, u.id] : value.filter((c) => c !== u.id))}
            />
            <label htmlFor={inputId} className="min-w-0 flex-1 cursor-pointer truncate">
              {u.name ?? u.email}
            </label>
            {position >= 0 && (
              <Badge variant="secondary" className="text-[10px]">
                {position + 1}
              </Badge>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * A comma-separated list edited as text.
 *
 * ⚠️ Holds its own text: re-deriving it from the parsed list on every keystroke
 * would delete the comma the moment it is typed, and nobody could add a second value.
 */
function ListInput({
  value,
  onChange,
  placeholder,
  id,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  id?: string;
}) {
  const [text, setText] = useState(value.join(", "));
  return (
    <Input
      id={id}
      className="h-8 bg-background text-sm"
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        onChange(
          e.target.value
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
        );
      }}
      onBlur={() => setText(value.join(", "))}
    />
  );
}

type RouteDraft = { id: string; territoryIds: string[]; sources: string[]; userIds: string[] };

/**
 * A schema message in the reader's language.
 *
 * types.ts raises English, because the same schema validates on the server; the
 * ones it owns are listed in RULE_FORM_MESSAGES and translated here. Anything else
 * (zod's own defaults) is shown as it came.
 */
function useRuleFormMessage() {
  const t = useTranslations("automation.ruleBuilder.validation");
  return (text: string | undefined) => {
    const key = ruleFormMessageKey(text);
    return key ? t(key) : text;
  };
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
  const message = useRuleFormMessage();
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
      {error && <p className="text-destructive text-xs">{message(error)}</p>}
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
  const t = useTranslations("automation.ruleBuilder");
  const tAutomation = useTranslations("automation");
  const tCommon = useTranslations("common");
  const formMessage = useRuleFormMessage();
  const [open, setOpen] = useState(false);
  const [userList, setUserList] = useState<{ id: string; name: string | null; email: string | null }[]>([]);
  const [territoryList, setTerritoryList] = useState<{ id: string; name: string }[]>([]);
  const [sequenceList, setSequenceList] = useState<{ id: string; name: string; entity: "lead" | "contact" }[]>([]);
  const [templateList, setTemplateList] = useState<
    { id: string; name: string; subject: string; body: string; category: string }[]
  >([]);
  const isEditing = !!rule;

  useEffect(() => {
    if (open) {
      getAllUsers().then(setUserList);
      // Routes by territory need the names; a workspace without the table yet just has none.
      getTerritories()
        .then((rows) => setTerritoryList(rows.map((r) => ({ id: r.id, name: r.name }))))
        .catch(() => setTerritoryList([]));
      Promise.all([getSequencesForEnrolling("lead"), getSequencesForEnrolling("contact")])
        .then(([forLeads, forContacts]) =>
          setSequenceList([
            ...forLeads.map((x) => ({ ...x, entity: "lead" as const })),
            ...forContacts.map((x) => ({ ...x, entity: "contact" as const })),
          ]),
        )
        .catch(() => setSequenceList([]));
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

  // Labels: the registry in types.ts carries English labels; a translation wins when one exists.
  const fieldLabel = (key: string, fallback?: string) =>
    t.has(`fields.${key}`) ? t(`fields.${key}`) : (fallback ?? key);
  const optionLabel = (field: string, opt: { value: string; label?: string; emoji?: string }) => {
    const key = `options.${targetEntity}.${field}.${opt.value}`;
    const text =
      field === "source" && tCommon.has(`sources.${opt.value}`)
        ? tCommon(`sources.${opt.value}`)
        : t.has(key)
          ? t(key)
          : (opt.label ?? opt.value);
    return opt.emoji ? `${opt.emoji} ${text}` : text;
  };

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
        toast.success(tAutomation("updateSuccess"));
      } else {
        const res = await createAutomationRule(data);
        if (!res.success) throw new Error(res.error);
        toast.success(tAutomation("createSuccess"));
      }
      setOpen(false);
      form.reset(EMPTY_DEFAULTS);
      onSaved?.();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : t("saveFailed"));
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

      <DialogContent className="flex flex-col gap-0 p-0 sm:max-w-[700px]">
        <DialogHeader className="border-b px-4 md:px-6 pt-6 pb-4">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Zap className="h-5 w-5 text-yellow-500" />
            {isEditing ? t("titleEdit", { name: rule.name }) : t("titleNew")}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4">
            <Tabs defaultValue="details">
              <TabsList className="mb-5 w-full">
                <TabsTrigger value="details" className="relative flex-1 gap-1.5">
                  <Zap className="h-3.5 w-3.5" />
                  {t("tabs.details")}
                  <TabDot has={tabErrors.details} />
                </TabsTrigger>
                <TabsTrigger value="trigger" className="relative flex-1 gap-1.5">
                  <RocketIcon className="h-3.5 w-3.5" />
                  {t("tabs.trigger")}
                  <TabDot has={tabErrors.trigger} />
                </TabsTrigger>
                <TabsTrigger value="conditions" className="relative flex-1 gap-1.5">
                  <GitMergeIcon className="h-3.5 w-3.5" />
                  {t("tabs.conditions")}
                  <TabDot has={tabErrors.conditions} />
                </TabsTrigger>
                <TabsTrigger value="actions" className="relative flex-1 gap-1.5">
                  <CheckSquare className="h-3.5 w-3.5" />
                  {t("tabs.actions")}
                  <TabDot has={tabErrors.actions} />
                </TabsTrigger>
              </TabsList>

              {/* ── Tab 1: Details ──────────────────────────────────────── */}
              <TabsContent value="details" className="mt-0 space-y-4">
                <F label={t("details.name")} required error={e.name?.message}>
                  <Input {...register("name")} placeholder={t("details.namePlaceholder")} />
                </F>
                <F label={t("details.description")}>
                  <Textarea
                    {...register("description")}
                    rows={3}
                    placeholder={t("details.descriptionPlaceholder")}
                    className="resize-none"
                  />
                </F>
                <Controller
                  control={control}
                  name="isActive"
                  render={({ field }) => (
                    <div className="flex items-center justify-between rounded-lg border px-4 py-3">
                      <div>
                        <p className="font-medium text-sm">{t("details.active")}</p>
                        <p className="text-muted-foreground text-xs">
                          {field.value ? t("details.activeOn") : t("details.activeOff")}
                        </p>
                      </div>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </div>
                  )}
                />
              </TabsContent>

              {/* ── Tab 2: Trigger ──────────────────────────────────────── */}
              <TabsContent value="trigger" className="mt-0 space-y-5">
                <F label={t("trigger.entity")} required>
                  <Controller
                    control={control}
                    name="targetEntity"
                    render={({ field }) => (
                      <div className="mt-0.5 grid grid-cols-3 gap-2">
                        {TARGET_ENTITIES.map((e) => {
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
                              <span className="text-xl leading-none">{ENTITY_EMOJI[e]}</span>
                              {tAutomation(`entities.${e}`)}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  />
                </F>

                <F label={t("trigger.fireWhen")} required error={e.triggerOn?.message as string | undefined}>
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
                                ? t("trigger.onCreate")
                                : ev === "onUpdate"
                                  ? t("trigger.onUpdate")
                                  : t("trigger.slaBreach")}
                            </button>
                          );
                        }}
                      />
                    ))}
                  </div>
                </F>

                {/* ── Scheduled Triggers ── */}
                <div className="mt-4 border-t pt-4">
                  <p className="mb-3 font-semibold text-muted-foreground text-xs">{t("trigger.orSchedule")}</p>
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
                            <span className="font-medium text-xs">{t("trigger.dailySchedule")}</span>
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
                                  {tCommon("remove")}
                                </Button>
                              )}
                            </div>
                            {scheduledTrigger && (
                              <p className="text-emerald-600 text-xs dark:text-emerald-400">
                                {t("trigger.scheduledAt", { time: timeValue })}
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
                      <p>{t("conditions.empty")}</p>
                      <p className="mt-1 text-xs">{t("conditions.emptyHint")}</p>
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

                            {/* Field selector.
                                ⚠️⚠️ **The collected-information option is what makes the
                                assistant's questions usable in a rule.** The registry above
                                lists the columns this CRM has; what an assistant collects is
                                named by whoever configured it — «metratura», «budget» — and
                                no fixed list can know those names in advance. The condition
                                path is a free string and the evaluator already walks dots,
                                so the only thing that was missing was a way to type one. */}
                            <Controller
                              control={control}
                              name={`conditions.${index}.field`}
                              render={({ field: f }) => {
                                const raccolto = String(f.value ?? "").startsWith(RACCOLTO);
                                return (
                                  <div className="flex flex-1 items-center gap-2">
                                    <Select
                                      value={raccolto ? RACCOLTO : f.value}
                                      onValueChange={(v) => f.onChange(v === RACCOLTO ? RACCOLTO : v)}
                                    >
                                      <SelectTrigger className="h-8 flex-1 text-xs">
                                        <SelectValue placeholder={t("conditions.selectField")} />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {entityFields.map((ef) => (
                                          <SelectItem key={ef.key} value={ef.key}>
                                            {fieldLabel(ef.key, ef.label)}
                                          </SelectItem>
                                        ))}
                                        <SelectItem value={RACCOLTO}>{t("conditions.collected")}</SelectItem>
                                      </SelectContent>
                                    </Select>
                                    {raccolto && (
                                      <Input
                                        className="h-8 flex-1 text-xs"
                                        placeholder={t("conditions.collectedPlaceholder")}
                                        value={String(f.value ?? "").slice(RACCOLTO.length)}
                                        onChange={(e) => f.onChange(RACCOLTO + e.target.value.trim())}
                                      />
                                    )}
                                  </div>
                                );
                              }}
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
                                    <SelectValue placeholder={t("conditions.operatorPlaceholder")} />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {allowedOps.map((op) => (
                                      <SelectItem key={op} value={op}>
                                        {t.has(`operators.${op}`) ? t(`operators.${op}`) : op}
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
                                        <SelectValue placeholder={t("conditions.valuePlaceholder")} />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {fieldDef.options?.map((opt) => (
                                          <SelectItem key={opt.value} value={opt.value}>
                                            {optionLabel(fieldDef.key, opt)}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  )}
                                />
                              ) : (
                                <Input
                                  className="h-8 w-32 flex-shrink-0 text-xs"
                                  placeholder={t("conditions.valuePlaceholder")}
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
                    {t("conditions.add")}
                  </Button>
                </div>

                {/* ── Advanced Expression Editor ── */}
                <div className="mt-6 border-t pt-4">
                  <details className="group">
                    <summary className="flex cursor-pointer select-none items-center gap-2 font-semibold text-muted-foreground text-sm hover:text-foreground">
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded border border-border transition-transform group-open:rotate-90">
                        ▶
                      </span>
                      {t("conditions.advanced")}
                    </summary>
                    <div className="mt-4 space-y-4 pt-4">
                      <ConditionExpressionEditor
                        conditions={watch("conditions")}
                        expression={watch("conditionExpression") ?? ""}
                        onChange={(expr) => setValue("conditionExpression", expr)}
                        onValidationChange={(_isValid) => {
                          // Deliberately nothing: the hook a save button would use
                          // to refuse an invalid expression, once one refuses.
                        }}
                      />
                    </div>
                  </details>
                </div>
              </TabsContent>

              {/* ── Tab 4: Actions ──────────────────────────────────────── */}
              <TabsContent value="actions" className="mt-0 space-y-3">
                {actionFields.length === 0 && (
                  <p className="py-4 text-center text-muted-foreground text-sm">{t("actions.empty")}</p>
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
                                  else if (v === "assign_owner")
                                    updateAction(index, {
                                      type: "assign_owner",
                                      params: { strategy: "round_robin", routes: [], userIds: [], overwrite: false },
                                    });
                                  else if (v === "enroll_in_sequence")
                                    updateAction(index, { type: "enroll_in_sequence", params: { sequenceId: "" } });
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
                                        {v.icon} {t(`actionTypes.${k}`)}
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
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                          <div className="col-span-1 sm:col-span-2">
                            <F label={t("task.title")} required error={actionErrs?.title?.message}>
                              <Input
                                className="h-8 bg-background text-sm"
                                placeholder={t("task.titlePlaceholder")}
                                // biome-ignore lint/suspicious/noExplicitAny: dynamic RHF path
                                {...register(`actions.${index}.params.title` as any)}
                              />
                            </F>
                          </div>

                          <F label={t("task.assignTo")}>
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
                                    <SelectValue placeholder={t("task.unassigned")} />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__unassigned__">{t("task.unassigned")}</SelectItem>
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

                          <F label={t("task.priority")}>
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
                                    <SelectItem value="low">🟢 {t("task.priorityLow")}</SelectItem>
                                    <SelectItem value="normal">🟡 {t("task.priorityNormal")}</SelectItem>
                                    <SelectItem value="high">🔴 {t("task.priorityHigh")}</SelectItem>
                                  </SelectContent>
                                </Select>
                              )}
                            />
                          </F>

                          <div className="col-span-1 sm:col-span-2">
                            <F label={t("task.dueIn")} error={actionErrs?.dueDateDays?.message}>
                              <div className="relative">
                                <Input
                                  type="number"
                                  min={0}
                                  max={365}
                                  placeholder={t("task.dueInPlaceholder")}
                                  className="h-8 bg-background pr-16 text-sm"
                                  {...register(`actions.${index}.params.dueDateDays` as any, { valueAsNumber: true })}
                                />
                                <span className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-3 text-muted-foreground text-xs">
                                  {t("task.days")}
                                </span>
                              </div>
                            </F>
                          </div>

                          <div className="col-span-1 sm:col-span-2">
                            <F label={t("task.description")}>
                              <Textarea
                                rows={2}
                                placeholder={t("task.descriptionPlaceholder")}
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
                          <F label={t("notification.notify")} error={actionErrs?.userId?.message}>
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
                                        👤 {t("notification.recordOwner")}{" "}
                                        <span className="text-muted-foreground text-xs">
                                          {t("notification.dynamic")}
                                        </span>
                                      </span>
                                    </SelectItem>
                                    {userList.length > 0 && (
                                      <>
                                        <div className="px-2 py-1 font-semibold text-[10px] text-muted-foreground uppercase tracking-wider">
                                          {t("notification.specificUser")}
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
                          <F label={t("notification.title")} required error={actionErrs?.title?.message}>
                            <Input
                              className="h-8 bg-background text-sm"
                              placeholder={t("notification.titlePlaceholder")}
                              {...register(`actions.${index}.params.title` as any)}
                            />
                          </F>
                          <F label={t("notification.message")} error={actionErrs?.message?.message}>
                            <Textarea
                              rows={2}
                              placeholder={t("notification.messagePlaceholder")}
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
                                      {t("email.template")}
                                    </span>
                                    {activeTpl && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          f.onChange(undefined);
                                        }}
                                        className="text-[11px] text-muted-foreground underline hover:text-destructive"
                                      >
                                        {t("email.clearTemplate")}
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
                                      <SelectValue placeholder={t("email.noTemplate")} />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="__none__">{t("email.noTemplate")}</SelectItem>
                                      {templateList.length > 0 && (
                                        <>
                                          <div className="px-2 py-1 font-semibold text-[10px] text-muted-foreground uppercase tracking-wider">
                                            {t("email.templates")}
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
                                      {t("email.templateNote")}
                                    </p>
                                  )}
                                </div>
                              );
                            }}
                          />

                          <div className="h-px bg-border/50" />

                          <F label={t("email.to")} required error={actionErrs?.to?.message}>
                            <Input
                              className="h-8 bg-background text-sm"
                              placeholder={t("email.toPlaceholder", { example: "{{contact.email}}" })}
                              {...register(`actions.${index}.params.to` as any)}
                            />
                          </F>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
                            <F label="CC">
                              <Input
                                className="h-8 bg-background text-sm"
                                placeholder={t("email.optionalCsv")}
                                {...register(`actions.${index}.params.cc` as any)}
                              />
                            </F>
                            <F label="BCC">
                              <Input
                                className="h-8 bg-background text-sm"
                                placeholder={t("email.optionalCsv")}
                                {...register(`actions.${index}.params.bcc` as any)}
                              />
                            </F>
                          </div>
                          <F label={t("email.subject")} error={actionErrs?.subject?.message}>
                            <Input
                              className="h-8 bg-background text-sm"
                              placeholder={t("email.subjectPlaceholder", { name: "{{deal.name}}" })}
                              {...register(`actions.${index}.params.subject` as any)}
                            />
                          </F>
                          <F label={t("email.body")} error={actionErrs?.body?.message}>
                            <Textarea
                              rows={5}
                              placeholder={t("email.bodyPlaceholder", { fields: MERGE_TOKEN })}
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
                                  <span className="text-xs">{t("email.trackOpens")}</span>
                                </div>
                              )}
                            />
                            <Controller
                              control={control}
                              name={`actions.${index}.params.trackClicks` as any}
                              render={({ field: f }) => (
                                <div className="flex items-center gap-2 rounded border px-3 py-2">
                                  <Checkbox checked={f.value ?? false} onCheckedChange={f.onChange} />
                                  <span className="text-xs">{t("email.trackClicks")}</span>
                                </div>
                              )}
                            />
                          </div>
                          <p className="rounded bg-muted/50 p-2 text-[11px] text-muted-foreground">
                            {t("email.mergeFields", { fields: MERGE_FIELDS_EMAIL })}
                          </p>
                        </div>
                      )}

                      {/* ── send_webhook params ── */}
                      {actionType === "send_webhook" && (
                        <div className="space-y-3">
                          <F label={t("webhook.url")} required error={actionErrs?.url?.message}>
                            <Input
                              className="h-8 bg-background text-sm"
                              placeholder={t("webhook.urlPlaceholder", { fields: MERGE_TOKEN })}
                              {...register(`actions.${index}.params.url` as any)}
                            />
                          </F>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                            <F label={t("webhook.method")}>
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

                            <F label={t("webhook.timeout")}>
                              <Input
                                type="number"
                                className="h-8 bg-background text-sm"
                                defaultValue="10000"
                                {...register(`actions.${index}.params.timeoutMs` as any, { valueAsNumber: true })}
                              />
                            </F>
                          </div>

                          <F label={t("webhook.body", { fields: MERGE_TOKEN })}>
                            <Textarea
                              className="min-h-24 bg-background font-mono text-sm"
                              placeholder={JSON.stringify({
                                message: t("webhook.bodyExample", { name: "{{deal.name}}", status: "{{deal.status}}" }),
                              }).replace(":", ": ")}
                              {...register(`actions.${index}.params.body` as any)}
                            />
                          </F>

                          <p className="rounded bg-muted/50 p-2 text-[11px] text-muted-foreground">
                            {t("webhook.mergeFields", { fields: MERGE_FIELDS_WEBHOOK })}
                          </p>
                        </div>
                      )}

                      {/* ── assign_owner params ── */}
                      {actionType === "assign_owner" && (
                        <div className="space-y-4">
                          {!isOwnedEntity(targetEntity) && (
                            <p className="rounded border border-destructive/40 bg-destructive/5 p-2 text-destructive text-xs">
                              {t("assign.noOwner")}
                            </p>
                          )}

                          <Controller
                            control={control}
                            // biome-ignore lint/suspicious/noExplicitAny: dynamic RHF path
                            name={`actions.${index}.params.routes` as any}
                            render={({ field: f }) => {
                              const routes: RouteDraft[] = Array.isArray(f.value) ? f.value : [];
                              const put = (i: number, patch: Partial<RouteDraft>) =>
                                f.onChange(routes.map((r, j) => (j === i ? { ...r, ...patch } : r)));
                              const move = (i: number, by: number) => {
                                const next = [...routes];
                                const [taken] = next.splice(i, 1);
                                next.splice(i + by, 0, taken);
                                f.onChange(next);
                              };
                              return (
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="min-w-0">
                                      <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                                        {t("assign.routes")}
                                      </p>
                                      <p className="text-[11px] text-muted-foreground">{t("assign.routesHint")}</p>
                                    </div>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      className="h-7 shrink-0 gap-1 text-xs"
                                      onClick={() =>
                                        f.onChange([
                                          ...routes,
                                          {
                                            id: crypto.randomUUID().slice(0, 8),
                                            territoryIds: [],
                                            sources: [],
                                            userIds: [],
                                          },
                                        ])
                                      }
                                    >
                                      <Plus className="h-3 w-3" /> {t("assign.addRoute")}
                                    </Button>
                                  </div>
                                  {actionErrs?.routes?.message && (
                                    <p className="text-destructive text-xs">{formMessage(actionErrs.routes.message)}</p>
                                  )}
                                  {routes.map((route, i) => {
                                    const routeErr = actionErrs?.routes?.[i];
                                    return (
                                      <div key={route.id} className="space-y-3 rounded-lg border bg-background/60 p-3">
                                        <div className="flex items-center justify-between gap-2">
                                          <span className="font-semibold text-xs">
                                            {t("assign.route", { n: i + 1 })}
                                          </span>
                                          <div className="flex gap-1">
                                            <Button
                                              type="button"
                                              variant="ghost"
                                              size="icon"
                                              className="h-6 w-6"
                                              disabled={i === 0}
                                              onClick={() => move(i, -1)}
                                              aria-label={t("assign.moveUp")}
                                            >
                                              <ArrowUp className="h-3 w-3" />
                                            </Button>
                                            <Button
                                              type="button"
                                              variant="ghost"
                                              size="icon"
                                              className="h-6 w-6"
                                              disabled={i === routes.length - 1}
                                              onClick={() => move(i, 1)}
                                              aria-label={t("assign.moveDown")}
                                            >
                                              <ArrowDown className="h-3 w-3" />
                                            </Button>
                                            <Button
                                              type="button"
                                              variant="ghost"
                                              size="icon"
                                              className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                              onClick={() => f.onChange(routes.filter((_, j) => j !== i))}
                                              aria-label={t("assign.remove")}
                                            >
                                              <Trash2 className="h-3 w-3" />
                                            </Button>
                                          </div>
                                        </div>
                                        {routeErr?.message && (
                                          <p className="text-destructive text-xs">{formMessage(routeErr.message)}</p>
                                        )}
                                        <F label={t("assign.territories")}>
                                          {territoryList.length === 0 ? (
                                            <p className="text-[11px] text-muted-foreground">
                                              {t("assign.noTerritories")}
                                            </p>
                                          ) : (
                                            <div className="flex flex-wrap gap-x-3 gap-y-1">
                                              {territoryList.map((terr) => {
                                                const inputId = `route-${index}-${route.id}-t-${terr.id}`;
                                                return (
                                                  <div key={terr.id} className="flex items-center gap-1.5 text-sm">
                                                    <Checkbox
                                                      id={inputId}
                                                      checked={route.territoryIds.includes(terr.id)}
                                                      onCheckedChange={(on) =>
                                                        put(i, {
                                                          territoryIds:
                                                            on === true
                                                              ? [...route.territoryIds, terr.id]
                                                              : route.territoryIds.filter((x) => x !== terr.id),
                                                        })
                                                      }
                                                    />
                                                    <label htmlFor={inputId} className="cursor-pointer">
                                                      {terr.name}
                                                    </label>
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          )}
                                        </F>
                                        <F label={t("assign.sources")}>
                                          <ListInput
                                            id={`route-${index}-${route.id}-sources`}
                                            value={route.sources}
                                            onChange={(sources) => put(i, { sources })}
                                            placeholder={t("assign.sourcesPlaceholder")}
                                          />
                                        </F>
                                        <F label={t("assign.shareAmong")} required>
                                          <PeoplePicker
                                            users={userList}
                                            value={route.userIds}
                                            onChange={(userIds) => put(i, { userIds })}
                                            idPrefix={`route-${index}-${route.id}`}
                                          />
                                        </F>
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            }}
                          />

                          <Controller
                            control={control}
                            // biome-ignore lint/suspicious/noExplicitAny: dynamic RHF path
                            name={`actions.${index}.params.userIds` as any}
                            render={({ field: f }) => (
                              <F
                                label={
                                  // biome-ignore lint/suspicious/noExplicitAny: dynamic RHF path
                                  (watch(`actions.${index}.params.routes` as any) as unknown[] | undefined)?.length
                                    ? t("assign.everyoneElse")
                                    : t("assign.shareAmong")
                                }
                                error={actionErrs?.userIds?.message}
                              >
                                <PeoplePicker
                                  users={userList}
                                  value={Array.isArray(f.value) ? f.value : []}
                                  onChange={f.onChange}
                                  idPrefix={`assign-${index}`}
                                />
                              </F>
                            )}
                          />
                          <Controller
                            control={control}
                            // biome-ignore lint/suspicious/noExplicitAny: dynamic RHF path
                            name={`actions.${index}.params.overwrite` as any}
                            render={({ field: f }) => (
                              <div className="flex items-center gap-2 rounded border bg-background px-3 py-2">
                                <Checkbox checked={f.value ?? false} onCheckedChange={f.onChange} />
                                <span className="text-xs">{t("assign.overwrite")}</span>
                              </div>
                            )}
                          />
                          <p className="rounded bg-muted/50 p-2 text-[11px] text-muted-foreground">
                            {t("assign.hint")}
                          </p>
                        </div>
                      )}

                      {/* ── enroll_in_sequence params ── */}
                      {actionType === "enroll_in_sequence" && (
                        <div className="space-y-2">
                          {targetEntity !== "lead" && targetEntity !== "contact" ? (
                            <p className="rounded border border-destructive/40 bg-destructive/5 p-2 text-destructive text-xs">
                              {t("sequence.wrongEntity")}
                            </p>
                          ) : (
                            <F label={t("sequence.label")} required error={actionErrs?.sequenceId?.message}>
                              <Controller
                                control={control}
                                // biome-ignore lint/suspicious/noExplicitAny: dynamic RHF path
                                name={`actions.${index}.params.sequenceId` as any}
                                render={({ field: f }) => {
                                  const options = sequenceList.filter((x) => x.entity === targetEntity);
                                  return options.length === 0 ? (
                                    <p className="text-muted-foreground text-xs">{t("sequence.none")}</p>
                                  ) : (
                                    <Select value={f.value ?? ""} onValueChange={f.onChange}>
                                      <SelectTrigger className="h-8 bg-background text-sm">
                                        <SelectValue placeholder={t("sequence.placeholder")} />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {options.map((x) => (
                                          <SelectItem key={x.id} value={x.id}>
                                            {x.name}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  );
                                }}
                              />
                            </F>
                          )}
                          <p className="rounded bg-muted/50 p-2 text-[11px] text-muted-foreground">
                            {t("sequence.hint")}
                          </p>
                        </div>
                      )}

                      {/* ── update_field params ── */}
                      {actionType === "update_field" && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                          {/* Field selector — context-aware per entity */}
                          <F label={t("update.field")} error={actionErrs?.field?.message}>
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
                                        {fieldLabel(uf.labelKey ?? uf.value)}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                            />
                          </F>

                          {/* Value — adapts to the selected field's kind */}
                          <F label={t("update.newValue")} required error={actionErrs?.value?.message}>
                            {updFieldDef?.kind === "enum" && updFieldDef.options ? (
                              <Controller
                                control={control}
                                name={`actions.${index}.params.value` as any}
                                render={({ field: f }) => (
                                  <Select value={f.value ?? ""} onValueChange={f.onChange}>
                                    <SelectTrigger className="h-8 bg-background text-sm">
                                      <SelectValue placeholder={t("update.selectPlaceholder")} />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {updFieldDef.options?.map((opt) => (
                                        <SelectItem key={opt.value} value={opt.value}>
                                          {optionLabel(updFieldDef.value, opt)}
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
                                placeholder={t("update.textPlaceholder")}
                                className="resize-none bg-background text-sm"
                                {...register(`actions.${index}.params.value` as any)}
                              />
                            ) : (
                              <Input
                                placeholder={t("update.valuePlaceholder")}
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
                  <Plus className="mr-1.5 h-3.5 w-3.5" /> {t("actions.add")}
                </Button>
              </TabsContent>
            </Tabs>
          </div>

          <DialogFooter className="border-t bg-muted/30 px-4 md:px-6 py-4">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" disabled={isSubmitting} className="min-w-[120px]">
              {isSubmitting && <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? t("saveChanges") : t("createRule")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
