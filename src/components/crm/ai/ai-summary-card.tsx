"use client";

import { useState, useTransition } from "react";

import { Loader2Icon, SparklesIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { summarizeRecordAction } from "@/actions/ai";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AiSubject } from "@/lib/ai/context";
import type { AiEntry } from "@/lib/ai/types";

import { AiTextResult } from "./ai-text-result";
import { AiUnavailable } from "./ai-unavailable";

type Shown = { text: string; suggestionId: string } | { error: string } | null;

/**
 * C2: a record summarised on request (Fase 5). Nothing is sent to the model until the person
 * presses the button: opening a record costs nothing.
 */
export function AiSummaryCard({
  subject,
  entry = { state: "ready" },
}: {
  subject: AiSubject;
  /** Ready, or shown disabled with the reason (src/lib/ai/access.ts). */
  entry?: AiEntry;
}) {
  const t = useTranslations("aiCopilot.summary");
  const [shown, setShown] = useState<Shown>(null);
  const [pending, start] = useTransition();

  const run = () =>
    start(async () => {
      try {
        const result = await summarizeRecordAction(subject);
        setShown(result.ok ? { text: result.text, suggestionId: result.suggestionId } : { error: result.message });
      } catch {
        setShown({ error: t("hint") });
      }
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <SparklesIcon className="size-4 text-primary" />
          {t("title")}
        </CardTitle>
        {!shown || "error" in shown ? <CardDescription>{t("hint")}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {shown && "text" in shown ? (
          <AiTextResult text={shown.text} suggestionId={shown.suggestionId} onRegenerate={run} busy={pending} />
        ) : (
          <>
            {shown && "error" in shown ? <p className="text-destructive text-sm">{shown.error}</p> : null}
            {entry.state === "unavailable" ? <AiUnavailable entry={entry} /> : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={run}
              disabled={pending || entry.state !== "ready"}
            >
              {pending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
              {pending ? t("generating") : t("generate")}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
