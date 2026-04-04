/**
 * filter-types.ts — client-safe (no Drizzle imports)
 * Shared between server engine and client UI.
 */

// ─── Operators ────────────────────────────────────────────────────────────────

export type TextOperator =
  | "contains" | "not_contains" | "eq" | "neq"
  | "starts_with" | "ends_with" | "is_empty" | "is_not_empty";

export type NumberOperator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "between";

export type DateOperator =
  | "eq" | "before" | "after" | "between" | "last_n_days"
  | "this_week" | "this_month" | "this_year";

export type EnumOperator = "in" | "not_in";
export type BoolOperator = "is_true" | "is_false";

export type FilterOperator =
  | TextOperator | NumberOperator | DateOperator | EnumOperator | BoolOperator;

export type FilterValue =
  | string | number | boolean | null
  | string[]
  | [number, number]
  | [string, string];

// ─── Tree nodes ───────────────────────────────────────────────────────────────

export type FilterCondition = {
  id: string;
  type: "condition";
  field: string;
  operator: FilterOperator;
  value: FilterValue;
};

export type FilterGroup = {
  id: string;
  type: "group";
  logic: "AND" | "OR";
  conditions: FilterNode[];
};

export type FilterNode = FilterCondition | FilterGroup;

export type FilterTree = {
  version: 1;
  logic: "AND" | "OR";
  conditions: FilterNode[];
};

// ─── Field metadata (client-safe, no Drizzle cols) ───────────────────────────

export type FieldType = "text" | "number" | "date" | "enum" | "boolean";

export type FieldMeta = {
  label: string;
  type: FieldType;
  options?: string[];
};

export type FieldMetaMap = Record<string, FieldMeta>;

// ─── Operator labels ──────────────────────────────────────────────────────────

export const TEXT_OPERATORS: { value: TextOperator; label: string }[] = [
  { value: "contains",     label: "Contains" },
  { value: "not_contains", label: "Does not contain" },
  { value: "eq",           label: "Is exactly" },
  { value: "neq",          label: "Is not" },
  { value: "starts_with",  label: "Starts with" },
  { value: "ends_with",    label: "Ends with" },
  { value: "is_empty",     label: "Is empty" },
  { value: "is_not_empty", label: "Is not empty" },
];

export const NUMBER_OPERATORS: { value: NumberOperator; label: string }[] = [
  { value: "eq",      label: "= equals" },
  { value: "neq",     label: "≠ not equal" },
  { value: "gt",      label: "> greater than" },
  { value: "gte",     label: "≥ at least" },
  { value: "lt",      label: "< less than" },
  { value: "lte",     label: "≤ at most" },
  { value: "between", label: "Between" },
];

export const DATE_OPERATORS: { value: DateOperator; label: string }[] = [
  { value: "eq",          label: "On date" },
  { value: "before",      label: "Before" },
  { value: "after",       label: "After" },
  { value: "between",     label: "Between" },
  { value: "last_n_days", label: "Last N days" },
  { value: "this_week",   label: "This week" },
  { value: "this_month",  label: "This month" },
  { value: "this_year",   label: "This year" },
];

export const ENUM_OPERATORS: { value: EnumOperator; label: string }[] = [
  { value: "in",     label: "Is one of" },
  { value: "not_in", label: "Is not one of" },
];

export const BOOL_OPERATORS: { value: BoolOperator; label: string }[] = [
  { value: "is_true",  label: "Is true" },
  { value: "is_false", label: "Is false" },
];

export function operatorsForType(type: FieldType) {
  switch (type) {
    case "text":    return TEXT_OPERATORS;
    case "number":  return NUMBER_OPERATORS;
    case "date":    return DATE_OPERATORS;
    case "enum":    return ENUM_OPERATORS;
    case "boolean": return BOOL_OPERATORS;
  }
}

export function defaultOperatorForType(type: FieldType): FilterOperator {
  switch (type) {
    case "text":    return "contains";
    case "number":  return "gte";
    case "date":    return "after";
    case "enum":    return "in";
    case "boolean": return "is_true";
  }
}

export function defaultValueForOperator(op: FilterOperator): FilterValue {
  const noValue: FilterOperator[] = [
    "is_empty", "is_not_empty", "is_true", "is_false",
    "this_week", "this_month", "this_year",
  ];
  if (noValue.includes(op)) return null;
  if (op === "between") return ["", ""];
  if (op === "in" || op === "not_in") return [];
  return "";
}

export const NO_VALUE_OPERATORS: FilterOperator[] = [
  "is_empty", "is_not_empty", "is_true", "is_false",
  "this_week", "this_month", "this_year",
];

// ─── Tree helpers ─────────────────────────────────────────────────────────────

export function emptyTree(logic: "AND" | "OR" = "AND"): FilterTree {
  return { version: 1, logic, conditions: [] };
}

export function newCondition(field: string, type: FieldType): FilterCondition {
  const operator = defaultOperatorForType(type);
  return {
    id: genId(),
    type: "condition",
    field,
    operator,
    value: defaultValueForOperator(operator),
  };
}

export function newGroup(): FilterGroup {
  return { id: genId(), type: "group", logic: "AND", conditions: [] };
}

function genId() {
  return Math.random().toString(36).slice(2, 9);
}

/** Recursively update a node by id inside a list */
export function updateNode(
  nodes: FilterNode[],
  id: string,
  updater: (n: FilterNode) => FilterNode
): FilterNode[] {
  return nodes.map((n) => {
    if (n.id === id) return updater(n);
    if (n.type === "group") {
      return { ...n, conditions: updateNode(n.conditions, id, updater) };
    }
    return n;
  });
}

/** Recursively remove a node by id */
export function removeNode(nodes: FilterNode[], id: string): FilterNode[] {
  return nodes
    .filter((n) => n.id !== id)
    .map((n) => {
      if (n.type === "group") {
        return { ...n, conditions: removeNode(n.conditions, id) };
      }
      return n;
    });
}

/** Recursively add a node to a specific group (or root if groupId = "root") */
export function addNodeToGroup(
  nodes: FilterNode[],
  groupId: string,
  node: FilterNode
): FilterNode[] {
  return nodes.map((n) => {
    if (n.id === groupId && n.type === "group") {
      return { ...n, conditions: [...n.conditions, node] };
    }
    if (n.type === "group") {
      return { ...n, conditions: addNodeToGroup(n.conditions, groupId, node) };
    }
    return n;
  });
}

/** Count non-empty conditions in a tree */
export function countActive(nodes: FilterNode[]): number {
  let count = 0;
  for (const n of nodes) {
    if (n.type === "condition") {
      if (NO_VALUE_OPERATORS.includes(n.operator)) { count++; continue; }
      const v = n.value;
      if (v !== null && v !== undefined && v !== "" &&
          !(Array.isArray(v) && v.length === 0)) count++;
    } else {
      count += countActive(n.conditions);
    }
  }
  return count;
}

// ─── Serialization ────────────────────────────────────────────────────────────

export function encodeFilter(tree: FilterTree): string {
  const json = JSON.stringify(tree);
  // Works in both Node.js and browser
  if (typeof Buffer !== "undefined") return Buffer.from(json).toString("base64");
  return btoa(json);
}

export function decodeFilter(encoded: string): FilterTree | null {
  try {
    const json =
      typeof Buffer !== "undefined"
        ? Buffer.from(encoded, "base64").toString("utf-8")
        : atob(encoded);
    const parsed = JSON.parse(json);
    if (parsed?.version === 1 && parsed?.logic && Array.isArray(parsed?.conditions)) {
      return parsed as FilterTree;
    }
    return null;
  } catch {
    return null;
  }
}
