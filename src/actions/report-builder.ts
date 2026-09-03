"use server";

import { revalidatePath } from "next/cache";

import {
  and,
  asc,
  avg,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  isNotNull,
  isNull,
  lt,
  lte,
  max,
  min,
  ne,
  sql,
  sum,
} from "drizzle-orm";

import { activities, companies, contacts, deals, leads, quotes, savedReports, tasks } from "@/db/schema";
import { requireCapability } from "@/lib/auth-guard";
import {
  type AggregationFn,
  type DateBucket,
  ENTITY_CONFIGS,
  type FieldDef,
  type FilterCondition,
  type ReportConfig,
  type ReportResult,
  type SavedReport,
} from "@/lib/report-builder-config";
import { getDb } from "@/lib/tenant-context";

// Re-export types the client imports from this module path (type-only, erased at runtime).
export type {
  AggregationFn,
  ChartType,
  EntityConfig,
  FieldDef,
  FieldType,
  FilterCondition,
  FilterOperator,
  ReportColumn,
  ReportConfig,
  ReportResult,
  SavedReport,
  SortDir,
} from "@/lib/report-builder-config";

// ── Column reference maps ──────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ColMap = Record<string, any>;

const COLS: Record<string, ColMap> = {
  deals: {
    name: deals.name,
    amount: deals.amount,
    currency: deals.currency,
    probability: deals.probability,
    status: deals.status,
    healthScore: deals.healthScore,
    expectedCloseDate: deals.expectedCloseDate,
    createdAt: deals.createdAt,
  },
  contacts: {
    firstName: contacts.firstName,
    lastName: contacts.lastName,
    email: contacts.email,
    phone: contacts.phone,
    jobTitle: contacts.jobTitle,
    source: contacts.source,
    status: contacts.status,
    leadScore: contacts.leadScore,
    marketingConsent: contacts.marketingConsent,
    country: contacts.country,
    createdAt: contacts.createdAt,
  },
  companies: {
    name: companies.name,
    industry: companies.industry,
    type: companies.type,
    employeeCount: companies.employeeCount,
    annualRevenue: companies.annualRevenue,
    country: companies.country,
    source: companies.source,
    status: companies.status,
    createdAt: companies.createdAt,
  },
  leads: {
    firstName: leads.firstName,
    lastName: leads.lastName,
    email: leads.email,
    companyName: leads.companyName,
    status: leads.status,
    source: leads.source,
    rating: leads.rating,
    leadScore: leads.leadScore,
    isConverted: leads.isConverted,
    industry: leads.industry,
    country: leads.country,
    createdAt: leads.createdAt,
  },
  quotes: {
    quoteNumber: quotes.quoteNumber,
    status: quotes.status,
    totalAmount: quotes.totalAmount,
    subtotal: quotes.subtotal,
    currency: quotes.currency,
    issuedAt: quotes.issuedAt,
    expiresAt: quotes.expiresAt,
    createdAt: quotes.createdAt,
  },
  activities: {
    type: activities.type,
    content: activities.content,
    date: activities.date,
    durationMinutes: activities.durationMinutes,
    createdAt: activities.createdAt,
  },
  tasks: {
    title: tasks.title,
    status: tasks.status,
    priority: tasks.priority,
    dueDate: tasks.dueDate,
    estimatedHours: tasks.estimatedHours,
    actualHours: tasks.actualHours,
    progressPct: tasks.progressPct,
    createdAt: tasks.createdAt,
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TABLES: Record<string, any> = {
  deals,
  contacts,
  companies,
  leads,
  quotes,
  activities,
  tasks,
};

// ── Filter builder ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildFilterConditions(colMap: ColMap, fieldDefs: FieldDef[], filters: FilterCondition[]): any[] {
  return filters.flatMap((f) => {
    const col = colMap[f.field];
    if (!col) return [];
    const def = fieldDefs.find((d) => d.key === f.field);

    switch (f.operator) {
      case "eq":
        return [eq(col, f.value)];
      case "neq":
        return [ne(col, f.value)];
      case "contains":
        return [ilike(col, `%${f.value}%`)];
      case "not_contains":
        return [sql`NOT (${col} ILIKE ${`%${f.value}%`})`];
      case "gt":
        return [
          def?.type === "date"
            ? gt(col, new Date(f.value))
            : gt(col, def?.type === "number" ? Number(f.value) : f.value),
        ];
      case "gte":
        return [
          def?.type === "date"
            ? gte(col, new Date(f.value))
            : gte(col, def?.type === "number" ? Number(f.value) : f.value),
        ];
      case "lt":
        return [
          def?.type === "date"
            ? lt(col, new Date(f.value))
            : lt(col, def?.type === "number" ? Number(f.value) : f.value),
        ];
      case "lte":
        return [
          def?.type === "date"
            ? lte(col, new Date(f.value))
            : lte(col, def?.type === "number" ? Number(f.value) : f.value),
        ];
      case "is_empty":
        return [isNull(col)];
      case "is_not_empty":
        return [isNotNull(col)];
      default:
        return [];
    }
  });
}

// ── Grouping helpers ───────────────────────────────────────────────────────────

/**
 * The expression a group-by uses for a column.
 *
 * A date is truncated to the requested bucket. Grouping by the raw value gives
 * one group per distinct timestamp — which for `createdAt` means one group per
 * record, and a report that answers nothing (audit rilievo C-09).
 */
function groupExpression(col: unknown, fieldDef: FieldDef | undefined, bucket: DateBucket) {
  if (fieldDef?.type !== "date") return col as never;
  return sql`date_trunc(${bucket}, ${col})` as never;
}

/** Reads better than "Created At" alone once the values are buckets. */
function groupLabel(fieldLabel: string, fieldDef: FieldDef | undefined, bucket: DateBucket): string {
  if (fieldDef?.type !== "date") return fieldLabel;
  return `${fieldLabel} (${bucket})`;
}

// ── Query execution ────────────────────────────────────────────────────────────

/**
 * Runs a report.
 *
 * Reading needs no more authority than reading the rows behind it. Every action
 * in this file required admin, so a sales manager could not open a report that
 * had been saved for them (audit rilievo U-10). Saving and deleting a shared
 * report stays privileged.
 */
export async function runReport(config: ReportConfig): Promise<ReportResult> {
  await requireCapability("report:read");
  const db = await getDb();

  const entityConfig = ENTITY_CONFIGS[config.entity];
  if (!entityConfig) throw new Error("Invalid entity");

  const colMap = COLS[config.entity];
  const table = TABLES[config.entity];
  const fieldDefs = entityConfig.fields;
  const limitClamped = Math.min(Math.max(config.limit ?? 200, 1), 1000);

  const conditions = buildFilterConditions(colMap, fieldDefs, config.filters ?? []);
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  /**
   * How many rows match — asked separately, because the row query is capped.
   *
   * In group mode this counts the groups, which is what the reader is looking at.
   */
  const countMatching = async (groupCol?: unknown): Promise<number> => {
    if (groupCol) {
      const [row] = await (db as any)
        .select({ n: sql<number>`count(distinct ${groupCol})::int` })
        .from(table)
        .where(whereClause);
      return Number(row?.n ?? 0);
    }
    const [row] = await (db as any).select({ n: count() }).from(table).where(whereClause);
    return Number(row?.n ?? 0);
  };

  // ── Aggregate (group-by) mode ──────────────────────────────────────────────
  if (config.groupBy) {
    const rawGroupCol = colMap[config.groupBy];
    if (!rawGroupCol) throw new Error("Invalid groupBy field");

    const groupFieldDefEarly = fieldDefs.find((f) => f.key === config.groupBy);
    const bucket: DateBucket = config.groupByBucket ?? "month";
    const groupCol = groupExpression(rawGroupCol, groupFieldDefEarly, bucket);

    const selectObj: Record<string, unknown> = {
      _group: groupCol,
      _count: count(),
    };

    const aggFn = (config.aggregation ?? "count") as AggregationFn;
    const aggFieldDef = fieldDefs.find((f) => f.key === config.aggregationField);
    const aggCol = config.aggregationField ? colMap[config.aggregationField] : null;

    if (aggCol && aggFn !== "count" && aggFieldDef?.aggregatable) {
      const numCol = sql`CAST(${aggCol} AS NUMERIC)`;
      selectObj._agg =
        aggFn === "sum" ? sum(numCol) : aggFn === "avg" ? avg(numCol) : aggFn === "min" ? min(aggCol) : max(aggCol);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = await (db as any)
      .select(selectObj)
      .from(table)
      .where(whereClause)
      .groupBy(groupCol)
      .orderBy(desc(count()))
      .limit(limitClamped);

    const groupFieldDef = groupFieldDefEarly;
    const columns = [
      {
        key: "_group",
        label: groupLabel(groupFieldDef?.label ?? config.groupBy ?? "Group", groupFieldDef, bucket),
      },
      { key: "_count", label: "Count" },
      ...(selectObj._agg ? [{ key: "_agg", label: `${aggFn.toUpperCase()} ${aggFieldDef?.label ?? ""}`.trim() }] : []),
    ];

    const total = await countMatching(groupCol);
    return { rows, columns, total, truncated: total > rows.length };
  }

  // ── List mode ──────────────────────────────────────────────────────────────
  const requestedFields = config.fields.filter((f) => colMap[f]);
  const activeFields = requestedFields.length > 0 ? requestedFields : fieldDefs.slice(0, 5).map((f) => f.key);

  const selectObj = Object.fromEntries(activeFields.map((f) => [f, colMap[f]]));

  const sortCol = config.sortBy && colMap[config.sortBy] ? colMap[config.sortBy] : colMap[activeFields[0]];
  const order = config.sortDir === "asc" ? asc(sortCol) : desc(sortCol);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = await (db as any)
    .select(selectObj)
    .from(table)
    .where(whereClause)
    .orderBy(order)
    .limit(limitClamped);

  const columns = activeFields.map((f) => ({
    key: f,
    label: fieldDefs.find((d) => d.key === f)?.label ?? f,
  }));

  const total = await countMatching();
  return { rows, columns, total, truncated: total > rows.length };
}

// ── Saved reports CRUD ─────────────────────────────────────────────────────────

export async function listSavedReports(): Promise<SavedReport[]> {
  await requireCapability("report:read");
  const db = await getDb();
  const rows = await db.select().from(savedReports).orderBy(desc(savedReports.updatedAt));
  return rows.map((r) => ({ ...r, config: JSON.parse(r.config) as ReportConfig }));
}

export async function saveReport(name: string, config: ReportConfig): Promise<SavedReport> {
  const session = await requireCapability("report:manage");
  const db = await getDb();
  const [row] = await db
    .insert(savedReports)
    .values({ name, config: JSON.stringify(config), ownerId: session.userId })
    .returning();
  revalidatePath("/dashboard/reports/builder");
  return { ...row, config };
}

export async function updateSavedReport(id: string, name: string, config: ReportConfig): Promise<void> {
  await requireCapability("report:manage");
  const db = await getDb();
  await db
    .update(savedReports)
    .set({ name, config: JSON.stringify(config), updatedAt: new Date() })
    .where(eq(savedReports.id, id));
  revalidatePath("/dashboard/reports/builder");
}

export async function deleteSavedReport(id: string): Promise<void> {
  await requireCapability("report:manage");
  const db = await getDb();
  await db.delete(savedReports).where(eq(savedReports.id, id));
  revalidatePath("/dashboard/reports/builder");
}
