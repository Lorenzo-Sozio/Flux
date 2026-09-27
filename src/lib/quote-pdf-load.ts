/**
 * A quote's PDF, built from a given database: the download route and the signature both use
 * it, so the document a customer signs is the document they could download.
 */
import { desc, eq } from "drizzle-orm";

import { quoteActivities, quotes } from "@/db/schema";
import { documentLanguage, QUOTE_TEXT } from "@/lib/document-language";
import { renderQuotePdf } from "@/lib/pdf/quote-pdf";
import { sellerIdentity } from "@/lib/seller-identity";
import { USER_SUMMARY_COLUMNS } from "@/lib/user-columns";
import { loadWorkspaceLogo } from "@/lib/workspace-logo";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle's database types differ per driver
type AnyDb = any;

/** The quote with everything its PDF draws, or null. */
export async function loadQuoteForPdf(db: AnyDb, id: string) {
  return db.query.quotes.findFirst({
    where: eq(quotes.id, id),
    with: {
      deal: true,
      company: true,
      contact: true,
      owner: { columns: USER_SUMMARY_COLUMNS },
      items: { with: { product: true } },
      activities: {
        with: { user: { columns: USER_SUMMARY_COLUMNS } },
        orderBy: desc(quoteActivities.createdAt),
      },
    },
  });
}

export type QuoteForPdf = NonNullable<Awaited<ReturnType<typeof loadQuoteForPdf>>>;

/** The PDF bytes and a file name, in the customer's language whoever asks. */
export async function buildQuotePdf(
  db: AnyDb,
  q: QuoteForPdf,
  workspaceName: string | null,
): Promise<{ bytes: Uint8Array; fileName: string }> {
  const lang = documentLanguage(q.company);
  const seller = await sellerIdentity(db, workspaceName);
  if (!seller.email && q.owner?.email) seller.email = q.owner.email;
  const buffer = await renderQuotePdf({ quote: q, seller, lang, logo: await loadWorkspaceLogo(db) });
  const fileName = `${QUOTE_TEXT[lang].documentTitle}-${q.quoteNumber}`.replace(/[^A-Za-z0-9-]/g, "-");
  return { bytes: new Uint8Array(buffer), fileName };
}
