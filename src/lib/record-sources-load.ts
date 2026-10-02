import "server-only";

import { getTranslations } from "next-intl/server";

import { recordSources } from "@/db/schema";
import { BUILT_IN_SOURCES, type RecordSource, sourceChoices, sourceLabel } from "@/lib/record-sources";
import { tolerateUnmigrated } from "@/lib/schema-ready";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle's database types differ per driver
type AnyDb = any;

const FALLBACK: RecordSource[] = BUILT_IN_SOURCES.map((key, i) => ({ key, name: null, order: i + 1, isActive: true }));

/** The workspace's sources, for a server page or a report. The list before migration 0073 is the built-in one. */
export async function loadRecordSources(db: AnyDb): Promise<RecordSource[]> {
  return tolerateUnmigrated(
    "record sources (0073)",
    () =>
      db
        .select({
          key: recordSources.key,
          name: recordSources.name,
          order: recordSources.order,
          isActive: recordSources.isActive,
        })
        .from(recordSources)
        .orderBy(recordSources.order, recordSources.key),
    FALLBACK,
  );
}

/**
 * How each stored value reads on the server, in the reader's language: what a report groups
 * by is the key, what it shows is this.
 */
export async function sourceLabeller(db: AnyDb): Promise<(value: string | null | undefined) => string | null> {
  const [sources, t] = await Promise.all([loadRecordSources(db), getTranslations("common.sources")]);
  return (value) => sourceLabel(value, sources, (key) => t(key));
}

/** A list filter's choices: the active sources by name, so "ADS Meta" is found by its name. */
export async function sourceFilterOptions(db: AnyDb): Promise<{ value: string; label: string }[]> {
  const [sources, t] = await Promise.all([loadRecordSources(db), getTranslations("common.sources")]);
  return sourceChoices(sources, null).map((s) => ({
    value: s.key,
    label: sourceLabel(s.key, sources, (key) => t(key)) ?? s.key,
  }));
}
