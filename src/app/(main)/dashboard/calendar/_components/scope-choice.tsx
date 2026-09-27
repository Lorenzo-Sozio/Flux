"use client";

import { useTranslations } from "next-intl";

import type { RecurrenceScope } from "@/actions/appointments";
import { cn } from "@/lib/utils";

/** "This event / this and following / all events": the question every calendar asks of a series. */
export function ScopeChoice({
  value,
  onChange,
  exclude = [],
}: {
  value: RecurrenceScope;
  onChange: (scope: RecurrenceScope) => void;
  exclude?: RecurrenceScope[];
}) {
  const t = useTranslations("appointment");
  return (
    <div role="radiogroup" aria-label={t("scope.label")} className="space-y-1.5">
      {(["this", "following", "all"] as const)
        .filter((s) => !exclude.includes(s))
        .map((s) => (
          <label
            key={s}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
              value === s ? "border-primary bg-primary/5" : "hover:bg-muted/40",
            )}
          >
            <input
              type="radio"
              name="recurrence-scope"
              value={s}
              checked={value === s}
              onChange={() => onChange(s)}
              className="accent-primary"
            />
            {t(`scope.${s}`)}
          </label>
        ))}
    </div>
  );
}
