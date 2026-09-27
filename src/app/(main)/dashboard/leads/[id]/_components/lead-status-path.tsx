"use client";

import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { CheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { updateLead } from "@/actions/crm";
import { cn } from "@/lib/utils";

import { LEAD_STEPS } from "./lead-steps";

/**
 * Where the lead stands in qualification, and the control for moving it: the
 * lead's equivalent of the deal's stage path, drawn the same way so the two read
 * alike. Pressing a step sets the status.
 *
 * ⚠️ `updateLead` with `{ status }` alone is safe only because the score is now
 * computed on the saved lead merged with the change (see `updateLead`); it used
 * to be computed from the fields sent, and this control would have wiped every
 * point the email, phone and rating had earned.
 *
 * Unqualified and converted leads are off the path, and the page does not draw
 * it for them: the badge says where they ended, and converting is its own button.
 */
export function LeadStatusPath({
  leadId,
  status,
  labels,
  title,
  stepOf,
  canWrite,
}: {
  leadId: string;
  status: string;
  /** A translated name for each of `LEAD_STEPS`. */
  labels: Record<(typeof LEAD_STEPS)[number], string>;
  title: string;
  /** "Step 2 of 4", already translated. */
  stepOf: string;
  canWrite: boolean;
}) {
  const t = useTranslations("leads.detail");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // The step pressed shows as current at once; a round trip is long enough for a
  // second press on a step that has not visibly moved.
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const shown = optimistic ?? status;
  const current = LEAD_STEPS.indexOf(shown as (typeof LEAD_STEPS)[number]);
  if (LEAD_STEPS.indexOf(status as (typeof LEAD_STEPS)[number]) < 0) return null;

  const moveTo = (step: (typeof LEAD_STEPS)[number]) => {
    if (!canWrite || pending || step === shown) return;
    setOptimistic(step);
    startTransition(async () => {
      try {
        const result = await updateLead(leadId, { status: step });
        if (!result.ok) throw new Error(result.message);
        toast.success(t("statusChanged", { status: labels[step] }));
        router.refresh();
      } catch {
        toast.error(t("statusFailed"));
      } finally {
        setOptimistic(null);
      }
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">{title}</h2>
        <span className="text-muted-foreground text-xs tabular-nums">{stepOf}</span>
      </div>
      {/* Four equal columns rather than the deal's scrolling row: the steps are
          fixed and few, so they always fit, and a label that does not is cut
          with its full name in the title. */}
      <ol aria-label={title} className="grid grid-cols-4 gap-1.5">
        {LEAD_STEPS.map((step, i) => {
          const isCurrent = i === current;
          const isDone = i < current;
          const interactive = canWrite && !isCurrent;
          return (
            <li key={step} className="min-w-0">
              <button
                type="button"
                onClick={() => moveTo(step)}
                disabled={!interactive || pending}
                aria-current={isCurrent ? "step" : undefined}
                title={isCurrent ? labels[step] : t("moveTo", { status: labels[step] })}
                aria-label={isCurrent ? labels[step] : t("moveTo", { status: labels[step] })}
                className={cn(
                  "group flex min-h-11 w-full flex-col gap-1.5 rounded-md p-1.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
                  interactive && "hover:bg-muted",
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-full rounded-full transition-colors",
                    isCurrent ? "bg-primary" : isDone ? "bg-primary/60" : "bg-muted-foreground/20",
                  )}
                  aria-hidden
                />
                <span className="flex min-w-0 items-start gap-1 text-[11px] sm:text-xs">
                  {isDone && <CheckIcon className="size-3.5 shrink-0 text-primary" aria-hidden />}
                  {/* Two lines rather than an ellipsis: "In contatto" cut to "In con…"
                      named no status at all on a phone. */}
                  <span
                    className={cn(
                      "line-clamp-2 break-words leading-tight",
                      isCurrent ? "font-semibold text-foreground" : "text-muted-foreground",
                      interactive && "group-hover:text-foreground",
                    )}
                  >
                    {labels[step]}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
