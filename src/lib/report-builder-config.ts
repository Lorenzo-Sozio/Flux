// Plain module — no "use server". Shared between the server actions file and client components.

// ── Field / Entity metadata ───────────────────────────────────────────────────

export type FieldType = "text" | "number" | "date" | "boolean" | "enum";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  enumValues?: string[];
  aggregatable?: boolean;
  groupable?: boolean;
}

export interface EntityConfig {
  label: string;
  fields: FieldDef[];
}

export const ENTITY_CONFIGS: Record<string, EntityConfig> = {
  deals: {
    label: "Deals",
    fields: [
      { key: "name", label: "Name", type: "text" },
      { key: "amount", label: "Amount", type: "number", aggregatable: true },
      { key: "currency", label: "Currency", type: "text", groupable: true },
      { key: "probability", label: "Probability (%)", type: "number", aggregatable: true, groupable: true },
      { key: "status", label: "Status", type: "enum", enumValues: ["open", "won", "lost"], groupable: true },
      { key: "healthScore", label: "Health Score", type: "number", aggregatable: true },
      { key: "expectedCloseDate", label: "Expected Close", type: "date" },
      { key: "createdAt", label: "Created At", type: "date", groupable: true },
    ],
  },
  contacts: {
    label: "Contacts",
    fields: [
      { key: "firstName", label: "First Name", type: "text" },
      { key: "lastName", label: "Last Name", type: "text" },
      { key: "email", label: "Email", type: "text" },
      { key: "phone", label: "Phone", type: "text" },
      { key: "jobTitle", label: "Job Title", type: "text" },
      { key: "source", label: "Source", type: "text", groupable: true },
      { key: "status", label: "Status", type: "enum", enumValues: ["active", "inactive"], groupable: true },
      { key: "leadScore", label: "Lead Score", type: "number", aggregatable: true },
      { key: "marketingConsent", label: "Marketing Consent", type: "boolean", groupable: true },
      { key: "country", label: "Country", type: "text", groupable: true },
      { key: "createdAt", label: "Created At", type: "date", groupable: true },
    ],
  },
  companies: {
    label: "Companies",
    fields: [
      { key: "name", label: "Name", type: "text" },
      { key: "industry", label: "Industry", type: "text", groupable: true },
      {
        key: "type",
        label: "Type",
        type: "enum",
        enumValues: ["prospect", "customer", "partner", "vendor"],
        groupable: true,
      },
      { key: "employeeCount", label: "Employees", type: "number", aggregatable: true },
      { key: "annualRevenue", label: "Annual Revenue", type: "number", aggregatable: true },
      { key: "country", label: "Country", type: "text", groupable: true },
      { key: "source", label: "Source", type: "text", groupable: true },
      { key: "status", label: "Status", type: "enum", enumValues: ["active", "inactive"], groupable: true },
      { key: "createdAt", label: "Created At", type: "date", groupable: true },
    ],
  },
  leads: {
    label: "Leads",
    fields: [
      { key: "firstName", label: "First Name", type: "text" },
      { key: "lastName", label: "Last Name", type: "text" },
      { key: "email", label: "Email", type: "text" },
      { key: "companyName", label: "Company", type: "text" },
      {
        key: "status",
        label: "Status",
        type: "enum",
        enumValues: ["new", "contacting", "engaged", "qualified", "unqualified"],
        groupable: true,
      },
      { key: "source", label: "Source", type: "text", groupable: true },
      { key: "rating", label: "Rating", type: "enum", enumValues: ["hot", "warm", "cold"], groupable: true },
      { key: "leadScore", label: "Lead Score", type: "number", aggregatable: true },
      { key: "isConverted", label: "Converted", type: "boolean", groupable: true },
      { key: "industry", label: "Industry", type: "text", groupable: true },
      { key: "country", label: "Country", type: "text", groupable: true },
      { key: "createdAt", label: "Created At", type: "date", groupable: true },
    ],
  },
  quotes: {
    label: "Quotes",
    fields: [
      { key: "quoteNumber", label: "Quote #", type: "text" },
      {
        key: "status",
        label: "Status",
        type: "enum",
        enumValues: ["draft", "pending_approval", "sent", "viewed", "accepted", "declined", "expired"],
        groupable: true,
      },
      { key: "totalAmount", label: "Total Amount", type: "number", aggregatable: true },
      { key: "subtotal", label: "Subtotal", type: "number", aggregatable: true },
      { key: "currency", label: "Currency", type: "text", groupable: true },
      { key: "issuedAt", label: "Issued At", type: "date", groupable: true },
      { key: "expiresAt", label: "Expires At", type: "date" },
      { key: "createdAt", label: "Created At", type: "date", groupable: true },
    ],
  },
  activities: {
    label: "Activities",
    fields: [
      { key: "type", label: "Type", type: "enum", enumValues: ["note", "call", "meeting", "email"], groupable: true },
      { key: "content", label: "Content", type: "text" },
      { key: "date", label: "Date", type: "date", groupable: true },
      { key: "durationMinutes", label: "Duration (min)", type: "number", aggregatable: true },
      { key: "createdAt", label: "Created At", type: "date", groupable: true },
    ],
  },
  tasks: {
    label: "Tasks",
    fields: [
      { key: "title", label: "Title", type: "text" },
      { key: "status", label: "Status", type: "enum", enumValues: ["todo", "in_progress", "done"], groupable: true },
      {
        key: "priority",
        label: "Priority",
        type: "enum",
        enumValues: ["low", "normal", "high", "critical", "blocker"],
        groupable: true,
      },
      { key: "dueDate", label: "Due Date", type: "date", groupable: true },
      { key: "estimatedHours", label: "Est. Hours", type: "number", aggregatable: true },
      { key: "actualHours", label: "Actual Hours", type: "number", aggregatable: true },
      { key: "progressPct", label: "Progress (%)", type: "number", aggregatable: true },
      { key: "createdAt", label: "Created At", type: "date", groupable: true },
    ],
  },
};

// ── Filter / Report types ─────────────────────────────────────────────────────

export type FilterOperator =
  | "eq"
  | "neq"
  | "contains"
  | "not_contains"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "is_empty"
  | "is_not_empty";

export interface FilterCondition {
  field: string;
  operator: FilterOperator;
  value: string;
}

export type AggregationFn = "count" | "sum" | "avg" | "min" | "max";
export type ChartType = "table" | "bar" | "line" | "area" | "pie";
export type SortDir = "asc" | "desc";

/**
 * How a date is bucketed when grouping by it.
 *
 * Grouping by a raw timestamp produces one row per record, which is not a
 * grouping at all — and `createdAt` was marked groupable on almost every
 * entity, so the most obvious thing to ask for was the thing that did not work
 * (audit rilievo C-09).
 */
export const DATE_BUCKETS = ["day", "week", "month", "quarter", "year"] as const;
export type DateBucket = (typeof DATE_BUCKETS)[number];

export interface ReportConfig {
  entity: string;
  fields: string[];
  filters: FilterCondition[];
  groupBy?: string;
  /** Only meaningful when `groupBy` names a date field. Defaults to month. */
  groupByBucket?: DateBucket;
  aggregation?: AggregationFn;
  aggregationField?: string;
  chartType: ChartType;
  sortBy?: string;
  sortDir?: SortDir;
  limit: number;
}

export interface ReportColumn {
  key: string;
  label: string;
}
export interface ReportResult {
  rows: Record<string, unknown>[];
  columns: ReportColumn[];
  /**
   * How many rows match, not how many were returned.
   *
   * This used to be `rows.length` against a query capped at 1000, so a report
   * over five thousand records announced one thousand — a number that looks
   * like an answer and is a limit (audit rilievo C-09).
   */
  total: number;
  /** True when `total` exceeds what was returned, so the UI can say so. */
  truncated: boolean;
}

export interface SavedReport {
  id: string;
  name: string;
  config: ReportConfig;
  ownerId: string | null;
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
}
