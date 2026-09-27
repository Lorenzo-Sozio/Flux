"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Repeat } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  type Frequency,
  formatRRule,
  nthOfMonth,
  parseRRule,
  type Recurrence,
  WEEKDAYS,
  type Weekday,
  weekdayIn,
} from "@/lib/recurrence";
import { describeRecurrence, weekdayName } from "@/lib/recurrence-text";
import { cn } from "@/lib/utils";
import { addDaysToDate, fromWallValue, toWallDate } from "@/lib/wall-clock";

type PresetKey = "none" | "daily" | "weekdays" | "weekly" | "monthlyDay" | "monthlyNth" | "yearly" | "custom";
type EndKind = "never" | "until" | "count";

/** The rule each preset means for an appointment starting at `start`, without an end. */
function presetRule(key: PresetKey, start: Date, timeZone: string): Recurrence | null {
  switch (key) {
    case "daily":
      return { freq: "DAILY", interval: 1 };
    case "weekdays":
      return { freq: "WEEKLY", interval: 1, byDay: ["MO", "TU", "WE", "TH", "FR"] };
    case "weekly":
      return { freq: "WEEKLY", interval: 1, byDay: [weekdayIn(start, timeZone)] };
    case "monthlyDay":
      return { freq: "MONTHLY", interval: 1 };
    case "monthlyNth":
      return {
        freq: "MONTHLY",
        interval: 1,
        nthWeekday: { n: nthOfMonth(start, timeZone), day: weekdayIn(start, timeZone) },
      };
    case "yearly":
      return { freq: "YEARLY", interval: 1 };
    default:
      return null;
  }
}

const withoutEnd = (r: Recurrence): Recurrence => ({ ...r, count: undefined, until: undefined });

const PRESETS: PresetKey[] = ["none", "daily", "weekdays", "weekly", "monthlyDay", "monthlyNth", "yearly", "custom"];

function matchPreset(rule: Recurrence | null, start: Date, timeZone: string): PresetKey {
  if (!rule) return "none";
  const base = formatRRule(withoutEnd(rule));
  for (const key of PRESETS) {
    const p = presetRule(key, start, timeZone);
    if (p && formatRRule(p) === base) return key;
  }
  return "custom";
}

/**
 * How an appointment repeats: the choices every calendar offers, worded for the
 * date it starts on ("every week on Tuesday"), a custom rule, and when it stops.
 */
export function RecurrencePicker({
  value,
  onChange,
  start,
  timeZone,
}: {
  value: string | null;
  onChange: (rule: string | null) => void;
  /** The first occurrence, as a wall-clock value in `timeZone`. */
  start: string;
  timeZone: string;
}) {
  const t = useTranslations("appointment");
  const locale = useLocale();
  const startInstant = useMemo(() => fromWallValue(start, timeZone) ?? new Date(), [start, timeZone]);
  const rule = useMemo(() => parseRRule(value), [value]);
  const [preset, setPreset] = useState<PresetKey>(() => matchPreset(rule, startInstant, timeZone));

  const emit = (next: Recurrence | null) => onChange(next ? formatRRule(next) : null);
  const end: EndKind = rule?.count ? "count" : rule?.until ? "until" : "never";

  // A rule that names the start's weekday follows the start when it moves, as
  // "every week on Tuesday" stops being true the moment the meeting is on Wednesday.
  const lastStart = useRef(start);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reacts to the start only
  useEffect(() => {
    if (lastStart.current === start) return;
    lastStart.current = start;
    if (!rule || (preset !== "weekly" && preset !== "monthlyNth")) return;
    const next = presetRule(preset, startInstant, timeZone);
    if (next) emit({ ...next, count: rule.count, until: rule.until });
  }, [start]);

  const choosePreset = (key: PresetKey) => {
    setPreset(key);
    if (key === "none") return emit(null);
    if (key === "custom")
      return emit(rule ?? { freq: "WEEKLY", interval: 1, byDay: [weekdayIn(startInstant, timeZone)] });
    const next = presetRule(key, startInstant, timeZone);
    if (next) emit({ ...next, count: rule?.count, until: rule?.until });
  };

  const presetLabel = (key: PresetKey) => {
    if (key === "none") return t("recurrence.none");
    if (key === "custom") return t("recurrence.custom");
    const r = presetRule(key, startInstant, timeZone);
    return r ? describeRecurrence(t, r, startInstant, timeZone, locale, { withEnd: false }) : key;
  };

  const selectClass =
    "flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
  const startDate = toWallDate(startInstant, timeZone);
  const untilDate = rule?.until ? toWallDate(rule.until, timeZone) : addDaysToDate(startDate, 90);

  return (
    <div className="space-y-2">
      <Label htmlFor="apt-repeat" className="flex items-center gap-1.5">
        <Repeat className="h-3.5 w-3.5" /> {t("recurrence.label")}
      </Label>
      <select
        id="apt-repeat"
        value={preset}
        onChange={(e) => choosePreset(e.target.value as PresetKey)}
        className={selectClass}
      >
        {PRESETS.map((key) => (
          <option key={key} value={key}>
            {presetLabel(key)}
          </option>
        ))}
      </select>

      {rule && preset === "custom" && (
        <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>{t("recurrence.every")}</span>
            <Input
              type="number"
              min={1}
              max={99}
              value={rule.interval}
              onChange={(e) => emit({ ...rule, interval: Math.min(99, Math.max(1, Number(e.target.value) || 1)) })}
              className="h-8 w-16"
              aria-label={t("recurrence.interval")}
            />
            <select
              value={rule.freq}
              onChange={(e) => {
                const freq = e.target.value as Frequency;
                emit({
                  freq,
                  interval: rule.interval,
                  count: rule.count,
                  until: rule.until,
                  byDay: freq === "WEEKLY" ? [weekdayIn(startInstant, timeZone)] : undefined,
                });
              }}
              className={cn(selectClass, "h-8 w-auto")}
              aria-label={t("recurrence.frequency")}
            >
              {(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as Frequency[]).map((f) => (
                <option key={f} value={f}>
                  {t(`recurrence.unit.${f}.${rule.interval === 1 ? "one" : "other"}`)}
                </option>
              ))}
            </select>
          </div>

          {rule.freq === "WEEKLY" && (
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((d: Weekday) => {
                const on = rule.byDay?.includes(d) ?? false;
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    title={weekdayName(d, locale)}
                    onClick={() => {
                      const days = on ? (rule.byDay ?? []).filter((x) => x !== d) : [...(rule.byDay ?? []), d];
                      // A week with no day in it is not a rule; keep the start's.
                      emit({
                        ...rule,
                        byDay: days.length
                          ? WEEKDAYS.filter((x) => days.includes(x))
                          : [weekdayIn(startInstant, timeZone)],
                      });
                    }}
                    className={cn(
                      "flex size-8 items-center justify-center rounded-full border font-medium text-xs transition-colors",
                      on ? "border-primary bg-primary text-primary-foreground" : "hover:border-primary/40",
                    )}
                  >
                    {weekdayName(d, locale).slice(0, 2)}
                  </button>
                );
              })}
            </div>
          )}

          {rule.freq === "MONTHLY" && (
            <div className="flex flex-col gap-1.5 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="apt-monthly"
                  checked={!rule.nthWeekday}
                  onChange={() => emit({ ...rule, nthWeekday: undefined })}
                />
                {describeRecurrence(t, { freq: "MONTHLY", interval: rule.interval }, startInstant, timeZone, locale, {
                  withEnd: false,
                })}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="apt-monthly"
                  checked={Boolean(rule.nthWeekday)}
                  onChange={() =>
                    emit({
                      ...rule,
                      nthWeekday: { n: nthOfMonth(startInstant, timeZone), day: weekdayIn(startInstant, timeZone) },
                    })
                  }
                />
                {describeRecurrence(
                  t,
                  {
                    freq: "MONTHLY",
                    interval: rule.interval,
                    nthWeekday: { n: nthOfMonth(startInstant, timeZone), day: weekdayIn(startInstant, timeZone) },
                  },
                  startInstant,
                  timeZone,
                  locale,
                  { withEnd: false },
                )}
              </label>
            </div>
          )}
        </div>
      )}

      {rule && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t("recurrence.ends")}</span>
          <select
            value={end}
            onChange={(e) => {
              const kind = e.target.value as EndKind;
              const base = withoutEnd(rule);
              if (kind === "never") emit(base);
              if (kind === "count") emit({ ...base, count: rule.count ?? 10 });
              if (kind === "until") {
                const until = fromWallValue(addDaysToDate(untilDate, 1), timeZone);
                emit({ ...base, until: until ? new Date(until.getTime() - 1000) : undefined });
              }
            }}
            className={cn(selectClass, "h-8 w-auto")}
            aria-label={t("recurrence.ends")}
          >
            <option value="never">{t("recurrence.endNever")}</option>
            <option value="until">{t("recurrence.endUntil")}</option>
            <option value="count">{t("recurrence.endCount")}</option>
          </select>
          {end === "until" && (
            <input
              type="date"
              value={untilDate}
              min={startDate}
              onChange={(e) => {
                if (!e.target.value) return;
                // Inclusive of the whole day chosen, on the series' clock.
                const until = fromWallValue(addDaysToDate(e.target.value, 1), timeZone);
                if (until) emit({ ...rule, count: undefined, until: new Date(until.getTime() - 1000) });
              }}
              className={cn(selectClass, "h-8 w-auto")}
              aria-label={t("recurrence.endUntil")}
            />
          )}
          {end === "count" && (
            <span className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={999}
                value={rule.count ?? 10}
                onChange={(e) =>
                  emit({ ...rule, until: undefined, count: Math.min(999, Math.max(1, Number(e.target.value) || 1)) })
                }
                className="h-8 w-20"
                aria-label={t("recurrence.endCount")}
              />
              <span className="text-muted-foreground">
                {t(`recurrence.occurrences.${(rule.count ?? 10) === 1 ? "one" : "other"}`)}
              </span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
