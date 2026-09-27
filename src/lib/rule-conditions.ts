/**
 * Whether one condition of an automation rule holds for a record — pure, so the engine,
 * the daily scheduled run and the "test on this record" panel all read the same answer.
 *
 * ⚠️ The date operators are relative to now (§8.1): "close date passed", "within the next
 * N days", "more than N days ago". A rule on dates written as absolute values would be out
 * of date the day after it was saved.
 */

export interface ConditionLike {
  field: string;
  operator: string;
  value?: unknown;
}

const DAY_MS = 86_400_000;

/** Operators that compare nothing the person types. */
export const NO_VALUE_OPERATORS = new Set(["is_empty", "is_not_empty", "changed", "date_in_past"]);

export function getNestedFieldValue(data: Record<string, unknown>, fieldPath: string): unknown {
  let value: unknown = data;
  for (const part of fieldPath.split(".")) {
    if (value == null || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function asDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function evaluateCondition(
  condition: ConditionLike,
  entityData: Record<string, unknown>,
  oldData?: Record<string, unknown>,
  now: Date = new Date(),
): boolean {
  const fieldValue = getNestedFieldValue(entityData, condition.field);
  const oldValue = oldData ? getNestedFieldValue(oldData, condition.field) : undefined;
  const conditionValue = condition.value;

  switch (condition.operator) {
    case "equals":
      return fieldValue === conditionValue;
    case "not_equals":
      return fieldValue !== conditionValue;
    case "greater_than":
      return Number(fieldValue) > Number(conditionValue);
    case "less_than":
      return Number(fieldValue) < Number(conditionValue);
    case "greater_than_or_equal":
      return Number(fieldValue) >= Number(conditionValue);
    case "less_than_or_equal":
      return Number(fieldValue) <= Number(conditionValue);
    case "contains":
      return String(fieldValue).includes(String(conditionValue));
    case "not_contains":
      return !String(fieldValue).includes(String(conditionValue));
    case "is_empty":
      return !fieldValue || fieldValue === "" || (Array.isArray(fieldValue) && fieldValue.length === 0);
    case "is_not_empty":
      return !!fieldValue && fieldValue !== "" && (!Array.isArray(fieldValue) || fieldValue.length > 0);
    case "changed":
      return oldValue !== fieldValue;
    case "changed_to":
      return fieldValue === conditionValue && oldValue !== fieldValue;
    case "changed_from":
      return oldValue === conditionValue && fieldValue !== oldValue;

    // ── Relative to now ──────────────────────────────────────────────────────
    case "date_in_past": {
      const d = asDate(fieldValue);
      return d !== null && d.getTime() < now.getTime();
    }
    case "date_within_days": {
      const d = asDate(fieldValue);
      const days = Number(conditionValue);
      if (d === null || !Number.isFinite(days)) return false;
      return d.getTime() >= now.getTime() && d.getTime() <= now.getTime() + days * DAY_MS;
    }
    case "older_than_days": {
      const d = asDate(fieldValue);
      const days = Number(conditionValue);
      if (d === null || !Number.isFinite(days)) return false;
      return d.getTime() <= now.getTime() - days * DAY_MS;
    }
    default:
      console.warn(`[RuleEngine] Unknown operator: ${condition.operator}`);
      return false;
  }
}
