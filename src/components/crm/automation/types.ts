import { z } from "zod"

// ─── Entities & Events ────────────────────────────────────────────────────────

export const TARGET_ENTITIES = ["deal", "lead", "contact", "company"] as const
export const TRIGGER_EVENTS  = ["onCreate", "onUpdate"] as const

export type TargetEntity = typeof TARGET_ENTITIES[number]
export type TriggerEvent  = typeof TRIGGER_EVENTS[number]

// ─── Condition Operators ──────────────────────────────────────────────────────

export const CONDITION_OPERATORS = [
  "equals",
  "not_equals",
  "greater_than",
  "less_than",
  "greater_than_or_equal",
  "less_than_or_equal",
  "contains",
  "not_contains",
  "is_empty",
  "is_not_empty",
  "changed",       // field changed at all (old !== new)
  "changed_to",    // field changed to a specific value
  "changed_from",  // field changed from a specific value
] as const

export type ConditionOperator = typeof CONDITION_OPERATORS[number]

export const ConditionSchema = z.object({
  field:    z.string().min(1),
  operator: z.enum(CONDITION_OPERATORS),
  value:    z.union([z.string(), z.number(), z.boolean()]).optional(),
  logic:    z.enum(["AND", "OR"]).default("AND"), // Logica PRIMA di questa condizione
})

export type Condition = z.infer<typeof ConditionSchema>

// ─── Actions  (strict discriminated union = security boundary) ────────────────
//
//  Any unrecognised `type` value is rejected by Zod BEFORE reaching
//  ActionDispatcher, so injection of e.g. "delete_user" is impossible.

export const CreateTaskActionSchema = z.object({
  type: z.literal("create_task"),
  params: z.object({
    title:       z.string().min(1).max(255),
    description: z.string().max(2000).optional(),
    priority:    z.enum(["low", "normal", "high"]).default("normal"),
    // days from now when the task is due (0 = today)
    dueDateDays: z.number().int().min(0).max(365).optional(),
    // resolved to a real user id; "entity_owner" resolves at runtime
    assigneeId:  z.string().optional(),
  }),
})

export const SendNotificationActionSchema = z.object({
  type: z.literal("send_notification"),
  params: z.object({
    // "entity_owner" is a special sentinel resolved at runtime
    userId:  z.union([z.string(), z.literal("entity_owner")]),
    title:   z.string().min(1).max(255),
    message: z.string().max(1000),
  }),
})

export const UpdateFieldActionSchema = z.object({
  type: z.literal("update_field"),
  params: z.object({
    // Only non-destructive, non-relational scalar fields are allowed
    field: z.enum(["status", "probability", "notes", "rating", "type"]),
    value: z.string().max(500),
  }),
})

export const SendEmailActionSchema = z.object({
  type: z.literal("send_email"),
  params: z.object({
    // Email recipients can use merge fields: {{contact.email}}, {{lead.email}}, etc.
    to: z.string().min(1).max(500),
    cc: z.string().max(500).optional(),
    bcc: z.string().max(500).optional(),
    // Subject can use merge fields
    subject: z.string().min(1).max(255),
    // Body HTML can use merge fields
    body: z.string().min(1).max(10000),
    // Track opens/clicks
    trackOpens: z.boolean().default(false),
    trackClicks: z.boolean().default(false),
  }),
})

export const SendWebhookActionSchema = z.object({
  type: z.literal("send_webhook"),
  params: z.object({
    // URL endpoint (supports merge fields in URL)
    url: z.string().url().max(1000),
    // HTTP method
    method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).default("POST"),
    // Custom headers (supports merge fields in values)
    headers: z.record(z.string()).optional(),
    // Request body (supports merge fields)
    body: z.record(z.any()).optional(),
    // Retry count
    retryCount: z.number().int().min(0).max(10).default(3),
    // Timeout in milliseconds
    timeoutMs: z.number().int().min(1000).max(30000).default(10000),
  }),
})

export const ActionSchema = z.discriminatedUnion("type", [
  CreateTaskActionSchema,
  SendNotificationActionSchema,
  UpdateFieldActionSchema,
  SendEmailActionSchema,
  SendWebhookActionSchema,
])

export type AutomationAction = z.infer<typeof ActionSchema>

// ─── Full Rule (form + server validation) ─────────────────────────────────────

// A trigger item is either a known event ("onCreate" | "onUpdate")
// or a scheduled cron string in the form "scheduled:0 8 * * *".
const TriggerItemSchema = z.union([
  z.enum(TRIGGER_EVENTS),
  z.string().regex(/^scheduled:.+/, "Scheduled trigger must be in the form 'scheduled:<cron>'"),
])

export const AutomationRuleFormSchema = z.object({
  name:                 z.string().min(1, "Name is required").max(255),
  description:          z.string().max(1000).optional(),
  isActive:             z.boolean().default(true),
  targetEntity:         z.enum(TARGET_ENTITIES),
  triggerOn:            z.array(TriggerItemSchema).min(1, "Select at least one trigger event"),
  // Legacy: supporto backward compatibility
  conditionLogic:       z.enum(["AND", "OR"]).default("AND").optional(),
  conditions:           z.array(ConditionSchema).min(1, "At least one condition is required"),
  // Espressione logica avanzata per condizioni complesse
  // Esempi: "(C0 AND C1) OR C2", "NOT C0 AND (C1 OR C2)"
  conditionExpression:  z.string().max(1000).optional(),
  actions:              z.array(ActionSchema).min(1, "At least one action is required"),
})

export type AutomationRuleFormData = z.infer<typeof AutomationRuleFormSchema>

// ─── Runtime context passed to the engine ────────────────────────────────────

export interface RuleContext {
  entityType:    TargetEntity
  entityId:      string
  event:         TriggerEvent
  oldData:       Record<string, unknown>
  newData:       Record<string, unknown>
  currentUserId?: string
}

// ─── Field registry — what fields are exposed per entity ─────────────────────
//
//  Used by the RuleBuilder UI to render field selectors and correct
//  operator lists. Keep in sync with the actual DB columns.

export type FieldType = "text" | "number" | "enum" | "boolean"

export interface FieldDef {
  key:     string           // matches the Drizzle column camelCase name
  label:   string           // human-readable
  type:    FieldType
  options?: { value: string; label: string }[]  // for "enum" fields
}

export const ENTITY_FIELDS: Record<TargetEntity, FieldDef[]> = {
  deal: [
    { key: "name",     label: "Name",        type: "text" },
    { key: "amount",   label: "Amount",      type: "number" },
    { key: "currency", label: "Currency",    type: "text" },
    { key: "probability", label: "Probability (%)", type: "number" },
    { key: "status",   label: "Status",      type: "enum",
      options: [
        { value: "open", label: "Open" },
        { value: "won",  label: "Won" },
        { value: "lost", label: "Lost" },
      ],
    },
    { key: "stageId",  label: "Stage (ID)",  type: "text" },
    { key: "notes",    label: "Notes",       type: "text" },
  ],
  lead: [
    { key: "firstName",  label: "First Name",   type: "text" },
    { key: "lastName",   label: "Last Name",    type: "text" },
    { key: "status",     label: "Status",       type: "enum",
      options: [
        { value: "new",          label: "New" },
        { value: "contacting",   label: "Contacting" },
        { value: "engaged",      label: "Engaged" },
        { value: "qualified",    label: "Qualified" },
        { value: "unqualified",  label: "Unqualified" },
      ],
    },
    { key: "rating",     label: "Rating",       type: "enum",
      options: [
        { value: "hot",  label: "Hot" },
        { value: "warm", label: "Warm" },
        { value: "cold", label: "Cold" },
      ],
    },
    { key: "leadScore",  label: "Lead Score",   type: "number" },
    { key: "source",     label: "Source",       type: "text" },
    { key: "isConverted", label: "Converted",   type: "boolean" },
  ],
  contact: [
    { key: "firstName",  label: "First Name",   type: "text" },
    { key: "lastName",   label: "Last Name",    type: "text" },
    { key: "status",     label: "Status",       type: "text" },
    { key: "leadScore",  label: "Lead Score",   type: "number" },
    { key: "source",     label: "Source",       type: "text" },
  ],
  company: [
    { key: "name",          label: "Name",          type: "text" },
    { key: "type",          label: "Type",          type: "enum",
      options: [
        { value: "prospect", label: "Prospect" },
        { value: "customer", label: "Customer" },
        { value: "partner",  label: "Partner" },
        { value: "vendor",   label: "Vendor" },
      ],
    },
    { key: "status",        label: "Status",        type: "text" },
    { key: "employeeCount", label: "Employee Count", type: "number" },
    { key: "annualRevenue", label: "Annual Revenue", type: "number" },
    { key: "industry",      label: "Industry",      type: "text" },
  ],
}

// Operators valid per field type
export const OPERATORS_BY_TYPE: Record<FieldType, ConditionOperator[]> = {
  text: [
    "equals", "not_equals", "contains", "not_contains",
    "is_empty", "is_not_empty", "changed", "changed_to", "changed_from",
  ],
  number: [
    "equals", "not_equals", "greater_than", "less_than",
    "greater_than_or_equal", "less_than_or_equal", "changed", "changed_to",
  ],
  enum: [
    "equals", "not_equals", "changed", "changed_to", "changed_from",
  ],
  boolean: [
    "equals", "not_equals", "changed",
  ],
}
