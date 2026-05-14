"use client";

import type React from "react";
import { useEffect, useRef, useState, useTransition } from "react";

import { useRouter, useSearchParams } from "next/navigation";

import {
  BookmarkPlus,
  Check,
  ChevronRight,
  ChevronsUpDown,
  FolderPlus,
  Loader2,
  Plus,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { useMessages, useTranslations } from "next-intl";
import { toast } from "sonner";

import { createCustomFilter, deleteCustomFilter } from "@/actions/filters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Separator } from "@/components/ui/separator";
import {
  countActive,
  decodeFilter,
  defaultOperatorForType,
  defaultValueForOperator,
  emptyTree,
  encodeFilter,
  type FieldMeta,
  type FieldMetaMap,
  type FieldType,
  type FilterCondition,
  type FilterNode,
  type FilterOperator,
  type FilterTree,
  type FilterValue,
  NO_VALUE_OPERATORS,
  newCondition,
  newGroup,
  operatorsForType,
} from "@/lib/filter-types";
import { cn } from "@/lib/utils";

// ─── Depth colors ─────────────────────────────────────────────────────────────

const DEPTH_COLORS = [
  "border-primary/30 bg-primary/[0.02]",
  "border-blue-400/30 bg-blue-400/[0.02]",
  "border-purple-400/30 bg-purple-400/[0.02]",
];

// ─── Wheel hook (document capture — fires before react-remove-scroll) ─────────

function useScrollWheelCapture(ref: React.RefObject<HTMLDivElement | null>, open: boolean) {
  useEffect(() => {
    if (!open) return;
    const el = ref.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!el.contains(e.target as Node)) return;
      e.preventDefault();
      const px = e.deltaMode === 0 ? e.deltaY : e.deltaMode === 1 ? e.deltaY * 20 : e.deltaY * el.clientHeight;
      el.scrollTop += px;
    };
    document.addEventListener("wheel", handler, { passive: false, capture: true });
    return () => document.removeEventListener("wheel", handler, { capture: true });
  }, [open, ref]);
}

// ─── Translation helpers ───────────────────────────────────────────────────────

function useFilterTranslations() {
  const t = useTranslations("filterBuilder");
  const messages = useMessages();
  const fb = (messages as Record<string, unknown>).filterBuilder as Record<string, unknown> | undefined;

  const getFieldLabel = (key: string, meta: FieldMeta): string => {
    if (meta.isCustom) return meta.label;
    const fields = fb?.fields as Record<string, string> | undefined;
    return fields?.[key] ?? meta.label;
  };

  const getOpLabel = (type: FieldType, op: string, fallback: string): string => {
    const ops = fb?.operators as Record<string, Record<string, string>> | undefined;
    return ops?.[type]?.[op] ?? fallback;
  };

  return { t, getFieldLabel, getOpLabel };
}

// ─── Lookup multi-select (FK fields with many options) ───────────────────────

function LookupMultiSelect({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const { t } = useFilterTranslations();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  useScrollWheelCapture(scrollRef, open);

  const filtered = search.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(search.trim().toLowerCase()))
    : options;

  const toggle = (val: string) => {
    onChange(value.includes(val) ? value.filter((v) => v !== val) : [...value, val]);
  };

  const selectedLabels = value.map((v) => options.find((o) => o.value === v)?.label ?? v).join(", ");

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-8 w-full justify-between font-normal text-sm"
        >
          <span className="truncate text-left">
            {value.length > 0 ? (
              selectedLabels
            ) : (
              <span className="text-muted-foreground">{t("selectPlaceholder")}</span>
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={t("searchField")} value={search} onValueChange={setSearch} />
          <div
            ref={scrollRef}
            className="max-h-[260px] overflow-y-auto overflow-x-hidden"
            style={{ scrollbarWidth: "thin" }}
          >
            <CommandList className="max-h-none overflow-visible">
              {filtered.length === 0 && <CommandEmpty>{t("noResults")}</CommandEmpty>}
              <CommandGroup>
                {filtered.map((opt) => (
                  <CommandItem key={opt.value} value={opt.value} onSelect={() => toggle(opt.value)}>
                    <Check
                      className={cn("mr-2 h-4 w-4 shrink-0", value.includes(opt.value) ? "opacity-100" : "opacity-0")}
                    />
                    {opt.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ─── Value input ─────────────────────────────────────────────────────────────

function ValueInput({
  fieldMeta,
  operator,
  value,
  onChange,
}: {
  fieldMeta: FieldMeta;
  operator: FilterOperator;
  value: FilterValue;
  onChange: (v: FilterValue) => void;
}) {
  const { t } = useFilterTranslations();

  if (NO_VALUE_OPERATORS.includes(operator)) {
    return <span className="self-center px-1 text-muted-foreground text-sm italic">—</span>;
  }

  if (fieldMeta.type === "text") {
    return (
      <input
        type="text"
        value={(value as string) ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        placeholder={t("valuePlaceholder")}
      />
    );
  }

  if (fieldMeta.type === "number") {
    if (operator === "between") {
      const [a, b] = (value as [number, number]) ?? [0, 0];
      return (
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={a ?? ""}
            onChange={(e) => onChange([Number(e.target.value), b])}
            className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            placeholder={t("fromPlaceholder")}
          />
          <span className="shrink-0 text-muted-foreground text-sm">–</span>
          <input
            type="number"
            value={b ?? ""}
            onChange={(e) => onChange([a, Number(e.target.value)])}
            className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            placeholder={t("toPlaceholder")}
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
        placeholder={t("valuePlaceholder")}
      />
    );
  }

  if (fieldMeta.type === "date") {
    if (operator === "between") {
      const [a, b] = (value as [string, string]) ?? ["", ""];
      return (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={a ?? ""}
            onChange={(e) => onChange([e.target.value, b])}
            className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <span className="shrink-0 text-muted-foreground text-sm">–</span>
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
          placeholder={t("daysPlaceholder")}
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

  if (fieldMeta.type === "enum" && fieldMeta.lookupOptions !== undefined) {
    return (
      <LookupMultiSelect options={fieldMeta.lookupOptions} value={(value as string[]) ?? []} onChange={onChange} />
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
            className="cursor-pointer font-normal capitalize hover:bg-muted"
            onClick={() => {
              const next = selected.includes(opt) ? selected.filter((v) => v !== opt) : [...selected, opt];
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
  const { t, getFieldLabel, getOpLabel } = useFilterTranslations();
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
    <div className="grid items-start gap-2" style={{ gridTemplateColumns: "1fr 1fr 1.4fr 32px" }}>
      {/* Field */}
      <SearchableSelect
        options={[
          ...standardFields.map(([k, f]) => ({ value: k, label: getFieldLabel(k, f) })),
          ...customFieldEntries.map(([k, f]) => ({ value: k, label: f.label, sublabel: t("custom") })),
        ]}
        value={condition.field}
        onChange={changeField}
        searchPlaceholder={t("searchField")}
        placeholder={t("selectPlaceholder")}
        emptyText={t("noResults")}
        className="h-8 text-sm"
      />

      {/* Operator */}
      <SearchableSelect
        options={operators.map((op) => ({
          value: op.value,
          label: getOpLabel(fieldMeta?.type ?? "text", op.value, op.label),
        }))}
        value={condition.operator}
        onChange={(v) => changeOp(v as FilterOperator)}
        placeholder={t("selectPlaceholder")}
        emptyText={t("noResults")}
        className="h-8 text-sm"
      />

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
        type="button"
        onClick={onRemove}
        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
        title={t("removeCondition")}
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
  const { t } = useFilterTranslations();
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
    <div className={`space-y-3 rounded-lg border-l-2 py-3 pr-3 pl-4 ${colorClass}`}>
      {/* Group header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onLogicChange("AND")}
            className={`h-6 rounded px-2.5 font-semibold text-xs transition-colors ${
              logic === "AND"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            AND
          </button>
          <button
            type="button"
            onClick={() => onLogicChange("OR")}
            className={`h-6 rounded px-2.5 font-semibold text-xs transition-colors ${
              logic === "OR" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            OR
          </button>
          <span className="ml-1 text-muted-foreground text-xs">
            {logic === "AND" ? t("allMustMatch") : t("anyMustMatch")}
          </span>
        </div>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
            title={t("removeGroup")}
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Column headers (only at root level, depth 0) */}
      {depth === 0 && conditions.some((n) => n.type === "condition") && (
        <div
          className="grid gap-2 px-0.5 font-medium text-[11px] text-muted-foreground"
          style={{ gridTemplateColumns: "1fr 1fr 1.4fr 32px" }}
        >
          <span>{t("columnField")}</span>
          <span>{t("columnOperator")}</span>
          <span>{t("columnValue")}</span>
          <span />
        </div>
      )}

      {/* Conditions */}
      {conditions.length === 0 && <p className="px-1 text-muted-foreground text-sm italic">{t("noConditions")}</p>}

      <div className="space-y-2">
        {conditions.map((node, i) => (
          <div key={node.id}>
            {i > 0 && (
              <div className="flex items-center gap-2 py-1">
                <div className="h-px flex-1 bg-border" />
                <span className="rounded border border-border bg-background px-1.5 py-0.5 font-bold text-[10px] text-muted-foreground">
                  {logic}
                </span>
                <div className="h-px flex-1 bg-border" />
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
          type="button"
          onClick={addCondition}
          className="flex items-center gap-1.5 font-medium text-primary text-xs hover:text-primary/80"
        >
          <Plus className="h-3.5 w-3.5" />
          {t("addCondition")}
        </button>
        {depth < 2 && (
          <button
            type="button"
            onClick={addGroup}
            className="flex items-center gap-1.5 font-medium text-muted-foreground text-xs hover:text-foreground"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            {t("addGroup")}
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

export function FilterBuilder({ entityType, fields, savedFilters: initialSaved, basePath }: FilterBuilderProps) {
  const { t } = useFilterTranslations();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState<SavedFilter[]>(initialSaved);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);

  const encoded = searchParams.get("filter");
  const [tree, setTree] = useState<FilterTree>(() => (encoded ? (decodeFilter(encoded) ?? emptyTree()) : emptyTree()));

  const handleOpenChange = (o: boolean) => {
    if (o) {
      const enc = searchParams.get("filter");
      setTree(enc ? (decodeFilter(enc) ?? emptyTree()) : emptyTree());
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
    if (!saveName.trim()) {
      toast.error("Enter a name for this filter.");
      return;
    }
    if (countActive(tree.conditions) === 0) {
      toast.error("No active conditions to save.");
      return;
    }
    setSaving(true);
    try {
      // biome-ignore lint/suspicious/noExplicitAny: criteria is a JSON-compatible object
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
      <Button variant="outline" size="sm" className="relative gap-2" onClick={() => handleOpenChange(true)}>
        <SlidersHorizontal className="h-4 w-4" />
        {t("triggerLabel")}
        {activeCount > 0 && (
          <Badge className="-top-1.5 -right-1.5 absolute flex h-4 min-w-4 items-center justify-center px-1 text-[10px]">
            {activeCount}
          </Badge>
        )}
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="flex flex-col gap-0 overflow-hidden p-0"
          style={{ maxWidth: "min(760px, 95vw)", width: "100%", maxHeight: "85vh" }}
        >
          {/* Header */}
          <DialogHeader className="shrink-0 border-b px-5 py-4">
            <DialogTitle className="flex items-center gap-2.5">
              <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
              {t("title")}
              {activeCount > 0 && (
                <Badge variant="secondary" className="font-normal text-xs">
                  {t("activeConditions", { count: activeCount })}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          {/* Scrollable body */}
          <div className="flex-1 space-y-5 overflow-y-auto p-5">
            {/* Saved presets */}
            {saved.length > 0 && (
              <div className="space-y-2">
                <p className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
                  {t("savedFilters")}
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {saved.map((f) => (
                    <div key={f.id} className="flex items-center gap-1 overflow-hidden rounded-md border">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 flex-1 justify-start gap-1.5 rounded-none font-normal text-sm"
                        onClick={() => loadPreset(f.criteria)}
                      >
                        <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="truncate">{f.name}</span>
                      </Button>
                      <button
                        type="button"
                        className="flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                        onClick={() => handleDeleteSaved(f.id)}
                        title={t("deletePreset")}
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
              <p className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">{t("conditions")}</p>
              <GroupNode
                conditions={tree.conditions}
                logic={tree.logic}
                onLogicChange={(l) => setTree((tr) => ({ ...tr, logic: l }))}
                onConditionsChange={(c) => setTree((tr) => ({ ...tr, conditions: c }))}
                fields={fields}
                depth={0}
              />
            </div>

            <Separator />

            {/* Save as preset */}
            <div className="space-y-2">
              <p className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
                {t("saveAsPreset")}
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder={t("filterNamePlaceholder")}
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSave()}
                  className="flex h-9 flex-1 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 shrink-0 gap-1.5 px-4"
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookmarkPlus className="h-3.5 w-3.5" />}
                  {t("save")}
                </Button>
              </div>
            </div>
          </div>

          {/* Footer */}
          <DialogFooter className="flex shrink-0 items-center gap-2 border-t px-5 py-3">
            <Button variant="ghost" size="sm" onClick={clearFilters} className="mr-auto gap-1.5">
              <X className="h-3.5 w-3.5" />
              {t("clearAll")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button size="sm" onClick={applyFilters} disabled={isPending} className="min-w-[120px]">
              {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {t("applyFilters")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
