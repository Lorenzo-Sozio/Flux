import type { Condition } from "../../crm/automation/types"

/**
 * Pure, side-effect-free evaluator.
 * Compares old and new entity snapshots against a set of Conditions.
 *
 * The "changed / changed_to / changed_from" operators are the key safety
 * mechanism: they prevent spurious rule fires on every save by requiring
 * that a field *actually* changed between old and new data.
 */
export class ConditionEvaluator {

  // ─── Public API ─────────────────────────────────────────────────────────────

  /** Evaluate all conditions with AND or OR logic. */
  evaluate(
    conditions: Condition[],
    logic: "AND" | "OR",
    oldData: Record<string, unknown>,
    newData: Record<string, unknown>,
  ): boolean {
    if (conditions.length === 0) return false

    return logic === "AND"
      ? conditions.every((c) => this.evaluateOne(c, oldData, newData))
      : conditions.some((c) => this.evaluateOne(c, oldData, newData))
  }

  /** Evaluate a single condition. Returns true if the condition passes. */
  evaluateOne(
    condition: Condition,
    oldData: Record<string, unknown>,
    newData: Record<string, unknown>,
  ): boolean {
    const { field, operator, value } = condition
    const newVal = this.get(newData, field)
    const oldVal = this.get(oldData, field)

    switch (operator) {
      // ── Equality ────────────────────────────────────────────────────────────
      case "equals":
        return this.eq(newVal, value)
      case "not_equals":
        return !this.eq(newVal, value)

      // ── Numeric comparisons ─────────────────────────────────────────────────
      case "greater_than":
        return this.num(newVal) > this.num(value)
      case "less_than":
        return this.num(newVal) < this.num(value)
      case "greater_than_or_equal":
        return this.num(newVal) >= this.num(value)
      case "less_than_or_equal":
        return this.num(newVal) <= this.num(value)

      // ── String ──────────────────────────────────────────────────────────────
      case "contains":
        return this.str(newVal).includes(this.str(value))
      case "not_contains":
        return !this.str(newVal).includes(this.str(value))

      // ── Presence ────────────────────────────────────────────────────────────
      case "is_empty":
        return newVal === null || newVal === undefined || newVal === ""
      case "is_not_empty":
        return newVal !== null && newVal !== undefined && newVal !== ""

      // ── Change detection (prevents spurious triggers) ────────────────────────
      case "changed":
        return !this.eq(oldVal, newVal)
      case "changed_to":
        return !this.eq(oldVal, newVal) && this.eq(newVal, value)
      case "changed_from":
        return !this.eq(oldVal, newVal) && this.eq(oldVal, value)

      default:
        return false
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Dot-notation field access: "stage.name" → data.stage.name
   */
  private get(data: Record<string, unknown>, field: string): unknown {
    return field.split(".").reduce<unknown>((obj, key) => {
      if (obj !== null && typeof obj === "object")
        return (obj as Record<string, unknown>)[key]
      return undefined
    }, data)
  }

  /**
   * Normalised equality.
   * Drizzle stores `numeric` columns as strings ("12345.00") — so we try
   * numeric comparison first before falling back to case-insensitive strings.
   */
  private eq(a: unknown, b: unknown): boolean {
    if (a === b) return true
    const numA = Number(a), numB = Number(b)
    if (!isNaN(numA) && !isNaN(numB) && String(a) !== "" && String(b) !== "")
      return numA === numB
    return this.str(a) === this.str(b)
  }

  private num(val: unknown): number {
    const n = Number(val)
    return isNaN(n) ? 0 : n
  }

  private str(val: unknown): string {
    return String(val ?? "").toLowerCase().trim()
  }
}
