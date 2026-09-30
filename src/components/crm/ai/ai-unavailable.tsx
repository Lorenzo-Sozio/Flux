"use client";

import { LockIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import type { AiEntry } from "@/lib/ai/types";

/**
 * Why a copilot control is there and cannot be used: the plan does not include it, or — shown
 * to Flux's own staff only — the deployment has no provider configured (src/lib/ai/access.ts).
 */
export function AiUnavailable({ entry }: { entry: Extract<AiEntry, { state: "unavailable" }> }) {
  const t = useTranslations("aiCopilot.unavailable");
  return (
    <p className="flex items-start gap-1.5 text-muted-foreground text-xs">
      <LockIcon className="mt-0.5 size-3 shrink-0" aria-hidden />
      {t(entry.reason)}
    </p>
  );
}
