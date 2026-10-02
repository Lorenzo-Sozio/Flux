/**
 * Where a customer came from (provenienza): one list per workspace, the same values on a
 * lead, a contact, a company, a deal and an order (S1, docs/processo-operativo-2026-10.md).
 *
 * ⚠️⚠️ The value stored on a record is the source's **key**, never its label. Labels change
 * (a workspace renames "Sito" to "Sito web") and are read in two languages; the key is what
 * every report groups by, so a rename moves no record and splits no report.
 *
 * Before this the list was typed four times — three forms and the rule builder — and the
 * filters carried a fifth with different values, so a lead filed as "website" could not be
 * found by the filter offering "organic". Forms, filters, rules and reports read this now.
 *
 * Pure: imported by the actions, the pages and the client forms.
 */

export interface RecordSource {
  key: string;
  /** Null for a built-in source whose name was never changed: it is read in the reader's language. */
  name: string | null;
  order: number;
  isActive: boolean;
}

/**
 * The sources the migration seeds, in their order. Their labels are translations
 * (`common.sources.<key>`), until a workspace renames one.
 */
export const BUILT_IN_SOURCES = [
  "ads_meta",
  "ads_google",
  "website",
  "agent",
  "referral",
  "trade_show",
  "linkedin",
  "cold_outreach",
  "advertisement",
  "email_campaign",
  "other",
] as const;

/**
 * Values Flux writes by itself and nobody picks: an import, the API with no source given,
 * the public forms, the booking page, the sample data. They are read with a label of their
 * own, never offered in a form.
 */
export const SYSTEM_SOURCES = ["api", "import", "web_form", "booking", "sample"] as const;

const TRANSLATED = new Set<string>([...BUILT_IN_SOURCES, ...SYSTEM_SOURCES]);

/** Whether `common.sources.<key>` carries a label for this key. */
export function hasTranslatedLabel(key: string): boolean {
  return TRANSLATED.has(key);
}

/**
 * How a stored value reads: the workspace's own name for it, else the translated built-in
 * label, else the value as it was written (an old free-text value, or one sent by an
 * integration that is not in the list yet).
 */
export function sourceLabel(
  value: string | null | undefined,
  sources: readonly Pick<RecordSource, "key" | "name">[],
  translate: (key: string) => string,
): string | null {
  if (!value) return null;
  const named = sources.find((s) => s.key === value)?.name;
  if (named) return named;
  return hasTranslatedLabel(value) ? translate(value) : value;
}

/**
 * What a form offers: the active sources in their order, plus the record's current value
 * when it is retired or not in the list — so opening a record and saving it never erases
 * where it came from.
 */
export function sourceChoices(
  sources: readonly RecordSource[],
  current: string | null | undefined,
): { key: string; name: string | null; retired: boolean }[] {
  const active = sources
    .filter((s) => s.isActive)
    .sort((a, b) => a.order - b.order)
    .map((s) => ({ key: s.key, name: s.name, retired: false }));
  if (current && !active.some((s) => s.key === current)) {
    active.push({ key: current, name: sources.find((s) => s.key === current)?.name ?? null, retired: true });
  }
  return active;
}

/**
 * The key a new source is stored under, from its name: lower case, ASCII, underscores.
 * "ADS TikTok" → "ads_tiktok". A name with no letters left gets a random key; one already
 * taken gets a number after it.
 */
export function keyForName(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || `source_${Math.random().toString(36).slice(2, 8)}`;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
