"use client";

import { useState } from "react";

import { AlertTriangleIcon, ArrowLeftIcon, CheckCircle2Icon, FileSpreadsheetIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import Papa from "papaparse";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AT_LEAST_ONE,
  type CsvEntity,
  DEDUP_FIELD,
  importFields,
  REQUIRED_FIELDS,
  suggestMapping,
} from "@/lib/csv-import-fields";

const MAX_ROWS = 5_000;
const IGNORE = "_ignore";
type OnDuplicate = "skip" | "update" | "create";

interface Parsed {
  file: File;
  headers: string[];
  samples: Record<string, string>;
  rows: number;
  delimiter: string;
}

interface Preview {
  created: number;
  updated: number;
  skipped: number;
  duplicates: string[];
  errors: { line: number; errors: { field: string; message: string }[] }[];
  errorCount: number;
  total: number;
  limitError?: string;
}

/**
 * Importing a spreadsheet in four steps: choose the file, say which column is which, see
 * what would happen, import.
 *
 * ⚠️ The preview is the server's own plan, run without writing (`dryRun`), not a guess made
 * here: the duplicates it counts are the ones the import will find, and a file that would
 * overflow the plan says so before anything is written.
 */
export function ImportWizard({
  entity,
  open,
  onOpenChange,
  onImported,
}: {
  entity: CsvEntity;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: (result: { created: number; updated: number; skipped: number; duplicates: string[] }) => void;
}) {
  const t = useTranslations("importWizard");
  const tf = useTranslations("importWizard.fields");
  const tt = useTranslations("importExport");
  const [step, setStep] = useState<"file" | "map" | "preview">("file");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [onDuplicate, setOnDuplicate] = useState<OnDuplicate>("skip");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setStep("file");
    setParsed(null);
    setMapping({});
    setOnDuplicate("skip");
    setPreview(null);
  };

  const fieldLabel = (f: string) => (tf.has(f) ? tf(f) : f);
  const fields = importFields(entity);
  const mapped = new Set(Object.values(mapping).filter(Boolean));
  const missing = REQUIRED_FIELDS[entity].filter((f) => !mapped.has(f));
  const oneOf = AT_LEAST_ONE[entity] ?? [];
  const missingOne = oneOf.length > 0 && !oneOf.some((f) => mapped.has(f));
  const blocked = missing.length > 0 || missingOne;

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) {
      toast.error(tt("csvOnly"));
      return;
    }
    // The whole file in the browser, delimiter detected — the `;` Italian Excel writes as
    // well as `,` — to show its columns. The server parses it again; nothing here is trusted.
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      complete: (result) => {
        const headers = (result.meta.fields ?? []).filter((h) => h.trim() !== "");
        if (headers.length === 0) {
          toast.error(t("noColumns"));
          return;
        }
        if (result.data.length > MAX_ROWS) {
          toast.error(t("tooManyRows", { max: MAX_ROWS }));
          return;
        }
        const samples: Record<string, string> = {};
        for (const h of headers) {
          samples[h] = result.data.map((r) => (r[h] ?? "").trim()).find(Boolean) ?? "";
        }
        setParsed({ file, headers, samples, rows: result.data.length, delimiter: result.meta.delimiter });
        setMapping(suggestMapping(entity, headers));
        setStep("map");
      },
      error: () => toast.error(tt("importFailed")),
    });
  };

  const send = async (dryRun: boolean) => {
    if (!parsed) return null;
    const form = new FormData();
    form.append("file", parsed.file);
    form.append("mapping", JSON.stringify(mapping));
    form.append("onDuplicate", onDuplicate);
    if (dryRun) form.append("dryRun", "1");
    const res = await fetch(`/api/${entity}/import`, { method: "POST", body: form });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error ?? tt("importFailed"));
      return null;
    }
    return body as Preview;
  };

  const runPreview = async () => {
    setBusy(true);
    try {
      const result = await send(true);
      if (result) {
        setPreview(result);
        setStep("preview");
      }
    } catch {
      toast.error(tt("importFailedRetry"));
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    setBusy(true);
    try {
      const result = await send(false);
      if (!result) return;
      toast.success(t("done", { created: result.created, updated: result.updated, skipped: result.skipped }));
      onImported?.(result);
      onOpenChange(false);
      reset();
    } catch {
      toast.error(tt("importFailedRetry"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tt(`titles.${entity}`)}</DialogTitle>
          <DialogDescription>{t(`steps.${step}`)}</DialogDescription>
        </DialogHeader>

        {step === "file" && (
          <div className="space-y-3">
            <Label
              htmlFor="import-file"
              className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center"
            >
              <FileSpreadsheetIcon className="size-8 text-muted-foreground" aria-hidden />
              <span className="font-medium text-sm">{t("chooseFile")}</span>
              <span className="text-muted-foreground text-xs">{t("fileHint", { max: MAX_ROWS })}</span>
            </Label>
            <Input
              id="import-file"
              type="file"
              accept=".csv,text/csv"
              className="cursor-pointer"
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
          </div>
        )}

        {step === "map" && parsed && (
          <div className="space-y-4">
            <p className="text-muted-foreground text-xs">
              {t("fileSummary", {
                name: parsed.file.name,
                rows: parsed.rows,
                delimiter: parsed.delimiter === "\t" ? "tab" : parsed.delimiter,
              })}
            </p>

            <ul className="max-h-[45dvh] space-y-2 overflow-y-auto pr-1">
              {parsed.headers.map((h) => (
                <li key={h} className="grid grid-cols-1 items-center gap-2 rounded-md border p-2 sm:grid-cols-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-sm">{h}</p>
                    <p className="truncate text-muted-foreground text-xs">{parsed.samples[h] || t("emptyColumn")}</p>
                  </div>
                  <Select
                    value={mapping[h] || IGNORE}
                    onValueChange={(v) => setMapping((m) => ({ ...m, [h]: v === IGNORE ? "" : v }))}
                  >
                    <SelectTrigger className="w-full" aria-label={t("mapTo", { column: h })}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={IGNORE}>{t("ignore")}</SelectItem>
                      {fields.map((f) => (
                        // One column per field: a field already taken by another column is
                        // offered only to that column.
                        <SelectItem key={f} value={f} disabled={mapped.has(f) && mapping[h] !== f}>
                          {fieldLabel(f)}
                          {REQUIRED_FIELDS[entity].includes(f) ? " *" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </li>
              ))}
            </ul>

            {missing.length > 0 && (
              <p className="flex items-start gap-2 text-destructive text-sm">
                <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                {t("missingRequired", { fields: missing.map(fieldLabel).join(", ") })}
              </p>
            )}
            {missingOne && (
              <p className="flex items-start gap-2 text-destructive text-sm">
                <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                {t("missingOneOf", { fields: oneOf.map(fieldLabel).join(", ") })}
              </p>
            )}

            <fieldset className="space-y-2">
              <legend className="mb-1 font-medium text-sm">
                {t("duplicatesLabel", { field: fieldLabel(DEDUP_FIELD[entity]) })}
              </legend>
              <RadioGroup value={onDuplicate} onValueChange={(v) => setOnDuplicate(v as OnDuplicate)}>
                {(["skip", "update", "create"] as const).map((mode) => (
                  <Label key={mode} className="flex items-start gap-2 font-normal">
                    <RadioGroupItem value={mode} className="mt-0.5" />
                    <span>
                      <span className="font-medium">{t(`duplicates.${mode}`)}</span>
                      <span className="block text-muted-foreground text-xs">{t(`duplicates.${mode}Help`)}</span>
                    </span>
                  </Label>
                ))}
              </RadioGroup>
            </fieldset>
          </div>
        )}

        {step === "preview" && preview && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(
                [
                  ["created", preview.created],
                  ["updated", preview.updated],
                  ["skipped", preview.skipped - preview.errorCount],
                  ["invalid", preview.errorCount],
                ] as const
              ).map(([k, n]) => (
                <div key={k} className="rounded-md border p-2 text-center">
                  <p className="font-semibold text-lg tabular-nums">{n}</p>
                  <p className="text-muted-foreground text-xs">{t(`counts.${k}`)}</p>
                </div>
              ))}
            </div>
            {preview.limitError && (
              <p className="flex items-start gap-2 text-destructive text-sm">
                <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                {preview.limitError}
              </p>
            )}
            {preview.errors.length > 0 && (
              <div className="space-y-1">
                <p className="font-medium text-sm">{t("errorsTitle")}</p>
                <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs">
                  {preview.errors.map((e) => (
                    <li key={e.line} className="break-words">
                      {t("errorLine", {
                        line: e.line,
                        detail: e.errors.map((x) => `${fieldLabel(x.field)}: ${x.message}`).join("; "),
                      })}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {preview.created + preview.updated === 0 && !preview.limitError && (
              <p className="text-muted-foreground text-sm">{t("nothingToDo")}</p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {step !== "file" && (
            <Button variant="ghost" onClick={() => setStep(step === "preview" ? "map" : "file")} disabled={busy}>
              <ArrowLeftIcon className="mr-1 size-4" aria-hidden />
              {t("back")}
            </Button>
          )}
          {step === "map" && (
            <Button onClick={runPreview} disabled={busy || blocked}>
              {busy ? t("checking") : t("preview")}
            </Button>
          )}
          {step === "preview" && preview && (
            <Button
              onClick={runImport}
              disabled={busy || Boolean(preview.limitError) || preview.created + preview.updated === 0}
            >
              <CheckCircle2Icon className="mr-1 size-4" aria-hidden />
              {busy ? tt("importing") : t("confirm", { count: preview.created + preview.updated })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
