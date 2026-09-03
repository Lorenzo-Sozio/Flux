/**
 * company-name.ts — deciding when two spellings mean the same company.
 *
 * Lead conversion matched on exact equality, so "ACME Srl" and "Acme S.r.l."
 * became two companies, each with half the history (audit rilievo M-03). The
 * duplicate checker elsewhere in the product had the same weakness.
 *
 * Pure and tested, because the failure is silent: a duplicate company looks like
 * a company.
 */

/**
 * Legal-form suffixes, matched only as whole words.
 *
 * ⚠️ The word boundary is the whole safety of this list. Without it "sa" strips
 * the middle out of "Sanofi" and "inc" mangles "Incotex", quietly collapsing two
 * unrelated companies into one — which is worse than the duplicate it was meant
 * to prevent.
 */
const LEGAL_FORMS = [
  "srl",
  "srls",
  "spa",
  "sapa",
  "snc",
  "sas",
  "scarl",
  "sc",
  "ss",
  "ltd",
  "limited",
  "llc",
  "llp",
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "co",
  "gmbh",
  "ug",
  "ag",
  "kg",
  "ohg",
  "bv",
  "nv",
  "sarl",
  "sas",
  "sa",
  "plc",
  "oy",
  "ab",
  "as",
  "aps",
];

const LEGAL_FORM_PATTERN = new RegExp(`\\b(?:${LEGAL_FORMS.join("|")})\\b`, "g");

/**
 * A comparable form of a company name.
 *
 * Case, accents, punctuation, spacing and the legal form are all removed, because
 * none of them distinguish one company from another. What survives is the part a
 * person would read out.
 *
 * Returns the original (lowercased, trimmed) when stripping would leave nothing —
 * a company genuinely called "SA" must not normalise to the empty string, which
 * would match every other name that also reduced to nothing.
 */
export function normalizeCompanyName(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    // Combining marks left behind by NFKD: "società" → "societa".
    .replace(/[̀-ͯ]/g, "")
    // Punctuation inside an abbreviation, so "s.r.l." can match "srl".
    .replace(/[.'`’]/g, "");

  const withoutLegalForm = base.replace(LEGAL_FORM_PATTERN, " ");
  const cleaned = withoutLegalForm.replace(/[^a-z0-9]+/g, " ").trim();

  if (cleaned) return cleaned;
  return base.replace(/[^a-z0-9]+/g, " ").trim();
}

/** True when two names denote the same company as far as a person is concerned. */
export function isSameCompanyName(a: string, b: string): boolean {
  return normalizeCompanyName(a) === normalizeCompanyName(b);
}
