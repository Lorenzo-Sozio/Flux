"use client";

import Link from "next/link";

import { AlertTriangle, ExternalLink, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

export interface DuplicateMatch {
  id: string;
  label: string;
  detail?: string | null;
  href: string;
}

/**
 * Says "this one already exists" while the form is still being filled in.
 *
 * Deliberately a strip and not a dialog: at this point nothing has been typed
 * that is worth defending, and the only useful reply is either "open that one" or
 * "no, this is someone else". A modal would demand a decision before the user has
 * finished forming the question.
 */
export function DuplicateHint({
  matches,
  onDismiss,
  titleKey,
}: {
  matches: DuplicateMatch[];
  onDismiss: () => void;
  /** A key, not a sentence: only this component knows who is reading. */
  titleKey: "companyTitle" | "contactTitle" | "leadTitle";
}) {
  const t = useTranslations("duplicates");

  if (matches.length === 0) return null;

  return (
    <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 dark:border-amber-900 dark:bg-amber-950/40">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-amber-900 text-sm dark:text-amber-200">{t(titleKey)}</p>
          <ul className="mt-1 space-y-0.5">
            {matches.map((m) => (
              <li key={m.id} className="flex items-center gap-1.5 text-sm">
                <Link
                  href={m.href}
                  target="_blank"
                  className="truncate text-amber-800 underline underline-offset-2 hover:text-amber-950 dark:text-amber-300"
                >
                  {m.label}
                </Link>
                <ExternalLink className="h-3 w-3 shrink-0 text-amber-600 dark:text-amber-500" />
                {m.detail && (
                  <span className="truncate text-amber-700/70 text-xs dark:text-amber-400/70">{m.detail}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-6 w-6 shrink-0 text-amber-700 hover:bg-amber-100 dark:text-amber-400"
          onClick={onDismiss}
          aria-label={t("dismiss")}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
