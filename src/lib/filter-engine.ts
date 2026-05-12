/**
 * filter-engine.ts — SERVER ONLY (imports Drizzle schema)
 * Translates FilterTree → Drizzle WHERE clause.
 */

import {
  and, or, eq, ne, gt, gte, lt, lte,
  ilike, inArray, notInArray, between, sql, SQL, not,
} from "drizzle-orm";
import { leads, contacts, companies, deals } from "@/db/schema";
import type {
  FilterTree, FilterNode, FilterCondition,
  FilterGroup, FieldType, FilterOperator,
  FilterValue, FieldMeta, FieldMetaMap,
} from "@/lib/filter-types";
import { NO_VALUE_OPERATORS } from "@/lib/filter-types";

// ─── Field registry (server-only, includes Drizzle cols) ─────────────────────

export type FieldDef = FieldMeta & { col: any };
export type FieldRegistry = Record<string, FieldDef>;

export const LEAD_FIELDS: FieldRegistry = {
  firstName:        { label: "First Name",       type: "text",    col: leads.firstName },
  lastName:         { label: "Last Name",        type: "text",    col: leads.lastName },
  email:            { label: "Email",            type: "text",    col: leads.email },
  phone:            { label: "Phone",            type: "text",    col: leads.phone },
  companyName:      { label: "Company Name",     type: "text",    col: leads.companyName },
  jobTitle:         { label: "Job Title",        type: "text",    col: leads.jobTitle },
  industry:         { label: "Industry",         type: "text",    col: leads.industry },
  city:             { label: "City",             type: "text",    col: leads.city },
  state:            { label: "Region / Province",type: "text",    col: leads.state },
  country:          { label: "Country",          type: "text",    col: leads.country },
  status:           { label: "Status",           type: "enum",    col: leads.status,
                      options: ["new","contacting","engaged","qualified","unqualified","converted"] },
  rating:           { label: "Rating",           type: "enum",    col: leads.rating,
                      options: ["hot","warm","cold"] },
  source:           { label: "Source",           type: "enum",    col: leads.source,
                      options: ["organic","referral","outbound","event","website","social","other"] },
  leadScore:        { label: "Lead Score",       type: "number",  col: leads.leadScore },
  marketingConsent: { label: "Marketing Consent",type: "boolean", col: leads.marketingConsent },
  isConverted:      { label: "Converted",        type: "boolean", col: leads.isConverted },
  createdAt:        { label: "Created Date",     type: "date",    col: leads.createdAt },
};

export const CONTACT_FIELDS: FieldRegistry = {
  firstName:        { label: "First Name",       type: "text",    col: contacts.firstName },
  lastName:         { label: "Last Name",        type: "text",    col: contacts.lastName },
  email:            { label: "Email",            type: "text",    col: contacts.email },
  phone:            { label: "Phone",            type: "text",    col: contacts.phone },
  jobTitle:         { label: "Job Title",        type: "text",    col: contacts.jobTitle },
  department:       { label: "Department",       type: "text",    col: contacts.department },
  city:             { label: "City",             type: "text",    col: contacts.city },
  state:            { label: "Region / Province",type: "text",    col: contacts.state },
  country:          { label: "Country",          type: "text",    col: contacts.country },
  status:           { label: "Status",           type: "enum",    col: contacts.status,
                      options: ["active","inactive","prospect","customer"] },
  source:           { label: "Source",           type: "enum",    col: contacts.source,
                      options: ["organic","referral","outbound","event","website","social","other"] },
  leadScore:        { label: "Lead Score",       type: "number",  col: contacts.leadScore },
  marketingConsent: { label: "Marketing Consent",type: "boolean", col: contacts.marketingConsent },
  createdAt:        { label: "Created Date",     type: "date",    col: contacts.createdAt },
};

export const COMPANY_FIELDS: FieldRegistry = {
  name:               { label: "Company Name",     type: "text",   col: companies.name },
  industry:           { label: "Industry",         type: "text",   col: companies.industry },
  city:               { label: "City",             type: "text",   col: companies.city },
  state:              { label: "Region / Province",type: "text",   col: companies.state },
  country:            { label: "Country",          type: "text",   col: companies.country },
  mainEmail:          { label: "Main Email",       type: "text",   col: companies.mainEmail },
  mainPhone:          { label: "Main Phone",       type: "text",   col: companies.mainPhone },
  website:            { label: "Website",          type: "text",   col: companies.website },
  vatNumber:          { label: "VAT Number",       type: "text",   col: companies.vatNumber },
  sdiCode:            { label: "SDI Code",         type: "text",   col: companies.sdiCode },
  type:               { label: "Type",             type: "enum",   col: companies.type,
                        options: ["prospect","customer","partner","vendor"] },
  status:             { label: "Status",           type: "enum",   col: companies.status,
                        options: ["active","inactive"] },
  source:             { label: "Source",           type: "enum",   col: companies.source,
                        options: ["website","referral","linkedin","cold_outreach","trade_show","advertisement","email_campaign","other"] },
  employeeCount:      { label: "Employees",        type: "number", col: companies.employeeCount },
  annualRevenue:      { label: "Annual Revenue",   type: "number", col: companies.annualRevenue },
  leadScore:          { label: "Lead Score",       type: "number", col: companies.leadScore },
  companyCategoryId:  { label: "Category",         type: "enum",   col: companies.companyCategoryId,
                        options: [] }, // lookupOptions injected dynamically in page.tsx
  companyTypeId:      { label: "Activity Type",    type: "enum",   col: companies.companyTypeId,
                        options: [] }, // lookupOptions injected dynamically in page.tsx
  createdAt:          { label: "Created Date",     type: "date",   col: companies.createdAt },
};

/** Extract client-safe FieldMetaMap from a FieldRegistry */
export function toFieldMetaMap(registry: FieldRegistry): FieldMetaMap {
  return Object.fromEntries(
    Object.entries(registry).map(([k, v]) => [
      k,
      {
        label: v.label,
        type: v.type,
        options: v.options,
        lookupOptions: v.lookupOptions,
        isCustom: v.isCustom,
        customFieldId: v.customFieldId,
      },
    ])
  );
}

/** Convert custom field definition rows to a FieldRegistry (server-side, mergeable with static registries) */
export function customFieldsToRegistry(
  defs: Array<{ id: string; name: string; fieldType: string; options: string | null }>
): FieldRegistry {
  const result: FieldRegistry = {};
  for (const def of defs) {
    const type = mapCustomFieldType(def.fieldType);
    let options: string[] | undefined;
    if (def.fieldType === "select" || def.fieldType === "multiselect") {
      try { options = JSON.parse(def.options ?? "[]"); } catch { options = []; }
    }
    result[`cf_${def.id}`] = { label: def.name, type, options, isCustom: true, customFieldId: def.id, col: null };
  }
  return result;
}

/** Convert custom field definition rows to a client-safe FieldMetaMap (for FilterBuilder) */
export function customFieldsToMetaMap(
  defs: Array<{ id: string; name: string; fieldType: string; options: string | null }>
): FieldMetaMap {
  return toFieldMetaMap(customFieldsToRegistry(defs));
}

function mapCustomFieldType(ft: string): FieldType {
  switch (ft) {
    case "number":   return "number";
    case "date":     return "date";
    case "boolean":  return "boolean";
    case "select":   return "enum";
    // text, url, multiselect → text (multiselect stored as semicolon-separated text)
    default:         return "text";
  }
}

// ─── SQL builder ─────────────────────────────────────────────────────────────

export function buildWhereClause(
  tree: FilterTree,
  registry: FieldRegistry,
  entityIdCol?: any
): SQL | undefined {
  const conds = tree.conditions
    .map((n) => buildNode(n, registry, entityIdCol))
    .filter((c): c is SQL => c !== undefined);
  if (conds.length === 0) return undefined;
  return tree.logic === "AND" ? and(...conds) : or(...conds);
}

function buildNode(node: FilterNode, registry: FieldRegistry, entityIdCol?: any): SQL | undefined {
  if (node.type === "group") {
    const conds = node.conditions
      .map((c) => buildNode(c, registry, entityIdCol))
      .filter((c): c is SQL => c !== undefined);
    if (conds.length === 0) return undefined;
    return node.logic === "AND" ? and(...conds) : or(...conds);
  }
  return buildCondition(node, registry, entityIdCol);
}

function buildCondition(
  cond: FilterCondition,
  registry: FieldRegistry,
  entityIdCol?: any
): SQL | undefined {
  const def = registry[cond.field];
  if (!def) return undefined;

  const { type } = def;
  const { operator: op, value: val } = cond;

  // Custom field: use EXISTS subquery against custom_field_value table
  if (def.isCustom && def.customFieldId) {
    if (!entityIdCol) return undefined;
    try {
      return buildCustomFieldSQL(entityIdCol, def.customFieldId, type, op, val);
    } catch {
      return undefined;
    }
  }

  const { col } = def;
  try {
    switch (type) {
      case "text":    return buildText(col, op, val as string);
      case "number":  return buildNumber(col, op, val as number | [number, number]);
      case "date":    return buildDate(col, op, val as string | [string, string] | number);
      case "enum":    return buildEnum(col, op, val as string[]);
      case "boolean": return buildBool(col, op);
    }
  } catch {
    return undefined;
  }
}

// ─── Custom field SQL (EXISTS correlated subquery) ────────────────────────────

function buildCustomFieldSQL(
  entityIdCol: any,
  fieldId: string,
  fieldType: FieldType,
  op: FilterOperator,
  val: FilterValue
): SQL | undefined {
  // No-value operators
  if (op === "is_empty") {
    return sql`NOT EXISTS (
      SELECT 1 FROM "custom_field_value"
      WHERE "custom_field_value"."field_id" = ${fieldId}
        AND "custom_field_value"."entity_id" = ${entityIdCol}
        AND "custom_field_value"."value" IS NOT NULL
        AND "custom_field_value"."value" != ''
    )`;
  }
  if (op === "is_not_empty") {
    return sql`EXISTS (
      SELECT 1 FROM "custom_field_value"
      WHERE "custom_field_value"."field_id" = ${fieldId}
        AND "custom_field_value"."entity_id" = ${entityIdCol}
        AND "custom_field_value"."value" IS NOT NULL
        AND "custom_field_value"."value" != ''
    )`;
  }
  if (op === "is_true") {
    return sql`EXISTS (
      SELECT 1 FROM "custom_field_value"
      WHERE "custom_field_value"."field_id" = ${fieldId}
        AND "custom_field_value"."entity_id" = ${entityIdCol}
        AND "custom_field_value"."value" = 'true'
    )`;
  }
  if (op === "is_false") {
    return sql`NOT EXISTS (
      SELECT 1 FROM "custom_field_value"
      WHERE "custom_field_value"."field_id" = ${fieldId}
        AND "custom_field_value"."entity_id" = ${entityIdCol}
        AND "custom_field_value"."value" = 'true'
    )`;
  }
  if (op === "this_week" || op === "this_month" || op === "this_year") {
    const dateCond = buildCustomDateCond(op);
    if (!dateCond) return undefined;
    return sql`EXISTS (
      SELECT 1 FROM "custom_field_value"
      WHERE "custom_field_value"."field_id" = ${fieldId}
        AND "custom_field_value"."entity_id" = ${entityIdCol}
        AND (${dateCond})
    )`;
  }

  // Value-required operators — build inner condition then wrap in EXISTS
  let innerCond: SQL | undefined;

  if (fieldType === "text" || fieldType === "enum") {
    const v = val as string | string[];
    switch (op) {
      case "contains":     innerCond = sql`"custom_field_value"."value" ILIKE ${`%${v}%`}`; break;
      case "not_contains": innerCond = sql`"custom_field_value"."value" NOT ILIKE ${`%${v}%`}`; break;
      case "eq":           innerCond = sql`"custom_field_value"."value" = ${v as string}`; break;
      case "neq":          innerCond = sql`"custom_field_value"."value" != ${v as string}`; break;
      case "starts_with":  innerCond = sql`"custom_field_value"."value" ILIKE ${`${v}%`}`; break;
      case "ends_with":    innerCond = sql`"custom_field_value"."value" ILIKE ${`%${v}`}`; break;
      case "in": {
        const arr = v as string[];
        if (!arr.length) return undefined;
        const orParts = arr.map((a) => sql`"custom_field_value"."value" = ${a}`);
        innerCond = orParts.reduce((acc, p) => sql`${acc} OR ${p}`);
        break;
      }
      case "not_in": {
        const arr = v as string[];
        if (!arr.length) return undefined;
        const andParts = arr.map((a) => sql`"custom_field_value"."value" != ${a}`);
        innerCond = andParts.reduce((acc, p) => sql`${acc} AND ${p}`);
        break;
      }
    }
  } else if (fieldType === "number") {
    const v = val as number | [number, number];
    if (v === undefined || v === null || (v as unknown) === "") return undefined;
    switch (op) {
      case "eq":      innerCond = sql`"custom_field_value"."value"::numeric = ${Number(v)}`; break;
      case "neq":     innerCond = sql`"custom_field_value"."value"::numeric != ${Number(v)}`; break;
      case "gt":      innerCond = sql`"custom_field_value"."value"::numeric > ${Number(v)}`; break;
      case "gte":     innerCond = sql`"custom_field_value"."value"::numeric >= ${Number(v)}`; break;
      case "lt":      innerCond = sql`"custom_field_value"."value"::numeric < ${Number(v)}`; break;
      case "lte":     innerCond = sql`"custom_field_value"."value"::numeric <= ${Number(v)}`; break;
      case "between": {
        const [a, b] = v as [number, number];
        innerCond = sql`"custom_field_value"."value"::numeric BETWEEN ${Number(a)} AND ${Number(b)}`;
        break;
      }
    }
  } else if (fieldType === "date") {
    innerCond = buildCustomDateCond(op, val as string | [string, string] | number);
  }

  if (!innerCond) return undefined;
  return sql`EXISTS (
    SELECT 1 FROM "custom_field_value"
    WHERE "custom_field_value"."field_id" = ${fieldId}
      AND "custom_field_value"."entity_id" = ${entityIdCol}
      AND (${innerCond})
  )`;
}

function buildCustomDateCond(
  op: FilterOperator,
  val?: string | [string, string] | number
): SQL | undefined {
  const now = new Date();
  switch (op) {
    case "eq": {
      if (!val) return undefined;
      const d = new Date(val as string);
      const next = new Date(d); next.setDate(next.getDate() + 1);
      return sql`"custom_field_value"."value"::date >= ${d} AND "custom_field_value"."value"::date < ${next}`;
    }
    case "before": return val ? sql`"custom_field_value"."value"::date < ${new Date(val as string)}` : undefined;
    case "after":  return val ? sql`"custom_field_value"."value"::date > ${new Date(val as string)}` : undefined;
    case "between": {
      const [a, b] = val as [string, string];
      if (!a || !b) return undefined;
      return sql`"custom_field_value"."value"::date BETWEEN ${new Date(a)} AND ${new Date(b)}`;
    }
    case "last_n_days": {
      const days = Number(val) || 7;
      const past = new Date(now); past.setDate(past.getDate() - days);
      return sql`"custom_field_value"."value"::date >= ${past}`;
    }
    case "this_week": {
      const start = new Date(now); start.setDate(now.getDate() - now.getDay()); start.setHours(0, 0, 0, 0);
      return sql`"custom_field_value"."value"::date >= ${start}`;
    }
    case "this_month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return sql`"custom_field_value"."value"::date >= ${start} AND "custom_field_value"."value"::date < ${end}`;
    }
    case "this_year": {
      const start = new Date(now.getFullYear(), 0, 1);
      const end = new Date(now.getFullYear() + 1, 0, 1);
      return sql`"custom_field_value"."value"::date >= ${start} AND "custom_field_value"."value"::date < ${end}`;
    }
  }
}

function buildText(col: any, op: FilterOperator, val: string): SQL | undefined {
  if (!val && !NO_VALUE_OPERATORS.includes(op)) return undefined;
  switch (op) {
    case "contains":     return ilike(col, `%${val}%`);
    case "not_contains": return not(ilike(col, `%${val}%`));
    case "eq":           return eq(col, val);
    case "neq":          return ne(col, val);
    case "starts_with":  return ilike(col, `${val}%`);
    case "ends_with":    return ilike(col, `%${val}`);
    case "is_empty":     return sql`(${col} IS NULL OR ${col} = '')`;
    case "is_not_empty": return sql`(${col} IS NOT NULL AND ${col} != '')`;
  }
}

function buildNumber(
  col: any,
  op: FilterOperator,
  val: number | [number, number]
): SQL | undefined {
  if (val === undefined || val === null || (val as unknown) === "") return undefined;
  switch (op) {
    case "eq":      return eq(col, Number(val));
    case "neq":     return ne(col, Number(val));
    case "gt":      return gt(col, Number(val));
    case "gte":     return gte(col, Number(val));
    case "lt":      return lt(col, Number(val));
    case "lte":     return lte(col, Number(val));
    case "between": {
      const [a, b] = val as [number, number];
      if (!a && !b) return undefined;
      return between(col, Number(a), Number(b));
    }
  }
}

function buildDate(
  col: any,
  op: FilterOperator,
  val: string | [string, string] | number
): SQL | undefined {
  const now = new Date();
  switch (op) {
    case "eq": {
      if (!val) return undefined;
      const d = new Date(val as string);
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      return sql`${col} >= ${d} AND ${col} < ${next}`;
    }
    case "before":  return val ? lt(col, new Date(val as string)) : undefined;
    case "after":   return val ? gt(col, new Date(val as string)) : undefined;
    case "between": {
      const [a, b] = val as [string, string];
      if (!a || !b) return undefined;
      return between(col, new Date(a), new Date(b));
    }
    case "last_n_days": {
      const days = Number(val) || 7;
      const past = new Date(now);
      past.setDate(past.getDate() - days);
      return gte(col, past);
    }
    case "this_week": {
      const start = new Date(now);
      start.setDate(now.getDate() - now.getDay());
      start.setHours(0, 0, 0, 0);
      return gte(col, start);
    }
    case "this_month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return sql`${col} >= ${start} AND ${col} < ${end}`;
    }
    case "this_year": {
      const start = new Date(now.getFullYear(), 0, 1);
      const end = new Date(now.getFullYear() + 1, 0, 1);
      return sql`${col} >= ${start} AND ${col} < ${end}`;
    }
  }
}

function buildEnum(col: any, op: FilterOperator, val: string[]): SQL | undefined {
  if (!val || val.length === 0) return undefined;
  switch (op) {
    case "in":     return inArray(col, val);
    case "not_in": return notInArray(col, val);
  }
}

function buildBool(col: any, op: FilterOperator): SQL | undefined {
  switch (op) {
    case "is_true":  return eq(col, true);
    case "is_false": return eq(col, false);
  }
}
