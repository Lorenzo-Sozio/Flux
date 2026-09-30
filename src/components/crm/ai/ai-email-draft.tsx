"use client";

import { useState, useTransition } from "react";

import { AlertTriangleIcon, Loader2Icon, SparklesIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { draftEmailAction } from "@/actions/ai";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { AiEntry } from "@/lib/ai/types";

import { AiUnavailable } from "./ai-unavailable";

export interface InsertedDraft {
  suggestionId: string;
  subject: string;
  bodyHtml: string;
}

/** One-click requests: a first draft when the editor is empty, a rewrite when it is not. */
const DRAFT_ACTIONS = ["followUp", "meeting", "thanks", "reply"] as const;
const REWRITE_ACTIONS = ["shorter", "formal", "friendly", "proofread"] as const;

/**
 * C1: the copilot inside the email dialog (Fase 5). With an empty editor it drafts; with text in
 * it, it rewrites that text following the request.
 *
 * ⚠️ The draft goes into the editor, never out: the person reads it, changes it and presses Send
 * like any other email. Figures the record does not contain are listed for them to check.
 */
export function AiEmailDraft({
  entityType,
  entityId,
  entry,
  hasText,
  currentHtml,
  onDraft,
  onClose,
}: {
  /** The record the draft is written from: the recipient's, or the deal it is about. */
  entityType: "contact" | "lead" | "deal" | "company";
  entityId: string;
  entry: AiEntry;
  /** Whether the editor holds text: then the copilot rewrites it rather than starting over. */
  hasText: boolean;
  currentHtml: () => string;
  onDraft: (draft: InsertedDraft) => void;
  onClose: () => void;
}) {
  const t = useTranslations("aiCopilot.draft");
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<{ unverified: string[]; placeholder: string | null } | null>(null);
  const [pending, start] = useTransition();

  const run = (request: string) =>
    start(async () => {
      setError(null);
      try {
        const result = await draftEmailAction({
          entityType,
          entityId,
          instructions: request.trim() || undefined,
          currentDraftHtml: hasText ? currentHtml() : undefined,
        });
        if (!result.ok) {
          setError(result.message);
          return;
        }
        onDraft({ suggestionId: result.suggestionId, subject: result.subject, bodyHtml: result.bodyHtml });
        setNotes({
          unverified: result.unverified,
          // What the model was told to write instead of a figure it did not have (tasks.ts).
          placeholder: result.bodyHtml.match(/\[(?:da completare|to be completed)\]/)?.[0] ?? null,
        });
      } catch {
        setError(t("failed"));
      }
    });

  const actions = hasText ? REWRITE_ACTIONS : DRAFT_ACTIONS;

  return (
    <div className="border-b bg-primary/[0.03] px-4 py-3 md:px-5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-medium text-sm">
          <SparklesIcon className="size-4 text-primary" aria-hidden />
          {hasText ? t("titleRewrite") : t("title")}
        </p>
        <Button type="button" variant="ghost" size="icon-xs" onClick={onClose} aria-label={t("close")}>
          <XIcon />
        </Button>
      </div>

      {entry.state === "unavailable" ? (
        <AiUnavailable entry={entry} />
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {actions.map((action) => (
              <Button
                key={action}
                type="button"
                variant="outline"
                size="xs"
                disabled={pending}
                onClick={() => run(t(`actions.${action}.request`))}
              >
                {t(`actions.${action}.label`)}
              </Button>
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              onKeyDown={(e) => {
                // Enter asks, Shift+Enter is a new line; it must not reach the dialog's own shortcut.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!pending) run(instructions);
                }
              }}
              placeholder={hasText ? t("rewritePlaceholder") : t("instructionsPlaceholder")}
              aria-label={t("instructionsLabel")}
              rows={2}
              maxLength={1000}
              className="min-h-[60px] resize-none bg-background text-sm"
            />
            <Button type="button" size="sm" onClick={() => run(instructions)} disabled={pending} className="shrink-0">
              {pending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
              {pending ? t("writing") : hasText ? t("rewrite") : t("write")}
            </Button>
          </div>
          {error ? <p className="text-destructive text-xs">{error}</p> : null}
          {notes && !error ? (
            <div className="space-y-1 text-xs">
              <p className="text-muted-foreground">{t("inserted")}</p>
              {notes.placeholder ? (
                <p className="text-amber-700 dark:text-amber-400">
                  {t("placeholderHint", { placeholder: notes.placeholder })}
                </p>
              ) : null}
              {notes.unverified.length > 0 ? (
                <p className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
                  <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  {t("unverified", { figures: notes.unverified.join(", ") })}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
