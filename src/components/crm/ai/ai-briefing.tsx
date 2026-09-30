"use client";

import { useState, useTransition } from "react";

import { Loader2Icon, SparklesIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { appointmentBriefingAction } from "@/actions/ai";
import { Button } from "@/components/ui/button";
import type { AiEntry } from "@/lib/ai/types";

import { AiTextResult } from "./ai-text-result";
import { AiUnavailable } from "./ai-unavailable";

type Shown = { text: string; suggestionId: string } | { error: string } | null;

/**
 * C3: a briefing before an appointment, from the record it is linked to (Fase 5).
 *
 * ⚠️ Mount it with `key={appointmentId}`: another appointment opened in the same sheet must not
 * show this one's briefing.
 */
export function AiBriefing({
  appointmentId,
  entry = { state: "ready" },
}: {
  appointmentId: string;
  /** Ready, or shown disabled with the reason (src/lib/ai/access.ts). */
  entry?: AiEntry;
}) {
  const t = useTranslations("aiCopilot.briefing");
  const [shown, setShown] = useState<Shown>(null);
  const [pending, start] = useTransition();

  const run = () =>
    start(async () => {
      try {
        const result = await appointmentBriefingAction(appointmentId);
        setShown(result.ok ? { text: result.text, suggestionId: result.suggestionId } : { error: result.message });
      } catch {
        setShown({ error: t("hint") });
      }
    });

  return (
    <section className="space-y-2 rounded-lg border p-3">
      <h3 className="flex items-center gap-2 font-medium text-sm">
        <SparklesIcon className="size-4 text-primary" />
        {t("title")}
      </h3>
      {shown && "text" in shown ? (
        <AiTextResult text={shown.text} suggestionId={shown.suggestionId} onRegenerate={run} busy={pending} />
      ) : (
        <>
          <p className="text-muted-foreground text-xs">{t("hint")}</p>
          {shown && "error" in shown ? <p className="text-destructive text-sm">{shown.error}</p> : null}
          {entry.state === "unavailable" ? <AiUnavailable entry={entry} /> : null}
          <Button type="button" variant="outline" size="sm" onClick={run} disabled={pending || entry.state !== "ready"}>
            {pending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
            {pending ? t("generating") : t("generate")}
          </Button>
        </>
      )}
    </section>
  );
}
