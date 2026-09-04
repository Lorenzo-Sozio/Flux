"use client";

import { useState } from "react";

import { AlertTriangle, ChevronDown, Eye, MailWarning } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  findUnknownPlaceholders,
  hasUnsubscribePlaceholder,
  PLACEHOLDERS,
  renderPlaceholders,
  sampleValues,
} from "@/lib/email-placeholders";
import { sanitizeEmailHtml } from "@/lib/sanitize-email-html";

/**
 * The catalogue, next to the box the email is written in.
 *
 * Five placeholders existed, in Italian only, listed nowhere the author could
 * see them (audit rilievo S-08). Anyone writing `{{firstName}}` — the obvious
 * guess in an English product — sent it to a customer exactly as typed, and the
 * send reported success. Three things are shown here, all before it goes out:
 * what can be written, what was written that nothing will fill in, and what the
 * result actually reads like.
 */
export function PlaceholderHelp({ subject, body }: { subject: string; body: string }) {
  const [showList, setShowList] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const text = `${subject}\n${body}`;
  const unknown = findUnknownPlaceholders(text);
  const missingUnsubscribe = body.trim().length > 0 && !hasUnsubscribePlaceholder(body);

  const samples = sampleValues();

  return (
    <div className="space-y-2">
      {unknown.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-950/40">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-amber-900 text-sm dark:text-amber-200">
            Nothing will fill in {unknown.map((u) => `{{${u}}}`).join(", ")}. It will reach the recipient exactly as
            written.
          </p>
        </div>
      )}

      {missingUnsubscribe && (
        <div className="flex items-start gap-2 rounded-md border border-sky-300 bg-sky-50 px-3 py-2 dark:border-sky-900 dark:bg-sky-950/40">
          <MailWarning className="mt-0.5 h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
          <p className="text-sky-900 text-sm dark:text-sky-200">
            No unsubscribe link. One will be added at the bottom when this is sent — place{" "}
            <code className="rounded bg-sky-100 px-1 dark:bg-sky-900">{"{{unsubscribe}}"}</code> yourself to control
            where it goes.
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setShowList((v) => !v)}>
          <ChevronDown className={`mr-1.5 h-3.5 w-3.5 transition-transform ${showList ? "rotate-180" : ""}`} />
          What can I put in?
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setShowPreview((v) => !v)}>
          <Eye className="mr-1.5 h-3.5 w-3.5" />
          {showPreview ? "Hide" : "Preview"} with example values
        </Button>
      </div>

      {showList && (
        <ul className="grid gap-1.5 rounded-md border bg-muted/40 p-3 sm:grid-cols-2">
          {PLACEHOLDERS.map((p) => (
            <li key={p.key} className="text-sm">
              <code className="rounded bg-background px-1 py-0.5 font-mono text-xs">{`{{${p.aliases[0]}}}`}</code>
              <span className="ml-2 text-muted-foreground">{p.description}</span>
            </li>
          ))}
        </ul>
      )}

      {showPreview && (
        <div className="space-y-2 rounded-md border bg-muted/40 p-3">
          <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">Subject</p>
          <p className="text-sm">{renderPlaceholders(subject, samples) || <em>Empty</em>}</p>
          <p className="pt-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">Body</p>
          {/* Sanitised even though a colleague wrote it: a template author and a
              template previewer are not always the same person, and this renders
              inside the previewer's session. */}
          <div
            className="prose prose-sm dark:prose-invert max-w-none rounded bg-background p-3"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: an email body is HTML by definition; sanitised above
            dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(renderPlaceholders(body, samples)) }}
          />
        </div>
      )}
    </div>
  );
}
