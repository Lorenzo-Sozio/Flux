"use client";

import { useState } from "react";

import { CheckIcon, CopyIcon, RefreshCwIcon, ThumbsDownIcon, ThumbsUpIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { decideAiSuggestionAction } from "@/actions/ai";
import { Button } from "@/components/ui/button";

/**
 * A copilot answer as the person sees it: the text, the reminder that a model wrote it, and
 * the two buttons that say whether it was worth it (Fase 5).
 *
 * ⚠️ "Useful" and "Not useful" are not decoration: they are the `ai_suggestion` outcome, the
 * one measure of whether the copilot earns its cost. Trying again counts as "not useful".
 */
export function AiTextResult({
  text,
  suggestionId,
  onRegenerate,
  busy,
}: {
  text: string;
  suggestionId: string;
  onRegenerate: () => void;
  busy?: boolean;
}) {
  const t = useTranslations("aiCopilot.result");
  const [decided, setDecided] = useState(false);
  const [copied, setCopied] = useState(false);

  const decide = (outcome: "accepted" | "discarded") => {
    setDecided(true);
    void decideAiSuggestionAction(suggestionId, outcome).catch(() => undefined);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // The clipboard can be refused (an insecure origin, a denied permission): nothing to undo.
    }
  };

  return (
    <div className="space-y-3">
      <p className="whitespace-pre-line text-sm leading-relaxed">{text}</p>
      <p className="text-muted-foreground text-xs">{t("disclaimer")}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {decided ? (
          <span className="text-muted-foreground text-xs">{t("thanks")}</span>
        ) : (
          <>
            <Button type="button" variant="outline" size="xs" onClick={() => decide("accepted")}>
              <ThumbsUpIcon />
              {t("useful")}
            </Button>
            <Button type="button" variant="outline" size="xs" onClick={() => decide("discarded")}>
              <ThumbsDownIcon />
              {t("notUseful")}
            </Button>
          </>
        )}
        <Button type="button" variant="ghost" size="xs" onClick={copy}>
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? t("copied") : t("copy")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={busy}
          onClick={() => {
            if (!decided) decide("discarded");
            onRegenerate();
          }}
        >
          <RefreshCwIcon />
          {t("regenerate")}
        </Button>
      </div>
    </div>
  );
}
