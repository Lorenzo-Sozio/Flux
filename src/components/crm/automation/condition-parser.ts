/**
 * Advanced Condition Logic Parser
 *
 * Supporta espressioni logiche complesse con parentesi:
 * - (A AND B) OR (C AND D)
 * - NOT A OR (B AND (C OR D))
 * - (A AND B AND C) OR (D OR E)
 */

export interface ParsedCondition {
  type: "operator" | "condition" | "group";
  operator?: "AND" | "OR" | "NOT";
  conditions?: ParsedCondition[];
  conditionId?: number; // Riferimento all'indice nella conditions array
  value?: string; // Testo originale della condizione
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  tree?: ParsedCondition;
}

export interface ValidationError {
  type: "syntax" | "logic" | "reference";
  message: string;
  position?: number;
  severity: "error" | "warning";
}

/**
 * Tokenizza un'espressione logica
 * Esempio: "(A AND B) OR C" → ['(', 'A', 'AND', 'B', ')', 'OR', 'C']
 */
export function tokenizeExpression(expr: string): string[] {
  return expr
    .split(/(\(|\)|AND|OR|NOT)\s*/g)
    .filter((token) => token && token.trim() !== "")
    .map((token) => token.trim());
}

/**
 * Checks that the parentheses balance.
 */
export function validateParentheses(expr: string): ValidationError[] {
  const errors: ValidationError[] = [];
  let depth = 0;

  for (let i = 0; i < expr.length; i++) {
    if (expr[i] === "(") {
      depth++;
    } else if (expr[i] === ")") {
      depth--;
      if (depth < 0) {
        errors.push({
          type: "syntax",
          message: "Parentesi chiusa non corrispondente",
          position: i,
          severity: "error",
        });
        depth = 0;
      }
    }
  }

  if (depth > 0) {
    errors.push({
      type: "syntax",
      message: `${depth} parentesi aperta non chiusa`,
      severity: "error",
    });
  }

  return errors;
}

/**
 * Valida i riferimenti alle condizioni
 * Example: "(C0 AND C1) OR C2" is valid with 3 conditions.
 */
export function validateConditionReferences(expr: string, conditionCount: number): ValidationError[] {
  const errors: ValidationError[] = [];
  const conditionPattern = /C(\d+)/g;

  // `matchAll` rather than a loop assigning inside its own condition: the older
  // shape needed an untyped `let` and an assignment used as a value, which the
  // linter refuses for the same reason a reader has to stop and check it.
  for (const match of expr.matchAll(conditionPattern)) {
    const index = parseInt(match[1], 10);
    if (index >= conditionCount) {
      errors.push({
        type: "reference",
        message: `Riferimento a condizione C${index} non valido (hai solo ${conditionCount} condizioni)`,
        position: match.index,
        severity: "error",
      });
    }
  }

  return errors;
}

/**
 * Parser ricorsivo per espressioni logiche
 * Precedence: NOT > AND > OR > parentheses.
 */
class ConditionParser {
  private tokens: string[];
  private pos = 0;
  private errors: ValidationError[] = [];

  constructor(tokens: string[]) {
    this.tokens = tokens.filter((t) => t !== "");
  }

  private currentToken(): string {
    return this.tokens[this.pos] || "";
  }

  private advance(): void {
    this.pos++;
  }

  private parseOr(): ParsedCondition {
    let left = this.parseAnd();

    while (this.currentToken() === "OR") {
      this.advance();
      const right = this.parseAnd();
      left = {
        type: "operator",
        operator: "OR",
        conditions: [left, right],
      };
    }

    return left;
  }

  private parseAnd(): ParsedCondition {
    let left = this.parseNot();

    while (this.currentToken() === "AND") {
      this.advance();
      const right = this.parseNot();
      left = {
        type: "operator",
        operator: "AND",
        conditions: [left, right],
      };
    }

    return left;
  }

  private parseNot(): ParsedCondition {
    if (this.currentToken() === "NOT") {
      this.advance();
      const operand = this.parsePrimary();
      return {
        type: "operator",
        operator: "NOT",
        conditions: [operand],
      };
    }

    return this.parsePrimary();
  }

  private parsePrimary(): ParsedCondition {
    if (this.currentToken() === "(") {
      this.advance();
      const expr = this.parseOr();

      if (this.currentToken() !== ")") {
        this.errors.push({
          type: "syntax",
          message: 'Parentesi non bilanciata - manca ")"',
          severity: "error",
        });
      } else {
        this.advance();
      }

      return {
        type: "group",
        value: `(...)`,
        conditions: [expr],
      };
    }

    // Try to parse a condition (C0, C1, …)
    const token = this.currentToken();
    if (token.match(/^C\d+$/)) {
      const conditionId = parseInt(token.substring(1), 10);
      this.advance();
      return {
        type: "condition",
        conditionId,
        value: token,
      };
    }

    this.errors.push({
      type: "syntax",
      message: `Token non riconosciuto: "${token}". Usa C0, C1, ... per le condizioni.`,
      severity: "error",
    });
    this.advance();

    return {
      type: "condition",
      value: token,
    };
  }

  parse(): { tree?: ParsedCondition; errors: ValidationError[] } {
    const tree = this.parseOr();

    if (this.pos < this.tokens.length) {
      this.errors.push({
        type: "syntax",
        message: `Token inatteso: "${this.currentToken()}"`,
        severity: "error",
      });
    }

    return { tree: this.errors.length === 0 ? tree : undefined, errors: this.errors };
  }
}

/**
 * Valida un'intera espressione logica
 */
export function validateExpression(expr: string, conditionCount: number): ValidationResult {
  const errors: ValidationError[] = [];

  // 1. Valida parentesi
  errors.push(...validateParentheses(expr));

  // 2. Valida riferimenti
  errors.push(...validateConditionReferences(expr, conditionCount));

  // 3. Parse, if nothing went wrong
  let tree: ParsedCondition | undefined;
  if (errors.length === 0) {
    const tokens = tokenizeExpression(expr);
    const parser = new ConditionParser(tokens);
    const result = parser.parse();
    tree = result.tree;
    errors.push(...result.errors);
  }

  return {
    valid: errors.filter((e) => e.severity === "error").length === 0,
    errors: errors.sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    tree,
  };
}

/**
 * Turns the parse tree into something a person can read.
 */
export function describeTree(tree: ParsedCondition, conditionLabels?: string[]): string {
  if (tree.type === "condition") {
    if (conditionLabels && tree.conditionId !== undefined) {
      return conditionLabels[tree.conditionId] || `Condizione ${tree.conditionId}`;
    }
    return tree.value || "";
  }

  if (tree.type === "operator") {
    if (tree.operator === "NOT" && tree.conditions) {
      return `NOT (${describeTree(tree.conditions[0], conditionLabels)})`;
    }

    if (tree.conditions && tree.conditions.length >= 2) {
      const left = describeTree(tree.conditions[0], conditionLabels);
      const right = describeTree(tree.conditions[1], conditionLabels);
      return `(${left} ${tree.operator} ${right})`;
    }
  }

  if (tree.type === "group" && tree.conditions) {
    return `(${describeTree(tree.conditions[0], conditionLabels)})`;
  }

  return "";
}

/**
 * Compiles the expression into a function that evaluates the conditions.
 */
export function compileExpression(tree: ParsedCondition): (values: boolean[]) => boolean {
  return (values: boolean[]): boolean => {
    if (tree.type === "condition") {
      const idx = tree.conditionId ?? 0;
      return values[idx] ?? false;
    }

    if (tree.type === "operator") {
      if (tree.operator === "NOT" && tree.conditions) {
        return !compileExpression(tree.conditions[0])(values);
      }

      if (tree.operator === "AND" && tree.conditions) {
        return tree.conditions.every((cond) => compileExpression(cond)(values));
      }

      if (tree.operator === "OR" && tree.conditions) {
        return tree.conditions.some((cond) => compileExpression(cond)(values));
      }
    }

    if (tree.type === "group" && tree.conditions) {
      return compileExpression(tree.conditions[0])(values);
    }

    return false;
  };
}

/**
 * Helper: Crea etichette per le condizioni (es: "Status is 'open'")
 */
export function createConditionLabel(field: string, operator: string, value?: string | number | boolean): string {
  const operatorLabels: Record<string, string> = {
    equals: "è",
    not_equals: "non è",
    greater_than: "è maggiore di",
    less_than: "è minore di",
    contains: "contiene",
    is_empty: "è vuoto",
  };

  const op = operatorLabels[operator] || operator;
  if (value !== undefined && value !== null) {
    return `${field} ${op} "${value}"`;
  }
  return `${field} ${op}`;
}
