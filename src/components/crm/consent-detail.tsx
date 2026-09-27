"use client";

import { useFormatter, useTranslations } from "next-intl";

import { CONSENT_SOURCES, type ConsentSource } from "@/lib/consent";

/**
 * When the latest consent decision was taken and where it came from — "since 12 Sep 2026,
 * from an import", "withdrawn on 3 Oct 2026, by unsubscribing" (src/lib/consent.ts). The
 * whole history of the switch is on the timeline.
 */
export function ConsentDetail({
  granted,
  decidedAt,
  source,
}: {
  granted: boolean | null;
  decidedAt: Date | string | null;
  source: string | null;
}) {
  const t = useTranslations("privacy.consent");
  const format = useFormatter();
  if (!decidedAt) return null;
  const date = format.dateTime(new Date(decidedAt), { dateStyle: "medium" });
  const known = (CONSENT_SOURCES as readonly string[]).includes(source ?? "");
  return (
    <span className="text-muted-foreground text-xs">
      {granted ? t("since", { date }) : t("withdrawnOn", { date })}
      {known && ` · ${t(`sources.${source as ConsentSource}`)}`}
    </span>
  );
}
