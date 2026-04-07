"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  SlidersHorizontal, X, BookmarkPlus, Trash2, Loader2,
  Plus, FolderPlus, ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { createCustomFilter, deleteCustomFilter } from "@/actions/filters";
import {
  FilterTree, FilterNode, FilterCondition,
  FieldMeta, FieldMetaMap, FilterOperator, FilterValue,
  emptyTree, newCondition, newGroup,
  countActive, encodeFilter, decodeFilter,
  operatorsForType, defaultOperatorForType, defaultValueForOperator,
  NO_VALUE_OPERATORS,
} from "@/lib/filter-types";

// ─── Depth colors ─────────────────────────────────────────────────────────────

const DEPTH_COLORS = [
  "border-primary/30 bg-primary/[0.02]",
  "border-blue-400/30 bg-blue-400/[0.02]",
  "border-purple-400/30 bg-purple-400/[0.02]",
];

// ─── Value input ─────────────────────────────────────────────────────────────

function ValueInput({
  fieldMeta, operator, value, onChange,
}: {
  fieldMeta: FieldMeta;
  operator: FilterOperator;
  value: FilterValue;
  onChange: (v: FilterValue) => void;
}) {
  if (NO_VALUE_OPERATORS.includes(operator)) {
    return <span className="text-sm text-muted-foreground italic px-1 self-center">—</span>;
  }

  if (fieldMeta.type === "text") {
    return (
      <input
        type="text"
        value={(value as string) ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        placeholder="value…"
      />
    );
  }

  if (fieldMeta.type === "number") {
    if (operator === "between") {
      const [a, b] = (value as [number, number]) ?? [0, 0];
      return (
        <div className="flex gap-2 items-center">
          <input
            type="number"
            value={a ?? ""}
            onChange={(e) => onChange([Number(e.target.value), b])}
            className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            placeholder="from"
          />
          <span className="text-muted-foreground text-sm shrink-0">–</span>
          <input
            type="number"
            value={b ?? ""}
            onChange={(e) => onChange([a, Number(e.target.value)])}
            className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            placeholder="to"
          />
        </div>
      );
    }
    return (
      <input
        type="number"
        value={(value as number) ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        placeholder="number"
      />
    );
  }

  if (fieldMeta.type === "date") {
    if (operator === "between") {
      const [a, b] = (value as [string, string]) ?? ["", ""];
      return (
        <div className="flex gap-2 items-center">
          <input
            type="date"
            value={a ?? ""}
            onChange={(e) => onChange([e.target.value, b])}
            className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <span className="text-muted-foreground text-sm shrink-0">–</span>
          <input
            type="date"
            value={b ?? ""}
            onChange={(e) => onChange([a, e.target.value])}
            className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
      );
    }
    if (operator === "last_n_days") {
      return (
        <input
          type="number"
          min={1}
          value={(value as number) ?? 7}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex h-8 w-24 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          placeholder="days"
        />
      );
    }
    return (
      <input
        type="date"
        value={(value as string) ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
    );
  }

  if (fieldMeta.type === "enum" && fieldMeta.options) {
    const selected = (value as string[]) ?? [];
    return (
      <div className="flex flex-wrap gap-1.5 py-0.5">
        {fieldMeta.options.map((opt) => (
          <Badge
            key={opt}
            variant={selected.includes(opt) ? "default" : "outline"}
            className="cursor-pointer capitalize font-normal hover:bg-muted"
            onClick={() => {
              const next = selected.includes(opt)
                ? selected.filter((v) => v !== opt)
                : [...selected, opt];
              onChange(next);
            }}
          >
            {opt}
          </Badge>
        ))}
      </div>
    );
  }

  return null;
}

// ─── Condition row ────────────────────────────────────────────────────────────

function ConditionRow({
  condition,
  fields,
  onChange,
  onRemove,
}: {
  condition: FilterCondition;
  fields: FieldMetaMap;
  onChange: (c: FilterCondition) => void;
  onRemove: () => void;
}) {
  const fieldMeta = fields[condition.field];
  const operators = fieldMeta ? operatorsForType(fieldMeta.type) : [];

  const changeField = (newField: string) => {
    const meta = fields[newField];
    if (!meta) return;
    const op = defaultOperatorForType(meta.type);
    onChange({ ...condition, field: newField, operator: op, value: defaultValueForOperator(op) });
  };

  const changeOp = (op: FilterOperator) => {
    onChange({ ...condition, operator: op, value: defaultValueForOperator(op) });
  };

  const standardFields = Object.entries(fields).filter(([, f]) => !f.isCustom);
  const customFieldEntries = Object.entries(fields).filter(([, f]) => f.isCustom);

  return (
    <div className="grid gap-2 items-start" style={{ gridTemplateColumns: "1fr 1fr 1.4fr 32px" }}>
      {/* Field */}
      <select
        value={condition.field}
        onChange={(e) => changeField(e.target.value)}
        className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {standardFields.map(([k, f]) => (
          <option key={k} value={k}>{f.label}</option>
        ))}
        {customFieldEntries.length > 0 && (
          <optgroup label="── Custom Fields">
            {customFieldEntries.map(([k, f]) => (
              <option key={k} value={k}>{f.label}</option>
            ))}
          </optgroup>
        )}
      </select>

      {/* Operator */}
      <select
        value={condition.operator}
        onChange={(e) => changeOp(e.target.value as FilterOperator)}
        className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {operators.map((op) => (
          <option key={op.value} value={op.value}>{op.label}</option>
        ))}
      </select>

      {/* Value */}
      <div className="min-w-0">
        {fieldMeta ? (
          <ValueInput
            fieldMeta={fieldMeta}
            operator={condition.operator}
            value={condition.value}
            onChange={(v) => onChange({ ...condition, value: v })}
          />
        ) : null}
      </div>

      {/* Remove */}
      <button
        onClick={onRemove}
        className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
        title="Remove condition"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ─── Group node (recursive) ───────────────────────────────────────────────────

function GroupNode({
  conditions,
  logic,
  onLogicChange,
  onConditionsChange,
  onRemove,
  fields,
  depth,
}: {
  conditions: FilterNode[];
  logic: "AND" | "OR";
  onLogicChange: (l: "AND" | "OR") => void;
  onConditionsChange: (c: FilterNode[]) => void;
  onRemove?: () => void;
  fields: FieldMetaMap;
  depth: number;
}) {
  const firstField = Object.keys(fields)[0] ?? "";
  const firstType = fields[firstField]?.type ?? "text";

  const addCondition = () => {
    onConditionsChange([...conditions, newCondition(firstField, firstType)]);
  };

  const addGroup = () => {
    const g = newGroup();
    g.conditions = [newCondition(firstField, firstType)];
    onConditionsChange([...conditions, g]);
  };

  const updateChild = (id: string, updated: FilterNode) => {
    onConditionsChange(conditions.map((c) => (c.id === id ? updated : c)));
  };

  const removeChild = (id: string) => {
    onConditionsChange(conditions.filter((c) => c.id !== id));
  };

  const colorClass = DEPTH_COLORS[Math.min(depth, DEPTH_COLORS.length - 1)];

  return (
    <div className={`rounded-lg border-l-2 pl-4 pr-3 py-3 space-y-3 ${colorClass}`}>
      {/* Group header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            onClick={() => onLogicChange("AND")}
            className={`h-6 px-2.5 text-xs font-semibold rounded transition-colors ${
              logic === "AND"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            AND
          </button>
          <button
            onClick={() => onLogicChange("OR")}
            className={`h-6 px-2.5 text-xs font-semibold rounded transition-colors ${
              logic === "OR"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            OR
          </button>
          <span className="text-xs text-muted-foreground ml-1">
            {logic === "AND" ? "All conditions must match" : "Any condition must match"}
          </span>
        </div>
        {onRemove && (
          <button
            onClick={onRemove}
            className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
            title="Remove group"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Column headers (only at root level, depth 0) */}
      {depth === 0 && conditions.some((n) => n.type === "condition") && (
        <div className="grid gap-2 text-[11px] font-medium text-muted-foreground px-0.5"
          style={{ gridTemplateColumns: "1fr 1fr 1.4fr 32px" }}>
          <span>Field</span>
          <span>Operator</span>
          <span>Value</span>
          <span />
        </div>
      )}

      {/* Conditions */}
      {conditions.length === 0 && (
        <p className="text-sm text-muted-foreground italic px-1">
          No conditions yet — add one below.
        </p>
      )}

      <div className="space-y-2">
        {conditions.map((node, i) => (
          <div key={node.id}>
            {i > 0 && (
              <div className="flex items-center gap-2 py-1">
                <div className="flex-1 h-px bg-border" />
                <span className="text-[10px] font-bold text-muted-foreground bg-background border border-border rounded px-1.5 py-0.5">
                  {logic}
                </span>
                <div className="flex-1 h-px bg-border" />
              </div>
            )}

            {node.type === "condition" ? (
              <ConditionRow
                condition={node}
                fields={fields}
                onChange={(updated) => updateChild(node.id, updated)}
                onRemove={() => removeChild(node.id)}
              />
            ) : (
              <GroupNode
                conditions={node.conditions}
                logic={node.logic}
                onLogicChange={(l) => updateChild(node.id, { ...node, logic: l })}
                onConditionsChange={(c) => updateChild(node.id, { ...node, conditions: c })}
                onRemove={() => removeChild(node.id)}
                fields={fields}
                depth={depth + 1}
              />
            )}
          </div>
        ))}
      </div>

      {/* Add buttons */}
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={addCondition}
          className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-medium"
        >
          <Plus className="h-3.5 w-3.5" />
          Add condition
        </button>
        {depth < 2 && (
          <button
            onClick={addGroup}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground font-medium"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            Add group
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Saved filter item ────────────────────────────────────────────────────────

type SavedFilter = { id: string; name: string; criteria: string };

// ─── Main component ───────────────────────────────────────────────────────────

interface FilterBuilderProps {
  entityType: "contacts" | "leads" | "companies";
  fields: FieldMetaMap;
  savedFilters: SavedFilter[];
  basePath: string;
}

export function FilterBuilder({
  entityType,
  fields,
  savedFilters: initialSaved,
  basePath,
}: FilterBuilderProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState<SavedFilter[]>(initialSaved);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);

  const encoded = searchParams.get("filter");
  const [tree, setTree] = useState<FilterTree>(() =>
    encoded ? decodeFilter(encoded) ?? emptyTree() : emptyTree()
  );

  const handleOpenChange = (o: boolean) => {
    if (o) {
      const enc = searchParams.get("filter");
      setTree(enc ? decodeFilter(enc) ?? emptyTree() : emptyTree());
    }
    setOpen(o);
  };

  const activeCount = countActive(tree.conditions);

  const applyFilters = () => {
    const params = new URLSearchParams(searchParams.toString());
    if (countActive(tree.conditions) > 0) {
      params.set("filter", encodeFilter(tree));
    } else {
      params.delete("filter");
    }
    startTransition(() => {
      router.push(`${basePath}?${params.toString()}`);
      setOpen(false);
    });
  };

  const clearFilters = () => {
    setTree(emptyTree());
    startTransition(() => {
      router.push(basePath);
      setOpen(false);
    });
  };

  const loadPreset = (criteria: string) => {
    try {
      const parsed = JSON.parse(criteria) as FilterTree;
      if (parsed.version === 1) setTree(parsed);
      else toast.error("Invalid filter format.");
    } catch {
      toast.error("Could not load filter.");
    }
  };

  const handleSave = async () => {
    if (!saveName.trim()) { toast.error("Enter a name for this filter."); return; }
    if (countActive(tree.conditions) === 0) { toast.error("No active conditions to save."); return; }
    setSaving(true);
    try {
      await createCustomFilter({ name: saveName.trim(), entityType, criteria: tree as any });
      setSaved((prev) => [
        ...prev,
        { id: Math.random().toString(36), name: saveName.trim(), criteria: JSON.stringify(tree) },
      ]);
      setSaveName("");
      toast.success("Filter saved.");
    } catch {
      toast.error("Failed to save filter.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSaved = async (id: string) => {
    try {
      await deleteCustomFilter(id);
      setSaved((prev) => prev.filter((f) => f.id !== id));
      toast.success("Filter deleted.");
    } catch {
      toast.error("Failed to delete filter.");
    }
  };

  return (
    <>
      {/* Trigger button */}
      <Button
        variant="outline"
        size="sm"
        className="relative gap-2"
        onClick={() => handleOpenChange(true)}
      >
        <SlidersHorizontal className="h-4 w-4" />
        Filters
        {activeCount > 0 && (
          <Badge className="h-4 min-w-4 px-1 text-[10px] flex items-center justify-center absolute -top-1.5 -right-1.5">
            {activeCount}
          </Badge>
        )}
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="flex flex-col p-0 gap-0 overflow-hidden"
          style={{ maxWidth: "min(760px, 95vw)", width: "100%", maxHeight: "85vh" }}
        >
          {/* Header */}
          <DialogHeader className="px-5 py-4 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2.5">
              <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
              Advanced Filters
              {activeCount > 0 && (
                <Badge variant="secondary" className="text-xs font-normal">
                  {activeCount} active condition{activeCount !== 1 ? "s" : ""}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">

            {/* Saved presets */}
            {saved.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs uppercase font-semibold tracking-wider text-muted-foreground">
                  Saved Filters
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {saved.map((f) => (
                    <div key={f.id} className="flex items-center gap-1 border rounded-md overflow-hidden">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex-1 justify-start h-8 text-sm gap-1.5 rounded-none font-normal"
                        onClick={() => loadPreset(f.criteria)}
                      >
                        <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="truncate">{f.name}</span>
                      </Button>
                      <button
                        className="h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-muted transition-colors shrink-0"
                        onClick={() => handleDeleteSaved(f.id)}
                        title="Delete preset"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
                <Separator />
              </div>
            )}

            {/* Conditions */}
            <div className="space-y-2">
              <p className="text-xs uppercase font-semibold tracking-wider text-muted-foreground">
                Conditions
              </p>
              <GroupNode
                conditions={tree.conditions}
                logic={tree.logic}
                onLogicChange={(l) => setTree((t) => ({ ...t, logic: l }))}
                onConditionsChange={(c) => setTree((t) => ({ ...t, conditions: c }))}
                fields={fields}
                depth={0}
              />
            </div>

            <Separator />

            {/* Save as preset */}
            <div className="space-y-2">
              <p className="text-xs uppercase font-semibold tracking-wider text-muted-foreground">
                Save as Preset
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Filter name…"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSave()}
                  className="flex h-9 flex-1 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 px-4 gap-1.5 shrink-0"
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <BookmarkPlus className="h-3.5 w-3.5" />
                  }
                  Save
                </Button>
              </div>
            </div>
          </div>

          {/* Footer */}
          <DialogFooter className="px-5 py-3 border-t flex items-center gap-2 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="gap-1.5 mr-auto"
            >
              <X className="h-3.5 w-3.5" />
              Clear All
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={applyFilters}
              disabled={isPending}
              className="min-w-[120px]"
            >
              {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Apply Filters
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
