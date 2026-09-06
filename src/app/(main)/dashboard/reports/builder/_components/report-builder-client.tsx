"use client";

import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { BarChart2, ChevronDown, Download, Loader2, Play, Plus, Save, TableIcon, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";

import {
  type ChartType,
  deleteSavedReport,
  type EntityConfig,
  type FilterCondition,
  type FilterOperator,
  type ReportConfig,
  type ReportResult,
  runReport,
  type SavedReport,
  saveReport,
} from "@/actions/report-builder";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { DATE_BUCKETS } from "@/lib/report-builder-config";

// ── Constants ──────────────────────────────────────────────────────────────────

const CHART_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#f97316", "#84cc16"];

const OPERATOR_LABELS: Record<FilterOperator, string> = {
  eq: "=",
  neq: "≠",
  contains: "contains",
  not_contains: "not contains",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  is_empty: "is empty",
  is_not_empty: "is not empty",
};

const OPERATORS_BY_TYPE: Record<string, FilterOperator[]> = {
  text: ["contains", "not_contains", "eq", "neq", "is_empty", "is_not_empty"],
  number: ["eq", "neq", "gt", "gte", "lt", "lte", "is_empty", "is_not_empty"],
  date: ["gt", "gte", "lt", "lte", "is_empty", "is_not_empty"],
  boolean: ["eq", "is_empty", "is_not_empty"],
  enum: ["eq", "neq", "is_empty", "is_not_empty"],
};

const CHART_ICONS: Record<ChartType, string> = {
  table: "⊞",
  bar: "▋",
  line: "∿",
  area: "◬",
  pie: "◑",
};

function defaultConfig(entity: string): ReportConfig {
  return {
    entity,
    fields: [],
    filters: [],
    groupBy: undefined,
    aggregation: "count",
    aggregationField: undefined,
    chartType: "table",
    sortDir: "desc",
    limit: 200,
  };
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  entityConfigs: Record<string, EntityConfig>;
  savedReports: SavedReport[];
}

// ── FilterValueInput — defined outside parent to prevent re-mount on state change ──

interface FilterValueInputProps {
  filter: FilterCondition;
  index: number;
  fields: EntityConfig["fields"];
  onUpdate: (i: number, patch: Partial<FilterCondition>) => void;
}

function FilterValueInput({ filter, index, fields, onUpdate }: FilterValueInputProps) {
  if (filter.operator === "is_empty" || filter.operator === "is_not_empty") return null;
  const def = fields.find((f) => f.key === filter.field);

  if (def?.enumValues) {
    return (
      <Select value={filter.value} onValueChange={(v) => onUpdate(index, { value: v })}>
        <SelectTrigger className="h-8 text-xs flex-1">
          <SelectValue placeholder="Value" />
        </SelectTrigger>
        <SelectContent>
          {def.enumValues.map((v) => (
            <SelectItem key={v} value={v}>
              {v}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (def?.type === "boolean") {
    return (
      <Select value={filter.value} onValueChange={(v) => onUpdate(index, { value: v })}>
        <SelectTrigger className="h-8 text-xs flex-1">
          <SelectValue placeholder="Value" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">True</SelectItem>
          <SelectItem value="false">False</SelectItem>
        </SelectContent>
      </Select>
    );
  }
  if (def?.type === "date") {
    return (
      <input
        type="date"
        value={filter.value}
        onChange={(e) => onUpdate(index, { value: e.target.value })}
        className="h-8 rounded-md border border-input bg-background px-2 text-xs flex-1"
      />
    );
  }
  return (
    <Input
      value={filter.value}
      onChange={(e) => onUpdate(index, { value: e.target.value })}
      className="h-8 text-xs flex-1"
      placeholder="Value"
    />
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

export function ReportBuilderClient({ entityConfigs, savedReports: initialSaved }: Props) {
  const router = useRouter();
  const t = useTranslations("reports.builder");
  const [isPending, startTransition] = useTransition();

  const firstEntity = Object.keys(entityConfigs)[0];
  const [config, setConfig] = useState<ReportConfig>(defaultConfig(firstEntity));
  const [result, setResult] = useState<ReportResult | null>(null);
  const [saved, setSaved] = useState<SavedReport[]>(initialSaved);
  const [reportName, setReportName] = useState("");
  const [isRunning, setIsRunning] = useState(false);

  const entityConfig = entityConfigs[config.entity];
  const fields = entityConfig?.fields ?? [];
  const groupableFields = fields.filter((f) => f.groupable);
  const aggrFields = fields.filter((f) => f.aggregatable);

  // ── Handlers ────────────────────────────────────────────────────────────────

  function setEntity(entity: string) {
    setConfig(defaultConfig(entity));
    setResult(null);
  }

  function toggleField(key: string) {
    setConfig((c) => ({
      ...c,
      fields: c.fields.includes(key) ? c.fields.filter((f) => f !== key) : [...c.fields, key],
    }));
  }

  function addFilter() {
    const firstField = fields[0];
    if (!firstField) return;
    const op = (OPERATORS_BY_TYPE[firstField.type] ?? ["eq"])[0];
    setConfig((c) => ({
      ...c,
      filters: [...c.filters, { field: firstField.key, operator: op, value: "" }],
    }));
  }

  function updateFilter(i: number, patch: Partial<FilterCondition>) {
    setConfig((c) => {
      const filters = [...c.filters];
      filters[i] = { ...filters[i], ...patch };
      // Reset operator when field changes
      if (patch.field) {
        const def = fields.find((f) => f.key === patch.field);
        const ops = OPERATORS_BY_TYPE[def?.type ?? "text"];
        filters[i].operator = ops[0];
        filters[i].value = "";
      }
      return { ...c, filters };
    });
  }

  function removeFilter(i: number) {
    setConfig((c) => ({ ...c, filters: c.filters.filter((_, idx) => idx !== i) }));
  }

  async function handleRun() {
    setIsRunning(true);
    try {
      const res = await runReport(config);
      setResult(res);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("runFailed"));
    } finally {
      setIsRunning(false);
    }
  }

  function handleSave() {
    if (!reportName.trim()) {
      toast.error(t("enterName"));
      return;
    }
    startTransition(async () => {
      try {
        const r = await saveReport(reportName.trim(), config);
        setSaved((prev) => [r, ...prev]);
        setReportName("");
        toast.success(t("reportSaved"));
      } catch {
        toast.error(t("reportSaveFailed"));
      }
    });
  }

  function loadReport(r: SavedReport) {
    setConfig(r.config);
    setResult(null);
    toast.success(t("reportLoaded", { name: r.name }));
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      try {
        await deleteSavedReport(id);
        setSaved((prev) => prev.filter((r) => r.id !== id));
        toast.success(t("reportDeleted"));
      } catch {
        toast.error(t("reportDeleteFailed"));
      }
    });
  }

  function exportCsv() {
    if (!result) return;
    const header = result.columns.map((c) => `"${c.label}"`).join(",");
    const rows = result.rows.map((row) =>
      result.columns
        .map((c) => {
          const v = row[c.key];
          if (v == null) return "";
          if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return `"${new Date(v).toISOString()}"`;
          return `"${String(v).replace(/"/g, '""')}"`;
        })
        .join(","),
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `report-${config.entity}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Chart rendering ──────────────────────────────────────────────────────────

  function renderChart() {
    if (!result || config.chartType === "table" || !config.groupBy) return null;
    const data = result.rows.map((r) => ({
      name: String(r._group ?? "—"),
      count: Number(r._count ?? 0),
      ...(r._agg != null ? { agg: Number(r._agg) } : {}),
    }));

    const dataKey = result.columns.find((c) => c.key === "_agg") ? "agg" : "count";
    const dataLabel = result.columns.find((c) => c.key === "_agg")?.label ?? "Count";

    if (config.chartType === "pie") {
      return (
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Pie
              data={data}
              dataKey="count"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={100}
              label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      );
    }

    const ChartComp = config.chartType === "bar" ? BarChart : config.chartType === "line" ? LineChart : AreaChart;

    return (
      <ResponsiveContainer width="100%" height={280}>
        <ChartComp data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Legend />
          {config.chartType === "bar" && (
            <Bar dataKey={dataKey} name={dataLabel} fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
          )}
          {config.chartType === "line" && (
            <Line
              type="monotone"
              dataKey={dataKey}
              name={dataLabel}
              stroke={CHART_COLORS[0]}
              strokeWidth={2}
              dot={false}
            />
          )}
          {config.chartType === "area" && (
            <Area
              type="monotone"
              dataKey={dataKey}
              name={dataLabel}
              stroke={CHART_COLORS[0]}
              fill={`${CHART_COLORS[0]}33`}
              strokeWidth={2}
            />
          )}
        </ChartComp>
      </ResponsiveContainer>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-0 h-full">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <BarChart2 className="h-5 w-5 shrink-0 text-primary" />
          <h1 className="truncate font-bold text-xl tracking-tight">{t("title")}</h1>
          <Badge variant="secondary" className="text-xs">
            {t("adminBadge")}
          </Badge>
        </div>

        {/* Saved reports */}
        <div className="flex items-center gap-2">
          {saved.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Save className="h-3.5 w-3.5" />
                  {t("savedReports", { count: saved.length })}
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                {saved.map((r) => (
                  <DropdownMenuItem
                    key={r.id}
                    className="flex items-center justify-between gap-2 pr-1"
                    onSelect={(e) => e.preventDefault()}
                  >
                    <button type="button" className="flex-1 text-left text-sm truncate" onClick={() => loadReport(r)}>
                      {r.name}
                    </button>
                    <button
                      type="button"
                      className="shrink-0 p-1 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground"
                      onClick={() => handleDelete(r.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Body */}
      {/* ⚠️ A 288px config panel beside the canvas leaves 55px for the canvas on
          a phone. Below lg the two stack and the page scrolls: the panel above,
          the result under it, which is the order they are used in. */}
      <div className="flex flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        {/* ── Config panel ── */}
        <div className="w-full shrink-0 space-y-5 border-b p-4 lg:w-72 lg:overflow-y-auto lg:border-r lg:border-b-0">
          {/* Entity */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("dataSource")}</p>
            <Select value={config.entity} onValueChange={setEntity}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(entityConfigs).map(([key, ec]) => (
                  <SelectItem key={key} value={key}>
                    {ec.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Separator />

          {/* Fields (list mode only) */}
          {!config.groupBy && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("columns")}{" "}
                {config.fields.length > 0 && (
                  <span className="text-primary">{t("columnsSelected", { count: config.fields.length })}</span>
                )}
              </p>
              <div className="space-y-1">
                {fields.map((f) => (
                  <label key={f.key} className="flex items-center gap-2 cursor-pointer text-sm py-0.5">
                    <input
                      type="checkbox"
                      checked={config.fields.includes(f.key)}
                      onChange={() => toggleField(f.key)}
                      className="rounded"
                    />
                    <span>{f.label}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">{f.type}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <Separator />

          {/* Filters */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("filters")}</p>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={addFilter}>
                <Plus className="h-3 w-3 mr-1" /> {t("addFilter")}
              </Button>
            </div>
            {config.filters.length === 0 && <p className="text-xs text-muted-foreground">{t("noFilters")}</p>}
            {config.filters.map((f, i) => {
              const def = fields.find((d) => d.key === f.field);
              const ops = OPERATORS_BY_TYPE[def?.type ?? "text"] ?? ["eq"];
              return (
                <div key={i} className="space-y-1 rounded-md border p-2 bg-muted/20">
                  <div className="flex items-center gap-1">
                    <Select value={f.field} onValueChange={(v) => updateFilter(i, { field: v })}>
                      <SelectTrigger className="h-7 text-xs flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {fields.map((d) => (
                          <SelectItem key={d.key} value={d.key}>
                            {d.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <button
                      type="button"
                      onClick={() => removeFilter(i)}
                      className="text-muted-foreground hover:text-destructive shrink-0"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <Select value={f.operator} onValueChange={(v) => updateFilter(i, { operator: v as FilterOperator })}>
                    <SelectTrigger className="h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ops.map((op) => (
                        <SelectItem key={op} value={op}>
                          {OPERATOR_LABELS[op]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FilterValueInput filter={f} index={i} fields={fields} onUpdate={updateFilter} />
                </div>
              );
            })}
          </div>

          <Separator />

          {/* Group by */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("groupBy")}</p>
            <Select
              value={config.groupBy ?? "__none__"}
              onValueChange={(v) => setConfig((c) => ({ ...c, groupBy: v === "__none__" ? undefined : v, fields: [] }))}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="None (list mode)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t("groupByNone")}</SelectItem>
                {groupableFields.map((f) => (
                  <SelectItem key={f.key} value={f.key}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Grouping by a raw timestamp gives one group per record, so a date
                needs a bucket to be a grouping at all (audit rilievo C-09). */}
            {config.groupBy && groupableFields.find((f) => f.key === config.groupBy)?.type === "date" && (
              <Select
                value={config.groupByBucket ?? "month"}
                onValueChange={(v) => setConfig((c) => ({ ...c, groupByBucket: v as ReportConfig["groupByBucket"] }))}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DATE_BUCKETS.map((b) => (
                    <SelectItem key={b} value={b}>
                      {t(`buckets.${b}` as never)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {config.groupBy && aggrFields.length > 0 && (
              <div className="flex gap-1.5">
                <Select
                  value={config.aggregation ?? "count"}
                  onValueChange={(v) => setConfig((c) => ({ ...c, aggregation: v as ReportConfig["aggregation"] }))}
                >
                  <SelectTrigger className="h-8 text-xs w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["count", "sum", "avg", "min", "max"].map((fn) => (
                      <SelectItem key={fn} value={fn}>
                        {fn.toUpperCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {config.aggregation !== "count" && (
                  <Select
                    value={config.aggregationField ?? ""}
                    onValueChange={(v) => setConfig((c) => ({ ...c, aggregationField: v }))}
                  >
                    <SelectTrigger className="h-8 text-xs flex-1">
                      <SelectValue placeholder="Field" />
                    </SelectTrigger>
                    <SelectContent>
                      {aggrFields.map((f) => (
                        <SelectItem key={f.key} value={f.key}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
          </div>

          <Separator />

          {/* Visualization */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("visualization")}</p>
            <div className="grid grid-cols-5 gap-1">
              {(["table", "bar", "line", "area", "pie"] as ChartType[]).map((ct) => (
                <button
                  key={ct}
                  type="button"
                  onClick={() => setConfig((c) => ({ ...c, chartType: ct }))}
                  className={`flex flex-col items-center gap-0.5 p-1.5 rounded-md border text-xs transition-colors ${
                    config.chartType === ct
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-transparent hover:border-muted-foreground/30 text-muted-foreground"
                  }`}
                >
                  <span className="text-base leading-none">{CHART_ICONS[ct]}</span>
                  <span className="text-[9px] uppercase">{ct}</span>
                </button>
              ))}
            </div>
          </div>

          <Separator />

          {/* Sort + Limit (list mode) */}
          {!config.groupBy && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("sortAndLimit")}</p>
              <div className="flex gap-1.5">
                <Select
                  value={config.sortBy ?? ""}
                  onValueChange={(v) => setConfig((c) => ({ ...c, sortBy: v || undefined }))}
                >
                  <SelectTrigger className="h-8 text-xs flex-1">
                    <SelectValue placeholder={t("sortBy")} />
                  </SelectTrigger>
                  <SelectContent>
                    {(config.fields.length > 0 ? config.fields : fields.map((f) => f.key)).map((k) => {
                      const label = fields.find((f) => f.key === k)?.label ?? k;
                      return (
                        <SelectItem key={k} value={k}>
                          {label}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <Select
                  value={config.sortDir ?? "desc"}
                  onValueChange={(v) => setConfig((c) => ({ ...c, sortDir: v as "asc" | "desc" }))}
                >
                  <SelectTrigger className="h-8 text-xs w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="asc">ASC</SelectItem>
                    <SelectItem value="desc">DESC</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground shrink-0">{t("maxRows")}</span>
                <Input
                  type="number"
                  min={1}
                  max={1000}
                  value={config.limit}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, limit: Math.min(1000, Math.max(1, parseInt(e.target.value) || 200)) }))
                  }
                  className="h-8 text-xs"
                />
              </div>
            </div>
          )}

          {/* Run button */}
          <Button className="w-full gap-2" onClick={handleRun} disabled={isRunning}>
            {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {isRunning ? t("running") : t("runReport")}
          </Button>
        </div>

        {/* ── Results panel ── */}
        <div className="flex-1 overflow-auto p-6 space-y-5">
          {!result ? (
            <div className="flex flex-col items-center justify-center h-full text-center gap-3 py-16">
              <BarChart2 className="h-14 w-14 text-muted-foreground/20" />
              <p className="font-medium text-muted-foreground">{t("configureHint")}</p>
              <p className="text-sm text-muted-foreground max-w-xs">{t("configureDesc")}</p>
            </div>
          ) : (
            <>
              {/* Toolbar */}
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary">{t("rowCount", { count: result.total })}</Badge>
                {result.truncated && (
                  // "1000" used to be printed as the answer when it was the cap.
                  <Badge variant="outline" className="text-xs font-normal">
                    {t("showingFirst", { count: result.rows.length })}
                  </Badge>
                )}
                <div className="flex-1" />
                <div className="flex items-center gap-1.5">
                  <Input
                    value={reportName}
                    onChange={(e) => setReportName(e.target.value)}
                    placeholder={t("reportName")}
                    className="h-8 text-sm w-40"
                  />
                  <Button size="sm" variant="outline" onClick={handleSave} disabled={isPending || !reportName.trim()}>
                    <Save className="h-3.5 w-3.5 mr-1.5" />
                    {t("save")}
                  </Button>
                </div>
                <Button size="sm" variant="outline" onClick={exportCsv}>
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  {t("csv")}
                </Button>
              </div>

              {/* Chart */}
              {config.groupBy && config.chartType !== "table" && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-muted-foreground">
                      {entityConfigs[config.entity]?.label} by{" "}
                      {entityConfigs[config.entity]?.fields.find((f) => f.key === config.groupBy)?.label}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>{renderChart()}</CardContent>
                </Card>
              )}

              {/* Table */}
              <Card>
                <CardContent className="p-0">
                  {result.rows.length === 0 ? (
                    <div className="py-12 text-center text-sm text-muted-foreground">
                      <TableIcon className="h-8 w-8 mx-auto mb-2 text-muted-foreground/30" />
                      {t("noResults")}
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/40">
                            {result.columns.map((col) => (
                              <th
                                key={col.key}
                                className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wide whitespace-nowrap"
                              >
                                {col.label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {result.rows.map((row, ri) => (
                            <tr key={ri} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                              {result.columns.map((col) => {
                                const v = row[col.key];
                                let display: string;
                                if (v == null) display = "—";
                                else if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v))
                                  display = new Date(v).toLocaleDateString();
                                else if (typeof v === "boolean") display = v ? "Yes" : "No";
                                else display = String(v);
                                return (
                                  <td key={col.key} className="px-4 py-2 text-sm">
                                    {display}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
