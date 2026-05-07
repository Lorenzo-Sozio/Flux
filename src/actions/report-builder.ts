"use server";

import { and, asc, avg, count, desc, eq, gt, gte, ilike, isNotNull, isNull, lt, lte, max, min, ne, sql, sum } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { activities, companies, contacts, deals, leads, quotes, savedReports, tasks } from "@/db/schema";
import { requireAdminAccess } from "@/lib/auth-guard";
import {
  ENTITY_CONFIGS,
  type AggregationFn,
  type FieldDef,
  type FilterCondition,
  type ReportConfig,
  type ReportResult,
  type SavedReport,
} from "@/lib/report-builder-config";

// Re-export types the client imports from this module path (type-only, erased at runtime).
export type {
  EntityConfig, FieldDef, FieldType,
  FilterCondition, FilterOperator,
  AggregationFn, ChartType, SortDir,
  ReportConfig, ReportColumn, ReportResult,
  SavedReport,
} from "@/lib/report-builder-config";

// ── Column reference maps ──────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ColMap = Record<string, any>;

const COLS: Record<string, ColMap> = {
  deals: {
    name: deals.name, amount: deals.amount, currency: deals.currency,
    probability: deals.probability, status: deals.status, healthScore: deals.healthScore,
    expectedCloseDate: deals.expectedCloseDate, createdAt: deals.createdAt,
  },
  contacts: {
    firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email,
    phone: contacts.phone, jobTitle: contacts.jobTitle, source: contacts.source,
    status: contacts.status, leadScore: contacts.leadScore,
    marketingConsent: contacts.marketingConsent, country: contacts.country,
    createdAt: contacts.createdAt,
  },
  companies: {
    name: companies.name, industry: companies.industry, type: companies.type,
    employeeCount: companies.employeeCount, annualRevenue: companies.annualRevenue,
    country: companies.country, source: companies.source, status: companies.status,
    createdAt: companies.createdAt,
  },
  leads: {
    firstName: leads.firstName, lastName: leads.lastName, email: leads.email,
    companyName: leads.companyName, status: leads.status, source: leads.source,
    rating: leads.rating, leadScore: leads.leadScore, isConverted: leads.isConverted,
    industry: leads.industry, country: leads.country, createdAt: leads.createdAt,
  },
  quotes: {
    quoteNumber: quotes.quoteNumber, status: quotes.status,
    totalAmount: quotes.totalAmount, subtotal: quotes.subtotal,
    currency: quotes.currency, issuedAt: quotes.issuedAt,
    expiresAt: quotes.expiresAt, createdAt: quotes.createdAt,
  },
  activities: {
    type: activities.type, content: activities.content, date: activities.date,
    durationMinutes: activities.durationMinutes, createdAt: activities.createdAt,
  },
  tasks: {
    title: tasks.title, status: tasks.status, priority: tasks.priority,
    dueDate: tasks.dueDate, estimatedHours: tasks.estimatedHours,
    actualHours: tasks.actualHours, progressPct: tasks.progressPct, createdAt: tasks.createdAt,
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TABLES: Record<string, any> = {
  deals, contacts, companies, leads, quotes, activities, tasks,
};

// ── Filter builder ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildFilterConditions(colMap: ColMap, fieldDefs: FieldDef[], filters: FilterCondition[]): any[] {
  return filters.flatMap((f) => {
    const col = colMap[f.field];
    if (!col) return [];
    const def = fieldDefs.find((d) => d.key === f.field);

    switch (f.operator) {
      case "eq":           return [eq(col, f.value)];
      case "neq":          return [ne(col, f.value)];
      case "contains":     return [ilike(col, `%${f.value}%`)];
      case "not_contains": return [sql`NOT (${col} ILIKE ${`%${f.value}%`})`];
      case "gt":           return [def?.type === "date" ? gt(col, new Date(f.value)) : gt(col, def?.type === "number" ? Number(f.value) : f.value)];
      case "gte":          return [def?.type === "date" ? gte(col, new Date(f.value)) : gte(col, def?.type === "number" ? Number(f.value) : f.value)];
      case "lt":           return [def?.type === "date" ? lt(col, new Date(f.value)) : lt(col, def?.type === "number" ? Number(f.value) : f.value)];
      case "lte":          return [def?.type === "date" ? lte(col, new Date(f.value)) : lte(col, def?.type === "number" ? Number(f.value) : f.value)];
      case "is_empty":     return [isNull(col)];
      case "is_not_empty": return [isNotNull(col)];
      default:             return [];
    }
  });
}

// ── Query execution ────────────────────────────────────────────────────────────

export async function runReport(config: ReportConfig): Promise<ReportResult> {
  await requireAdminAccess();

  const entityConfig = ENTITY_CONFIGS[config.entity];
  if (!entityConfig) throw new Error("Invalid entity");

  const colMap = COLS[config.entity];
  const table = TABLES[config.entity];
  const fieldDefs = entityConfig.fields;
  const limitClamped = Math.min(Math.max(config.limit ?? 200, 1), 1000);

  const conditions = buildFilterConditions(colMap, fieldDefs, config.filters ?? []);
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // ── Aggregate (group-by) mode ──────────────────────────────────────────────
  if (config.groupBy) {
    const groupCol = colMap[config.groupBy];
    if (!groupCol) throw new Error("Invalid groupBy field");

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
        aggFn === "sum" ? sum(numCol)
        : aggFn === "avg" ? avg(numCol)
        : aggFn === "min" ? min(aggCol)
        : max(aggCol);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = await (db as any)
      .select(selectObj)
      .from(table)
      .where(whereClause)
      .groupBy(groupCol)
      .orderBy(desc(count()))
      .limit(limitClamped);

    const groupFieldDef = fieldDefs.find((f) => f.key === config.groupBy);
    const columns = [
      { key: "_group", label: groupFieldDef?.label ?? config.groupBy ?? "Group" },
      { key: "_count", label: "Count" },
      ...(selectObj._agg
        ? [{ key: "_agg", label: `${aggFn.toUpperCase()} ${aggFieldDef?.label ?? ""}`.trim() }]
        : []),
    ];

    return { rows, columns, total: rows.length };
  }

  // ── List mode ──────────────────────────────────────────────────────────────
  const requestedFields = config.fields.filter((f) => colMap[f]);
  const activeFields = requestedFields.length > 0
    ? requestedFields
    : fieldDefs.slice(0, 5).map((f) => f.key);

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

  return { rows, columns, total: rows.length };
}

// ── Saved reports CRUD ─────────────────────────────────────────────────────────

export async function listSavedReports(): Promise<SavedReport[]> {
  await requireAdminAccess();
  const rows = await db.select().from(savedReports).orderBy(desc(savedReports.updatedAt));
  return rows.map((r) => ({ ...r, config: JSON.parse(r.config) as ReportConfig }));
}

export async function saveReport(name: string, config: ReportConfig): Promise<SavedReport> {
  const session = await requireAdminAccess();
  const [row] = await db
    .insert(savedReports)
    .values({ name, config: JSON.stringify(config), ownerId: session.user.id })
    .returning();
  revalidatePath("/dashboard/reports/builder");
  return { ...row, config };
}

export async function updateSavedReport(id: string, name: string, config: ReportConfig): Promise<void> {
  await requireAdminAccess();
  await db
    .update(savedReports)
    .set({ name, config: JSON.stringify(config), updatedAt: new Date() })
    .where(eq(savedReports.id, id));
  revalidatePath("/dashboard/reports/builder");
}

export async function deleteSavedReport(id: string): Promise<void> {
  await requireAdminAccess();
  await db.delete(savedReports).where(eq(savedReports.id, id));
  revalidatePath("/dashboard/reports/builder");
}
