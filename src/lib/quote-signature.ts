/**
 * Accepting a quote with a simple electronic signature (L2, decision D5).
 *
 * A *firma elettronica semplice* (eIDAS art. 25; CAD art. 20): its weight is what the record
 * around it proves, so the record is the point — the name the customer typed, the exact
 * consent text they ticked, when, from which address and browser, and the SHA-256 of the PDF
 * they were accepting, with the bytes kept so the fingerprint can be checked later.
 *
 * ⚠️⚠️ **The consent text is the server's, never the browser's.** It is rebuilt here, in the
 * customer's language, from the quote's own number, and that is what is stored: a text sent by
 * the page could say anything.
 *
 * ⚠️⚠️ **The signing statement decides.** The update applies only while the quote is still
 * `sent` or `viewed`; two clicks at once, or a signature racing an expiry, sign once, and the
 * loser removes the PDF it stored.
 *
 * ⚠️ The PDF has a creation date inside, so a later rebuild would have another fingerprint.
 * The bytes signed are kept in object storage; when storage is not configured the signature
 * still stands on its record, and the fingerprint says so by having no file beside it.
 */
import { and, eq, inArray } from "drizzle-orm";

import { quotes } from "@/db/schema";
import { type DocumentLanguage, documentLanguage, fill, QUOTE_TEXT } from "@/lib/document-language";
import { buildQuotePdf, loadQuoteForPdf } from "@/lib/quote-pdf-load";
import { contentHash, getStorage, newStorageKey, type StorageDriver } from "@/lib/storage";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle's database types differ per driver
type AnyDb = any;

const SIGNABLE = ["sent", "viewed"];

/** The name typed and the box ticked; null when either is missing. */
export function readSignature(body: Record<string, unknown>): { name: string } | null {
  const name = typeof body.signerName === "string" ? body.signerName.trim().replace(/\s+/g, " ") : "";
  // A name has letters: "..." or "123" is not somebody.
  if (name.length < 3 || name.length > 120 || !/\p{L}/u.test(name)) return null;
  if (body.consent !== true) return null;
  return { name };
}

/** What the customer agreed to, in their language — the text that is stored. */
export function consentText(lang: DocumentLanguage, quoteNumber: string): string {
  return fill(QUOTE_TEXT[lang].signConsent, { number: quoteNumber });
}

export type SignResult =
  | { ok: true; quoteId: string; sha256: string; pdfKey: string | null; consent: string }
  | { ok: false; reason: "not_found" | "not_actionable" };

export async function signQuote(
  db: AnyDb,
  quoteId: string,
  input: { name: string; ip: string | null; userAgent: string | null; workspaceName: string | null },
  now: Date = new Date(),
  // A store is passed in tests; otherwise the deployment's, if it has one.
  store?: StorageDriver | null,
): Promise<SignResult> {
  const q = await loadQuoteForPdf(db, quoteId);
  if (!q) return { ok: false, reason: "not_found" };
  if (!SIGNABLE.includes(q.status)) return { ok: false, reason: "not_actionable" };

  const { bytes } = await buildQuotePdf(db, q, input.workspaceName);
  const sha256 = contentHash(bytes);
  let pdfKey: string | null = null;
  let kept: StorageDriver | null = null;
  try {
    kept = store === undefined ? await getStorage() : store;
    if (kept) {
      pdfKey = newStorageKey("signed.pdf");
      await kept.put(pdfKey, bytes, "application/pdf");
    }
  } catch (err) {
    // Storage missing or down: the signature stands on its record and its fingerprint.
    console.error("[quote-signature] signed PDF not kept", err);
    pdfKey = null;
  }

  const consent = consentText(documentLanguage(q.company), q.quoteNumber);
  const signed = await db
    .update(quotes)
    .set({
      status: "accepted",
      acceptedAt: now,
      updatedAt: now,
      signedName: input.name,
      signedAt: now,
      signedIp: input.ip,
      signedUserAgent: input.userAgent?.slice(0, 500) ?? null,
      signedConsent: consent,
      signedPdfSha256: sha256,
      signedPdfKey: pdfKey,
    })
    .where(and(eq(quotes.id, quoteId), inArray(quotes.status, SIGNABLE)))
    .returning({ id: quotes.id });
  if (signed.length === 0) {
    if (pdfKey && kept) await kept.delete(pdfKey).catch(() => undefined);
    return { ok: false, reason: "not_actionable" };
  }
  return { ok: true, quoteId, sha256, pdfKey, consent };
}

/**
 * The signed PDF back, checked: bytes whose fingerprint no longer matches are not served —
 * a signed document that could have been swapped is not evidence of anything.
 */
export async function readSignedPdf(
  store: StorageDriver,
  quote: { signedPdfKey: string | null; signedPdfSha256: string | null },
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: "missing" | "altered" }> {
  if (!quote.signedPdfKey || !quote.signedPdfSha256) return { ok: false, reason: "missing" };
  const bytes = await store.get(quote.signedPdfKey);
  if (!bytes) return { ok: false, reason: "missing" };
  if (contentHash(bytes) !== quote.signedPdfSha256) {
    console.error(`[quote-signature] signed PDF ${quote.signedPdfKey} no longer matches its fingerprint`);
    return { ok: false, reason: "altered" };
  }
  return { ok: true, bytes };
}
