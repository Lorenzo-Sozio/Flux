"use client";

import { useEffect, useState, useTransition } from "react";

import { CheckCircle2, FlaskConical, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";

import { recordsForRuleTest, testRuleAction } from "@/actions/automation";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

import type { Condition } from "./types";

type Result = Awaited<ReturnType<typeof testRuleAction>>;

/**
 * "Would this rule run on that record?" — condition by condition, without running it (§8.2).
 * A rule that did not apply writes nothing to the log, which is right, and left no way to
 * find out why it did not.
 */
export function RuleTestPanel({
  entity,
  conditions,
  logic,
  expression,
  fieldLabel,
}: {
  entity: string;
  conditions: Condition[];
  logic: "AND" | "OR";
  expression: string;
  fieldLabel: (key: string) => string;
}) {
  const t = useTranslations("automation.ruleBuilder.test");
  const [records, setRecords] = useState<{ id: string; label: string }[]>([]);
  const [recordId, setRecordId] = useState("");
  const [result, setResult] = useState<Result>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setRecordId("");
    setResult(null);
    recordsForRuleTest(entity)
      .then(setRecords)
      .catch(() => setRecords([]));
  }, [entity]);

  const run = () =>
    startTransition(async () => {
      setResult(await testRuleAction({ entity, recordId, conditions, logic, expression }).catch(() => null));
    });

  const shown = (v: unknown) =>
    v === null || v === undefined || v === "" ? t("empty") : v instanceof Date ? v.toLocaleString() : String(v);

  return (
    <div className="mt-6 space-y-3 border-t pt-4">
      <p className="flex items-center gap-2 font-semibold text-muted-foreground text-sm">
        <FlaskConical className="size-4" aria-hidden />
        {t("title")}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Select value={recordId} onValueChange={setRecordId}>
          <SelectTrigger className="w-full sm:flex-1" aria-label={t("pick")}>
            <SelectValue placeholder={records.length ? t("pick") : t("none")} />
          </SelectTrigger>
          <SelectContent>
            {records.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          onClick={run}
          disabled={!recordId || conditions.length === 0 || pending}
        >
          {t("run")}
        </Button>
      </div>
      {result && (
        <div className="space-y-2 rounded-md border p-3">
          <p
            className={cn(
              "font-medium text-sm",
              result.holds ? "text-emerald-700 dark:text-emerald-400" : "text-destructive",
            )}
          >
            {result.holds ? t("wouldRun") : t("wouldNotRun")}
          </p>
          <ul className="space-y-1">
            {result.details.map((d, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: conditions have no id; their order is their identity here
              <li key={i} className="flex items-start gap-2 text-xs">
                {d.holds ? (
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" aria-label={t("holds")} />
                ) : (
                  <XCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-label={t("fails")} />
                )}
                <span className="min-w-0 break-words">
                  {t("line", { field: fieldLabel(d.condition.field), actual: shown(d.actual) })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
