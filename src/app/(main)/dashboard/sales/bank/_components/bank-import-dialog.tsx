"use client";

import { useMemo, useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { AlertTriangle, Loader2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import Papa from "papaparse";
import { toast } from "sonner";

import { importBankChunkAction, saveBankMappingAction } from "@/actions/bank";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useCurrency } from "@/hooks/use-currency";
import { type CamtStatement, looksLikeCamt, parseCamt } from "@/lib/bank/camt";
import { type CsvMapping, guessMapping, missingColumns, readCsv } from "@/lib/bank/csv";
import { type Movement, normalizeIban, numberRepeats } from "@/lib/bank/movement";

import type { Account } from "./bank-view";

const CHUNK = 500;

/**
 * Bank files are UTF-8 or, from many Italian banks, Windows-1252: read as UTF-8 first and
 * strictly, so an accented name in the older encoding is not turned into "�".
 */
async function readText(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

type Loaded =
  | { kind: "camt"; statement: CamtStatement }
  | { kind: "csv"; rows: string[][]; headerRow: number; mapping: CsvMapping | null };

/** The row holding a saved mapping's date column, within the first thirty. */
function headerRowFor(rows: string[][], mapping: CsvMapping): number {
  for (let i = 0; i < Math.min(rows.length, 30); i++)
    if (rows[i].some((c) => String(c ?? "").trim() === mapping.date)) return i;
  return -1;
}

/**
 * A statement read here, in the browser — CAMT.053 or the bank's CSV — and sent as movements,
 * five hundred at a time. The server checks every one again and keeps each line once.
 */
export function BankImportDialog({
  open,
  onOpenChange,
  account,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: Account;
}) {
  const t = useTranslations("bank");
  const router = useRouter();
  const format = useFormatter();
  const { formatMoney } = useCurrency();
  const [file, setFile] = useState<File | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [anyway, setAnyway] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [pending, start] = useTransition();

  function reset() {
    setFile(null);
    setLoaded(null);
    setError(null);
    setAnyway(false);
    setProgress(null);
  }

  async function choose(f: File | null) {
    reset();
    if (!f) return;
    setFile(f);
    try {
      const text = await readText(f);
      if (looksLikeCamt(text)) {
        setLoaded({ kind: "camt", statement: parseCamt(text) });
        return;
      }
      const rows = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: false }).data;
      const saved = account.csvMapping as CsvMapping | null;
      const savedRow = saved ? headerRowFor(rows, saved) : -1;
      if (
        saved &&
        savedRow >= 0 &&
        missingColumns(
          rows[savedRow].map((h) => String(h).trim()),
          saved,
        ).length === 0
      ) {
        setLoaded({ kind: "csv", rows, headerRow: savedRow, mapping: saved });
        return;
      }
      const guess = guessMapping(rows);
      setLoaded({ kind: "csv", rows, headerRow: guess.headerRow, mapping: guess.mapping });
    } catch (e) {
      setError(t("unreadable", { error: e instanceof Error ? e.message : String(e) }));
    }
  }

  const csv =
    loaded?.kind === "csv" && loaded.mapping
      ? readCsv(loaded.rows, loaded.headerRow, loaded.mapping, account.currency)
      : null;
  const movements: Movement[] = loaded?.kind === "camt" ? loaded.statement.movements : (csv?.movements ?? []);
  const summary = useMemo(() => {
    if (movements.length === 0) return null;
    const days = movements.map((m) => m.bookedOn).sort();
    return {
      from: days[0],
      to: days[days.length - 1],
      credits: movements.filter((m) => m.amount > 0).length,
      debits: movements.filter((m) => m.amount < 0).length,
    };
  }, [movements]);
  const day = (d: string) =>
    format.dateTime(new Date(`${d}T12:00:00Z`), { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

  const statementIban = loaded?.kind === "camt" ? normalizeIban(loaded.statement.accountIban) : null;
  const mismatch = Boolean(statementIban && account.iban && statementIban !== account.iban);

  function send() {
    if (movements.length === 0 || (mismatch && !anyway)) return;
    const all = numberRepeats(movements);
    start(async () => {
      let importId: string | null = null;
      const total = { created: 0, skipped: 0, rejected: 0 };
      setProgress({ done: 0, total: all.length });
      for (let i = 0; i < all.length; i += CHUNK) {
        const r: Awaited<ReturnType<typeof importBankChunkAction>> | null = await importBankChunkAction(
          account.id,
          all.slice(i, i + CHUNK),
          {
            fileName: file?.name,
            format: loaded?.kind === "camt" ? "camt" : "csv",
            importId,
          },
        ).catch(() => null);
        if (!r?.ok) {
          toast.error(r && !r.ok ? r.error : t("failed"));
          router.refresh();
          return;
        }
        importId = r.importId;
        total.created += r.created;
        total.skipped += r.skipped;
        total.rejected += r.rejected;
        setProgress({ done: Math.min(all.length, i + CHUNK), total: all.length });
      }
      if (loaded?.kind === "csv" && loaded.mapping)
        await saveBankMappingAction(account.id, loaded.mapping).catch(() => null);
      toast.success(t("imported", total));
      onOpenChange(false);
      reset();
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (pending) return;
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("importTitle")}</DialogTitle>
          <DialogDescription>{t("importHint")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="bank-file">{t("file")}</Label>
          <Input
            id="bank-file"
            type="file"
            accept=".xml,.csv,.txt,text/csv,application/xml,text/xml"
            onChange={(e) => choose(e.target.files?.[0] ?? null)}
            disabled={pending}
          />
        </div>

        {error && <p className="text-destructive text-sm">{error}</p>}

        {loaded?.kind === "csv" && (
          <MappingEditor
            rows={loaded.rows}
            headerRow={loaded.headerRow}
            mapping={loaded.mapping}
            onChange={(mapping) => setLoaded({ ...loaded, mapping })}
          />
        )}

        {summary && (
          <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-sm">
            <p>
              {t("camtSummary", {
                count: movements.length,
                from: day(summary.from),
                to: day(summary.to),
                credits: summary.credits,
                debits: summary.debits,
              })}
            </p>
            {loaded?.kind === "camt" && loaded.statement.skipped.pending > 0 && (
              <p className="text-muted-foreground">
                {t("pendingSkipped", { count: loaded.statement.skipped.pending })}
              </p>
            )}
            {csv && csv.problems.length > 0 && (
              <p className="text-amber-800 dark:text-amber-300">
                {t("csvProblems", {
                  count: csv.problems.length,
                  lines: csv.problems
                    .slice(0, 8)
                    .map((p) => p.line)
                    .join(", "),
                })}
              </p>
            )}
            <ul className="divide-y text-xs">
              {movements.slice(0, 5).map((m, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a preview of the file's first lines, in its order
                <li key={i} className="flex gap-3 py-1">
                  <span className="shrink-0 text-muted-foreground">{day(m.bookedOn)}</span>
                  <span className="min-w-0 flex-1 truncate">{m.counterpartyName ?? m.remittance ?? "—"}</span>
                  <span className="shrink-0 tabular-nums">{formatMoney(m.amount, m.currency)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {loaded && movements.length === 0 && !error && (
          <p className="text-muted-foreground text-sm">{t("noMovements")}</p>
        )}

        {mismatch && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
            <div className="space-y-2">
              <p>{t("ibanMismatch", { iban: statementIban ?? "" })}</p>
              <div className="flex items-center gap-2">
                <Checkbox id="bank-import-anyway" checked={anyway} onCheckedChange={(v) => setAnyway(v === true)} />
                <Label htmlFor="bank-import-anyway" className="font-normal">
                  {t("importAnyway")}
                </Label>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            {t("cancel")}
          </Button>
          <Button
            onClick={send}
            disabled={pending || movements.length === 0 || (mismatch && !anyway)}
            className="gap-1.5"
          >
            {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {progress && pending
              ? t("importing", { done: progress.done, total: progress.total })
              : t("startImport", { count: movements.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const FIELDS = ["date", "valueDate", "counterparty", "iban", "reference"] as const;

/** Which column is what, corrected on screen; the preview reads the file again at each change. */
function MappingEditor({
  rows,
  headerRow,
  mapping,
  onChange,
}: {
  rows: string[][];
  headerRow: number;
  mapping: CsvMapping | null;
  onChange: (m: CsvMapping) => void;
}) {
  const t = useTranslations("bank");
  const headers = (rows[headerRow] ?? []).map((h) => String(h ?? "").trim()).filter(Boolean);
  const m: CsvMapping = mapping ?? {
    date: headers[0] ?? "",
    amount: null,
    credit: null,
    debit: null,
    description: [],
    dateOrder: "dmy",
    decimal: ",",
  };
  const split = !m.amount && Boolean(m.credit || m.debit);
  const set = (patch: Partial<CsvMapping>) => onChange({ ...m, ...patch });

  const column = (
    label: string,
    value: string | null | undefined,
    update: (v: string | null) => void,
    optional = true,
  ) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <NativeSelect size="sm" className="w-full" value={value ?? ""} onChange={(e) => update(e.target.value || null)}>
        {optional && <NativeSelectOption value="">{t("none")}</NativeSelectOption>}
        {headers.map((h) => (
          <NativeSelectOption key={h} value={h}>
            {h}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );

  return (
    <fieldset className="space-y-3 rounded-md border p-3">
      <legend className="px-1 font-medium text-sm">{t("csvMapping")}</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {FIELDS.map((f) =>
          column(t(`col.${f}`), m[f] as string | null, (v) => set({ [f]: f === "date" ? (v ?? "") : v }), f !== "date"),
        )}
        <div className="space-y-1">
          <Label className="text-xs">{t("amountMode")}</Label>
          <NativeSelect
            size="sm"
            className="w-full"
            value={split ? "split" : "signed"}
            onChange={(e) =>
              e.target.value === "split"
                ? set({ amount: null, credit: m.credit ?? null, debit: m.debit ?? null })
                : set({ amount: m.amount ?? headers[0] ?? null, credit: null, debit: null })
            }
          >
            <NativeSelectOption value="signed">{t("amountSigned")}</NativeSelectOption>
            <NativeSelectOption value="split">{t("amountSplit")}</NativeSelectOption>
          </NativeSelect>
        </div>
        {split ? (
          <>
            {column(t("col.credit"), m.credit, (v) => set({ credit: v }))}
            {column(t("col.debit"), m.debit, (v) => set({ debit: v }))}
          </>
        ) : (
          column(t("col.amount"), m.amount, (v) => set({ amount: v }), false)
        )}
        {column(t("col.description"), m.description[0], (v) =>
          set({ description: [v, m.description[1]].filter((x): x is string => Boolean(x)) }),
        )}
        {column(`${t("col.description")} (2)`, m.description[1], (v) =>
          set({ description: [m.description[0], v].filter((x): x is string => Boolean(x)) }),
        )}
        <div className="space-y-1">
          <Label className="text-xs">{t("dateOrder")}</Label>
          <NativeSelect
            size="sm"
            className="w-full"
            value={m.dateOrder}
            onChange={(e) => set({ dateOrder: e.target.value as CsvMapping["dateOrder"] })}
          >
            <NativeSelectOption value="dmy">31/12/2026</NativeSelectOption>
            <NativeSelectOption value="ymd">2026-12-31</NativeSelectOption>
            <NativeSelectOption value="mdy">12/31/2026</NativeSelectOption>
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t("decimal")}</Label>
          <NativeSelect
            size="sm"
            className="w-full"
            value={m.decimal}
            onChange={(e) => set({ decimal: e.target.value as CsvMapping["decimal"] })}
          >
            <NativeSelectOption value=",">{t("decimalComma")}</NativeSelectOption>
            <NativeSelectOption value=".">{t("decimalDot")}</NativeSelectOption>
          </NativeSelect>
        </div>
      </div>
    </fieldset>
  );
}
