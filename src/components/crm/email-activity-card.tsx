"use client";

import { useState } from "react";

import { AtSignIcon, ChevronDownIcon, CornerDownLeftIcon } from "lucide-react";
import { useTranslations } from "next-intl";

type EmailV2 = {
  subject: string;
  to: string;
  /** Set on an email received from the customer (src/lib/inbound-sales-reply.ts). */
  from?: string;
  snippet: string;
  bodyText: string;
};

export function EmailActivityCard({ email }: { email: EmailV2 }) {
  const t = useTranslations("entityDetail");
  const [expanded, setExpanded] = useState(false);
  const hasMore = email.bodyText.length > email.snippet.length;

  return (
    <div className="space-y-2">
      {email.from ? (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CornerDownLeftIcon className="w-3 h-3 flex-shrink-0" aria-hidden />
          <span className="flex-shrink-0">{t("emailFrom")}</span>
          <span className="truncate font-mono">{email.from}</span>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <AtSignIcon className="w-3 h-3 flex-shrink-0" />
          <span className="truncate font-mono">{email.to}</span>
        </div>
      )}

      <p className="break-words text-sm font-semibold leading-snug">{email.subject}</p>

      {email.snippet && (
        <p className="break-words text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
          {expanded ? email.bodyText : email.snippet}
          {!expanded && hasMore && "…"}
        </p>
      )}

      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline max-sm:py-2"
        >
          <ChevronDownIcon className={`w-3 h-3 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
          {expanded ? t("emailShowLess") : t("emailShowMore")}
        </button>
      )}
    </div>
  );
}
