import React, { useCallback, useMemo, useState } from "react";

import { AlertCircle, CheckCircle, ChevronDown, Info } from "lucide-react";

import {
  createConditionLabel,
  describeTree,
  tokenizeExpression,
  type ValidationError,
  validateExpression,
} from "@/components/crm/automation/condition-parser";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface Condition {
  field: string;
  operator: string;
  value?: string | number | boolean;
  logic?: "AND" | "OR";
}

interface ConditionExpressionEditorProps {
  conditions: Condition[];
  expression: string;
  onChange: (expression: string) => void;
  onValidationChange?: (isValid: boolean) => void;
}

/**
 * Genera automaticamente un'espressione logica dalle condizioni e dai loro operatori
 *
 * Strategie di raggruppamento:
 * - Groups runs of conditions joined by the SAME operator (AND or OR)
 * - Racchiudi ciascun gruppo tra parentesi
 * - Joins the groups with the first differing operator
 *
 * Esempi:
 * - C0 AND C1 AND C2 → "C0 AND C1 AND C2" (no parentesi, tutti AND)
 * - C0 AND C1 OR C2 → "C0 AND C1 OR C2" (no parentesi, chiaro dalla logica)
 * - C0 OR C1 OR C2 AND C3 → "C0 OR C1 OR (C2 AND C3)" (parentesi attorno al gruppo finale diverso)
 */
export function generateExpressionFromConditions(conditions: Condition[]): string {
  if (conditions.length === 0) return "";
  if (conditions.length === 1) return "C0";

  // Accumula espressione da sinistra a destra
  let expression = "C0";

  for (let i = 1; i < conditions.length; i++) {
    const _prevLogic = conditions[i - 1]?.logic || "AND";
    const currentLogic = conditions[i]?.logic || "AND";

    // Add the condition together with its operator
    expression += ` ${currentLogic} C${i}`;
  }

  return expression;
}

/**
 * Highlights the syntax of the logical expression.
 */
const SyntaxHighlighter: React.FC<{
  expression: string;
  errors: ValidationError[];
}> = ({ expression, errors }) => {
  const tokens = tokenizeExpression(expression);
  const _errorPositions = new Set(errors.map((e) => e.position).filter((p) => p !== undefined));

  return (
    <div className="whitespace-pre-wrap break-words font-mono text-sm">
      {tokens.map((token, idx) => {
        const isOperator = ["AND", "OR", "NOT"].includes(token);
        const isParenthesis = token === "(" || token === ")";
        const isCondition = token.match(/^C\d+$/);

        return (
          <span
            key={`${token}-${idx}`}
            className={cn(
              "transition-colors",
              isOperator && "font-semibold text-blue-600",
              isParenthesis && "font-bold text-amber-600",
              isCondition && "font-medium text-green-600",
              !isOperator && !isParenthesis && !isCondition && "text-gray-600",
            )}
          >
            {token}{" "}
          </span>
        );
      })}
    </div>
  );
};

/**
 * Mostra l'albero logico in formato leggibile
 */
const LogicTreeViewer: React.FC<{
  conditionLabels: string[];
  description: string;
}> = ({ conditionLabels, description }) => {
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm">
      <div className="font-mono text-blue-900">{description}</div>
      <div className="mt-2 text-blue-700 text-xs">
        <div className="mb-1 font-semibold">Condizioni utilizzate:</div>
        <ul className="list-inside list-disc space-y-0.5">
          {conditionLabels.map((label, idx) => (
            <li key={idx}>
              <span className="font-mono text-green-700">C{idx}</span>: {label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

/**
 * Shows validation errors with visual feedback.
 */
const ValidationFeedback: React.FC<{
  errors: ValidationError[];
}> = ({ errors }) => {
  if (errors.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-green-700 text-sm">
        <CheckCircle className="h-4 w-4 flex-shrink-0" />
        <span>Espressione valida</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {errors.map((error, idx) => (
        <div
          key={idx}
          className={cn(
            "flex items-start gap-2 rounded-lg border p-3 text-sm",
            error.severity === "error"
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-amber-200 bg-amber-50 text-amber-700",
          )}
        >
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div className="flex-1">
            <div className="font-semibold">{error.type === "syntax" ? "Errore sintattico" : "Errore logico"}</div>
            <div>{error.message}</div>
          </div>
        </div>
      ))}
    </div>
  );
};

/**
 * Editor espressioni logiche con validazione e preview
 */
export const ConditionExpressionEditor: React.FC<ConditionExpressionEditorProps> = ({
  conditions,
  expression,
  onChange,
  onValidationChange,
}) => {
  const [_showAdvanced, _setShowAdvanced] = useState(false);
  const [showTree, setShowTree] = useState(false);
  const [lastConditionHash, setLastConditionHash] = useState<string>("");

  // Crea etichette per le condizioni
  const conditionLabels = useMemo(
    () => conditions.map((c) => createConditionLabel(c.field, c.operator, c.value)),
    [conditions],
  );

  // Regenerate the expression when the conditions change
  React.useEffect(() => {
    // A simple hash of the conditions
    const hash = JSON.stringify(conditions);

    // If the conditions changed AND the expression is empty or simple (no parentheses),
    // allora rigenera automaticamente
    if (hash !== lastConditionHash && (!expression || !expression.includes("("))) {
      const generated = generateExpressionFromConditions(conditions);
      if (generated && generated !== expression) {
        onChange(generated);
      }
      setLastConditionHash(hash);
    }
  }, [conditions, expression, onChange, lastConditionHash]);

  // Valida l'espressione
  const validation = useMemo(() => validateExpression(expression, conditions.length), [expression, conditions.length]);

  // Report the validation state to the parent
  React.useEffect(() => {
    onValidationChange?.(validation.valid);
  }, [validation.valid, onValidationChange]);

  // Genera descrizione dell'albero
  const treeDescription = useMemo(() => {
    if (validation.tree) {
      return describeTree(validation.tree, conditionLabels);
    }
    return "";
  }, [validation.tree, conditionLabels]);

  // Helper per inserire automaticamente parentesi
  const insertParentheses = useCallback(() => {
    const newExpr = `(${expression})`;
    onChange(newExpr);
  }, [expression, onChange]);

  const insertAnd = useCallback(() => {
    const newExpr = expression ? `${expression} AND ` : "";
    onChange(newExpr);
  }, [expression, onChange]);

  const insertOr = useCallback(() => {
    const newExpr = expression ? `${expression} OR ` : "";
    onChange(newExpr);
  }, [expression, onChange]);

  const insertNot = useCallback(() => {
    onChange(`NOT ${expression}`);
  }, [expression, onChange]);

  const addCondition = useCallback(
    (idx: number) => {
      const newExpr = expression ? `${expression} AND C${idx}` : `C${idx}`;
      onChange(newExpr);
    },
    [expression, onChange],
  );

  return (
    <div className="space-y-4">
      {/* Info box */}
      <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm">
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-700" />
        <div className="text-blue-900">
          <div className="mb-1 font-semibold">Espressioni logiche complesse</div>
          <div className="space-y-1 text-xs">
            <div>
              • Usa <span className="font-mono">C0, C1, C2</span> per riferirsi alle condizioni
            </div>
            <div>
              • Combina con <span className="font-mono">AND, OR, NOT</span>
            </div>
            <div>
              • Raggruppa con parentesi: <span className="font-mono">(C0 AND C1) OR C2</span>
            </div>
            <div>
              • Esempio: <span className="font-mono">(C0 OR C1) AND (C2 AND NOT C3)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Editor testuale */}
      <div className="space-y-2">
        <p className="block font-semibold text-gray-700 text-sm">Espressione logica</p>
        <textarea
          value={expression}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            "w-full rounded-lg border p-3 font-mono text-sm transition-colors focus:outline-none focus:ring-2",
            validation.valid ? "border-green-300 focus:ring-green-500" : "border-red-300 focus:ring-red-500",
          )}
          placeholder="Esempio: (C0 AND C1) OR (C2 AND NOT C3)"
          rows={3}
        />

        {/* Suggerimento con mapping delle condizioni */}
        {conditions.length > 0 && expression && (
          <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs">
            <div className="mb-1 font-semibold text-amber-900">📍 Mapping:</div>
            <div className="space-y-0.5 text-amber-800">
              {conditions.map((cond, idx) => {
                const fieldLabel = cond.field;
                const operatorLabel = cond.operator;
                const valueLabel = cond.value ? ` "${cond.value}"` : "";
                return (
                  <div key={idx}>
                    <span className="font-bold font-mono text-green-700">C{idx}</span>
                    {" = "}
                    <span className="text-amber-900">
                      {fieldLabel} {operatorLabel}
                      {valueLabel}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Anteprima sintattica */}
      <div className="space-y-2">
        <p className="block font-semibold text-gray-700 text-sm">Anteprima evidenziazione</p>
        <div className="overflow-x-auto rounded-lg border border-gray-300 bg-gray-100 p-3">
          <SyntaxHighlighter expression={expression} errors={validation.errors} />
        </div>
      </div>

      {/* Pulsanti helper */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="block font-semibold text-gray-700 text-sm">Aiuti rapidi</p>
          {conditions.length > 0 && (
            <button
              type="button"
              onClick={() => onChange(generateExpressionFromConditions(conditions))}
              className="rounded border border-emerald-300 bg-emerald-100 px-3 py-1 font-medium text-emerald-900 text-xs hover:bg-emerald-200"
              title="Genera automaticamente l'espressione in base agli AND/OR definiti sopra"
            >
              ✨ Auto-genera da condizioni
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <button
            type="button"
            onClick={insertParentheses}
            disabled={!expression}
            className="rounded border border-amber-300 bg-amber-100 px-2 py-2 text-amber-900 text-xs hover:bg-amber-200 disabled:opacity-50"
          >
            Aggiungi ( )
          </button>
          <button
            type="button"
            onClick={insertAnd}
            className="rounded border border-blue-300 bg-blue-100 px-2 py-2 text-blue-900 text-xs hover:bg-blue-200"
          >
            Aggiungi AND
          </button>
          <button
            type="button"
            onClick={insertOr}
            className="rounded border border-blue-300 bg-blue-100 px-2 py-2 text-blue-900 text-xs hover:bg-blue-200"
          >
            Aggiungi OR
          </button>
          <button
            type="button"
            onClick={insertNot}
            className="rounded border border-blue-300 bg-blue-100 px-2 py-2 text-blue-900 text-xs hover:bg-blue-200"
          >
            Aggiungi NOT
          </button>
        </div>
      </div>

      {/* Quick condizioni */}
      {conditions.length > 0 && (
        <div className="space-y-2">
          <p className="block font-semibold text-gray-700 text-sm">Condizioni disponibili</p>
          <div className="flex flex-wrap gap-2">
            {conditions.map((_cond, idx) => (
              <TooltipProvider key={idx}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => addCondition(idx)}
                      className="rounded border border-green-300 bg-green-100 px-2 py-1 font-mono text-green-900 text-xs hover:bg-green-200"
                    >
                      C{idx}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{conditionLabels[idx]}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ))}
          </div>
        </div>
      )}

      {/* Sezione espandibile con validazione */}
      <Collapsible open={validation.errors.length > 0} onOpenChange={undefined}>
        <CollapsibleContent className="space-y-3">
          <ValidationFeedback errors={validation.errors} />
        </CollapsibleContent>
      </Collapsible>

      {/* Se valido, mostra anteprima albero */}
      {validation.valid && validation.tree && (
        <Collapsible open={showTree} onOpenChange={setShowTree}>
          <CollapsibleTrigger className="flex items-center gap-2 font-semibold text-gray-700 text-sm hover:text-gray-900">
            <ChevronDown className={cn("h-4 w-4 transition-transform", showTree && "rotate-180")} />
            Anteprima albero logico
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            <LogicTreeViewer conditionLabels={conditionLabels} description={treeDescription} />
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
};
