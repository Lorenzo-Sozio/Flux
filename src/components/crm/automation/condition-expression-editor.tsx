import React, { useState, useMemo, useCallback } from 'react';
import { AlertCircle, CheckCircle, Info, ChevronDown } from 'lucide-react';
import {
  validateExpression,
  describeTree,
  compileExpression,
  createConditionLabel,
  tokenizeExpression,
  type ValidationError,
} from '@/components/crm/automation/condition-parser';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

interface Condition {
  field: string;
  operator: string;
  value?: string | number | boolean;
  logic?: 'AND' | 'OR';
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
 * - Raggruppa sequenze di condizioni con lo STESSO operatore (AND o OR)
 * - Racchiudi ciascun gruppo tra parentesi
 * - Unisci i gruppi con il primo operatore diverso
 * 
 * Esempi:
 * - C0 AND C1 AND C2 → "C0 AND C1 AND C2" (no parentesi, tutti AND)
 * - C0 AND C1 OR C2 → "C0 AND C1 OR C2" (no parentesi, chiaro dalla logica)
 * - C0 OR C1 OR C2 AND C3 → "C0 OR C1 OR (C2 AND C3)" (parentesi attorno al gruppo finale diverso)
 */
export function generateExpressionFromConditions(conditions: Condition[]): string {
  if (conditions.length === 0) return '';
  if (conditions.length === 1) return 'C0';

  // Accumula espressione da sinistra a destra
  let expression = 'C0';
  
  for (let i = 1; i < conditions.length; i++) {
    const prevLogic = conditions[i - 1]?.logic || 'AND';
    const currentLogic = conditions[i]?.logic || 'AND';
    
    // Aggiungi condizione con il suo operatore
    expression += ` ${currentLogic} C${i}`;
  }
  
  return expression;
}

/**
 * Component che evidenzia la sintassi nell'espressione logica
 */
const SyntaxHighlighter: React.FC<{
  expression: string;
  errors: ValidationError[];
}> = ({ expression, errors }) => {
  const tokens = tokenizeExpression(expression);
  const errorPositions = new Set(errors.map((e) => e.position).filter((p) => p !== undefined));

  return (
    <div className="font-mono text-sm whitespace-pre-wrap break-words">
      {tokens.map((token, idx) => {
        const isOperator = ['AND', 'OR', 'NOT'].includes(token);
        const isParenthesis = token === '(' || token === ')';
        const isCondition = token.match(/^C\d+$/);

        return (
          <span
            key={`${token}-${idx}`}
            className={cn(
              'transition-colors',
              isOperator && 'text-blue-600 font-semibold',
              isParenthesis && 'text-amber-600 font-bold',
              isCondition && 'text-green-600 font-medium',
              !isOperator && !isParenthesis && !isCondition && 'text-gray-600'
            )}
          >
            {token}{' '}
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
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
      <div className="text-blue-900 font-mono">{description}</div>
      <div className="text-xs text-blue-700 mt-2">
        <div className="font-semibold mb-1">Condizioni utilizzate:</div>
        <ul className="list-disc list-inside space-y-0.5">
          {conditionLabels.map((label, idx) => (
            <li key={idx}>
              <span className="text-green-700 font-mono">C{idx}</span>: {label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

/**
 * Mostra gli errori di validazione con feedback visivo
 */
const ValidationFeedback: React.FC<{
  errors: ValidationError[];
}> = ({ errors }) => {
  if (errors.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-3">
        <CheckCircle className="w-4 h-4 flex-shrink-0" />
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
            'flex items-start gap-2 text-sm rounded-lg p-3 border',
            error.severity === 'error'
              ? 'text-red-700 bg-red-50 border-red-200'
              : 'text-amber-700 bg-amber-50 border-amber-200'
          )}
        >
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-semibold">{error.type === 'syntax' ? 'Errore sintattico' : 'Errore logico'}</div>
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
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showTree, setShowTree] = useState(false);
  const [lastConditionHash, setLastConditionHash] = useState<string>('');

  // Crea etichette per le condizioni
  const conditionLabels = useMemo(
    () => conditions.map((c) => createConditionLabel(c.field, c.operator, c.value)),
    [conditions]
  );

  // Auto-rigenera l'espressione quando cambiano le condizioni
  React.useEffect(() => {
    // Crea un hash semplice delle condizioni
    const hash = JSON.stringify(conditions);
    
    // Se le condizioni sono cambiate AND l'espressione è vuota o semplice (no parentesi),
    // allora rigenera automaticamente
    if (hash !== lastConditionHash && (!expression || !expression.includes('('))) {
      const generated = generateExpressionFromConditions(conditions);
      if (generated && generated !== expression) {
        onChange(generated);
      }
      setLastConditionHash(hash);
    }
  }, [conditions, expression, onChange, lastConditionHash]);

  // Valida l'espressione
  const validation = useMemo(
    () => validateExpression(expression, conditions.length),
    [expression, conditions.length]
  );

  // Comunica al parent lo stato di validazione
  React.useEffect(() => {
    onValidationChange?.(validation.valid);
  }, [validation.valid, onValidationChange]);

  // Genera descrizione dell'albero
  const treeDescription = useMemo(() => {
    if (validation.tree) {
      return describeTree(validation.tree, conditionLabels);
    }
    return '';
  }, [validation.tree, conditionLabels]);

  // Helper per inserire automaticamente parentesi
  const insertParentheses = useCallback(() => {
    const newExpr = `(${expression})`;
    onChange(newExpr);
  }, [expression, onChange]);

  const insertAnd = useCallback(() => {
    const newExpr = expression ? `${expression} AND ` : '';
    onChange(newExpr);
  }, [expression, onChange]);

  const insertOr = useCallback(() => {
    const newExpr = expression ? `${expression} OR ` : '';
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
    [expression, onChange]
  );

  return (
    <div className="space-y-4">
      {/* Info box */}
      <div className="flex items-start gap-2 text-sm bg-blue-50 border border-blue-200 rounded-lg p-3">
        <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-blue-700" />
        <div className="text-blue-900">
          <div className="font-semibold mb-1">Espressioni logiche complesse</div>
          <div className="text-xs space-y-1">
            <div>• Usa <span className="font-mono">C0, C1, C2</span> per riferirsi alle condizioni</div>
            <div>• Combina con <span className="font-mono">AND, OR, NOT</span></div>
            <div>• Raggruppa con parentesi: <span className="font-mono">(C0 AND C1) OR C2</span></div>
            <div>• Esempio: <span className="font-mono">(C0 OR C1) AND (C2 AND NOT C3)</span></div>
          </div>
        </div>
      </div>

      {/* Editor testuale */}
      <div className="space-y-2">
        <label className="block text-sm font-semibold text-gray-700">
          Espressione logica
        </label>
        <textarea
          value={expression}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            'w-full font-mono text-sm p-3 border rounded-lg focus:outline-none focus:ring-2 transition-colors',
            validation.valid
              ? 'border-green-300 focus:ring-green-500'
              : 'border-red-300 focus:ring-red-500'
          )}
          placeholder="Esempio: (C0 AND C1) OR (C2 AND NOT C3)"
          rows={3}
        />
        
        {/* Suggerimento con mapping delle condizioni */}
        {conditions.length > 0 && expression && (
          <div className="text-xs bg-amber-50 border border-amber-200 rounded p-2">
            <div className="font-semibold text-amber-900 mb-1">📍 Mapping:</div>
            <div className="space-y-0.5 text-amber-800">
              {conditions.map((cond, idx) => {
                const fieldLabel = cond.field;
                const operatorLabel = cond.operator;
                const valueLabel = cond.value ? ` "${cond.value}"` : '';
                return (
                  <div key={idx}>
                    <span className="font-mono text-green-700 font-bold">C{idx}</span>
                    {' = '}
                    <span className="text-amber-900">{fieldLabel} {operatorLabel}{valueLabel}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Anteprima sintattica */}
      <div className="space-y-2">
        <label className="block text-sm font-semibold text-gray-700">
          Anteprima evidenziazione
        </label>
        <div className="bg-gray-100 border border-gray-300 rounded-lg p-3 overflow-x-auto">
          <SyntaxHighlighter expression={expression} errors={validation.errors} />
        </div>
      </div>

      {/* Pulsanti helper */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <label className="block text-sm font-semibold text-gray-700">Aiuti rapidi</label>
          {conditions.length > 0 && (
            <button
              onClick={() => onChange(generateExpressionFromConditions(conditions))}
              className="text-xs px-3 py-1 bg-emerald-100 text-emerald-900 rounded border border-emerald-300 hover:bg-emerald-200 font-medium"
              title="Genera automaticamente l'espressione in base agli AND/OR definiti sopra"
            >
              ✨ Auto-genera da condizioni
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <button
            onClick={insertParentheses}
            disabled={!expression}
            className="text-xs px-2 py-2 bg-amber-100 text-amber-900 rounded border border-amber-300 hover:bg-amber-200 disabled:opacity-50"
          >
            Aggiungi ( )
          </button>
          <button
            onClick={insertAnd}
            className="text-xs px-2 py-2 bg-blue-100 text-blue-900 rounded border border-blue-300 hover:bg-blue-200"
          >
            Aggiungi AND
          </button>
          <button
            onClick={insertOr}
            className="text-xs px-2 py-2 bg-blue-100 text-blue-900 rounded border border-blue-300 hover:bg-blue-200"
          >
            Aggiungi OR
          </button>
          <button
            onClick={insertNot}
            className="text-xs px-2 py-2 bg-blue-100 text-blue-900 rounded border border-blue-300 hover:bg-blue-200"
          >
            Aggiungi NOT
          </button>
        </div>
      </div>

      {/* Quick condizioni */}
      {conditions.length > 0 && (
        <div className="space-y-2">
          <label className="block text-sm font-semibold text-gray-700">
            Condizioni disponibili
          </label>
          <div className="flex flex-wrap gap-2">
            {conditions.map((cond, idx) => (
              <TooltipProvider key={idx}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => addCondition(idx)}
                      className="text-xs px-2 py-1 bg-green-100 text-green-900 rounded border border-green-300 hover:bg-green-200 font-mono"
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
      <Collapsible open={validation.errors.length > 0} onOpenChange={() => {}}>
        <CollapsibleContent className="space-y-3">
          <ValidationFeedback errors={validation.errors} />
        </CollapsibleContent>
      </Collapsible>

      {/* Se valido, mostra anteprima albero */}
      {validation.valid && validation.tree && (
        <Collapsible open={showTree} onOpenChange={setShowTree}>
          <CollapsibleTrigger className="text-sm font-semibold text-gray-700 flex items-center gap-2 hover:text-gray-900">
            <ChevronDown
              className={cn('w-4 h-4 transition-transform', showTree && 'rotate-180')}
            />
            Anteprima albero logico
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            <LogicTreeViewer
              conditionLabels={conditionLabels}
              description={treeDescription}
            />
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
};
