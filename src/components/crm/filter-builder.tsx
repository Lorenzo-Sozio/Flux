"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetFooter,
} from "@/components/ui/sheet";
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
  FilterTree, FilterNode, FilterCondition, FilterGroup,
  FieldMeta, FieldMetaMap, FilterOperator, FilterValue,
  emptyTree, newCondition, newGroup,
  updateNode, removeNode, countActive,
  encodeFilter, decodeFilter,
  TEXT_OPERATORS, NUMBER_OPERATORS, DATE_OPERATORS, ENUM_OPERATORS, BOOL_OPERATORS,
  operatorsForType, defaultOperatorForType, defaultValueForOperator,
  NO_VALUE_OPERATORS,
} from "@/lib/filter-types";

// ─── Depth colors ─────────────────────────────────────────────────────────────

const DEPTH_COLORS = [
  "border-primary/40 bg-primary/3",
  "border-blue-400/40 bg-blue-400/3",
  "border-purple-400/40 bg-purple-400/3",
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
    return <span className="text-xs text-muted-foreground italic px-1">—</span>;
  }

  if (fieldMeta.type === "text") {
    return (
      <Input
        value={(value as string) ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 text-xs min-w-0 flex-1"
        placeholder="value…"
      />
    );
  }

  if (fieldMeta.type === "number") {
    if (operator === "between") {
      const [a, b] = (value as [number, number]) ?? [0, 0];
      return (
        <div className="flex gap-1 items-center flex-1">
          <Input
            type="number"
            value={a ?? ""}
            onChange={(e) => onChange([Number(e.target.value), b])}
            className="h-7 text-xs"
            placeholder="from"
          />
          <span className="text-muted-foreground text-xs">–</span>
          <Input
            type="number"
            value={b ?? ""}
            onChange={(e) => onChange([a, Number(e.target.value)])}
            className="h-7 text-xs"
            placeholder="to"
          />
        </div>
      );
    }
    return (
      <Input
        type="number"
        value={(value as number) ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        className="h-7 text-xs flex-1"
        placeholder="number"
      />
    );
  }

  if (fieldMeta.type === "date") {
    if (operator === "between") {
      const [a, b] = (value as [string, string]) ?? ["", ""];
      return (
        <div className="flex gap-1 items-center flex-1">
          <Input
            type="date"
            value={a ?? ""}
            onChange={(e) => onChange([e.target.value, b])}
            className="h-7 text-xs"
          />
          <span className="text-muted-foreground text-xs">–</span>
          <Input
            type="date"
            value={b ?? ""}
            onChange={(e) => onChange([a, e.target.value])}
            className="h-7 text-xs"
          />
        </div>
      );
    }
    if (operator === "last_n_days") {
      return (
        <Input
          type="number"
          min={1}
          value={(value as number) ?? 7}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-7 text-xs w-20"
          placeholder="days"
        />
      );
    }
    return (
      <Input
        type="date"
        value={(value as string) ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 text-xs flex-1"
      />
    );
  }

  if (fieldMeta.type === "enum" && fieldMeta.options) {
    const selected = (value as string[]) ?? [];
    return (
      <div className="flex flex-wrap gap-1 flex-1">
        {fieldMeta.options.map((opt) => (
          <Badge
            key={opt}
            variant={selected.includes(opt) ? "default" : "outline"}
            className="cursor-pointer text-[10px] h-5 capitalize font-normal"
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

  return (
    <div className="flex items-start gap-1.5 group">
      {/* Field */}
      <select
        value={condition.field}
        onChange={(e) => changeField(e.target.value)}
        className="h-7 rounded-md border border-input bg-background px-2 text-xs shrink-0 max-w-[140px]"
      >
        {Object.entries(fields).map(([k, f]) => (
          <option key={k} value={k}>{f.label}</option>
        ))}
      </select>

      {/* Operator */}
      <select
        value={condition.operator}
        onChange={(e) => changeOp(e.target.value as FilterOperator)}
        className="h-7 rounded-md border border-input bg-background px-2 text-xs shrink-0 max-w-[140px]"
      >
        {operators.map((op) => (
          <option key={op.value} value={op.value}>{op.label}</option>
        ))}
      </select>

      {/* Value */}
      <div className="flex-1 min-w-0">
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
        className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive hover:bg-muted transition-all shrink-0"
      >
        <X className="h-3 w-3" />
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
    // Start the group with one empty condition
    g.conditions = [newCondition(firstField, firstType)];
    onConditionsChange([...conditions, g]);
  };

  const updateChild = (id: string, updated: FilterNode) => {
    onConditionsChange(conditions.map((c) => (c.id === id ? updated : c)));
  };

  const removeChild = (id: string) => {
    onConditionsChange(conditions.filter((c) => c.id !== id));
  };

  const colorClass = DEPTH_COLORS[depth % DEPTH_COLORS.length];

  return (
    <div className={`rounded-md border-l-2 pl-3 pr-2 py-2 space-y-2 ${colorClass}`}>
      {/* Group header: AND / OR toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            onClick={() => onLogicChange("AND")}
            className={`h-5 px-2 text-[10px] font-bold rounded transition-colors ${
              logic === "AND"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            AND
          </button>
          <button
            onClick={() => onLogicChange("OR")}
            className={`h-5 px-2 text-[10px] font-bold rounded transition-colors ${
              logic === "OR"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            OR
          </button>
        </div>
        {onRemove && (
          <button
            onClick={onRemove}
            className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-muted"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Conditions */}
      {conditions.length === 0 && (
        <p className="text-[10px] text-muted-foreground italic px-1">
          No conditions — add one below
        </p>
      )}

      <div className="space-y-2">
        {conditions.map((node, i) => (
          <div key={node.id}>
            {i > 0 && (
              <div className="flex items-center gap-2 py-0.5 px-1">
                <div className="flex-1 h-px bg-border" />
                <span className="text-[9px] font-bold text-muted-foreground">{logic}</span>
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
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={addCondition}
          className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 font-medium"
        >
          <Plus className="h-3 w-3" /> Add condition
        </button>
        {depth < 2 && (
          <button
            onClick={addGroup}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground font-medium"
          >
            <FolderPlus className="h-3 w-3" /> Add group
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Saved filter item ────────────────────────────────────────────────────────

type SavedFilter = { id: string; name: string; criteria: string };

// ─── Main sheet component ─────────────────────────────────────────────────────

interface FilterBuilderProps {
  entityType: "contacts" | "leads" | "companies";
  fields: FieldMetaMap;
  savedFilters: SavedFilter[];
  basePath: string; // e.g. "/dashboard/contacts"
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

  // Decode current tree from URL
  const encoded = searchParams.get("filter");
  const [tree, setTree] = useState<FilterTree>(() =>
    encoded ? decodeFilter(encoded) ?? emptyTree() : emptyTree()
  );

  // Sync when sheet opens (URL may have changed externally)
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
    if (countActive(tree.conditions) === 0) { toast.error("No conditions to save."); return; }
    setSaving(true);
    try {
      await createCustomFilter({
        name: saveName.trim(),
        entityType,
        criteria: tree as any,
      });
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
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="relative gap-2">
          <SlidersHorizontal className="h-4 w-4" />
          Filters
          {activeCount > 0 && (
            <Badge className="h-4 min-w-4 px-1 text-[10px] flex items-center justify-center absolute -top-1.5 -right-1.5">
              {activeCount}
            </Badge>
          )}
        </Button>
      </SheetTrigger>

      <SheetContent
        side="right"
        className="w-[440px] max-w-[95vw] flex flex-col p-0 gap-0 overflow-hidden"
      >
        <SheetHeader className="px-4 py-3 border-b shrink-0">
          <SheetTitle className="flex items-center gap-2 text-sm">
            <SlidersHorizontal className="h-4 w-4" />
            Advanced Filters
            {activeCount > 0 && (
              <Badge variant="secondary" className="text-[10px]">
                {activeCount} active
              </Badge>
            )}
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {/* Saved presets */}
          {saved.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] uppercase font-semibold tracking-wide text-muted-foreground">
                Saved Filters
              </p>
              {saved.map((f) => (
                <div key={f.id} className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-1 justify-start h-7 text-xs gap-1"
                    onClick={() => loadPreset(f.criteria)}
                  >
                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    {f.name}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDeleteSaved(f.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              <Separator />
            </div>
          )}

          {/* Root AND/OR toggle */}
          <div className="space-y-2">
            <p className="text-[10px] uppercase font-semibold tracking-wide text-muted-foreground">
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

          {/* Save current filter */}
          <div className="space-y-1.5">
            <p className="text-[10px] uppercase font-semibold tracking-wide text-muted-foreground">
              Save as Preset
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="Filter name…"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
                className="h-8 text-sm"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-3 gap-1 shrink-0"
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

        <SheetFooter className="p-3 border-t flex gap-2 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="gap-1"
          >
            <X className="h-3.5 w-3.5" />
            Clear All
          </Button>
          <Button
            size="sm"
            onClick={applyFilters}
            disabled={isPending}
            className="flex-1"
          >
            {isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Apply Filters
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
