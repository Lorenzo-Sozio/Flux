/**
 * A quote as the customer's link shows it — read by the public page itself and by
 * `GET /api/quotes/public`. No session and no tenant header: the workspace comes from the
 * token (audit rilievo B-01).
 *
 * ⚠️⚠️ **What the link shows is listed, field by field.** It used to be the quote row minus
 * three fields, so everything else reached anyone the link was forwarded to — the manager's
 * internal rejection note among them, left on the row after the owner fixed the draft. A
 * field added to the quote tomorrow stays inside unless it is added here.
 *
 * ⚠️ **Every status it writes is conditional** on the status it read: "viewed" only from
 * "sent", "expired" only from sent or viewed. Unconditional, a view landing just after a
 * signature turned an accepted quote back into a viewed one.
 *
 * ⚠️ **The page calls this directly**, never its own API over the network. Fetched from the
 * server, every customer's request carried the server's address: one rate-limit bucket for
 * every quote link of every workspace, and "viewed from" the server.
 */
import { and, eq, inArray } from "drizzle-orm";

import { quoteActivities, quotes } from "@/db/schema";
import { documentLanguage } from "@/lib/document-language";
import { tellQuoteOwner } from "@/lib/quote-events";
import { checkRateLimit } from "@/lib/rate-limiter";
import { sellerIdentity } from "@/lib/seller-identity";
import { runWithTenant } from "@/lib/tenant-context";
import { resolveTenantByProbe, type TenantDb } from "@/lib/tenant-resolve";
import { PUBLIC_CONTACT_COLUMNS } from "@/lib/user-columns";

export const OPEN_QUOTE = ["sent", "viewed"];

/** Locates the workspace that issued this quote token. */
export async function resolveQuoteTenant(token: string): Promise<{ db: TenantDb; name: string; id: string } | null> {
  const resolved = await resolveTenantByProbe(`quote:${token}`, async (db) => {
    const row = await db.query.quotes.findFirst({
      where: eq(quotes.publicToken, token),
      columns: { id: true },
    });
    return Boolean(row);
  });
  return resolved ? { db: resolved.db, name: resolved.tenant.name, id: resolved.tenant.id } : null;
}

/** True when a quote is past its expiry date. */
export function isExpired(expiresAt: Date | null): boolean {
  return Boolean(expiresAt && expiresAt.getTime() < Date.now());
}

type Loaded = NonNullable<Awaited<ReturnType<typeof loadQuote>>>;

function loadQuote(db: TenantDb, token: string) {
  return db.query.quotes.findFirst({
    where: eq(quotes.publicToken, token),
    with: {
      // ⚠️ Only what the page shows. `company: true` sent the whole record to anyone
      // holding the link: annual revenue, lead score, owner, tags, internal notes.
      company: { columns: { name: true, country: true, language: true, vatNumber: true } },
      contact: { columns: { firstName: true, lastName: true } },
      owner: { columns: PUBLIC_CONTACT_COLUMNS },
      items: { with: { product: { columns: { name: true } } } },
    },
  });
}

/** The quote as the link may show it: listed, never "the row minus what we thought of". */
export function shownQuote(q: Loaded) {
  return {
    id: q.id,
    quoteNumber: q.quoteNumber,
    status: q.status,
    currency: q.currency,
    subtotal: q.subtotal,
    discountAmount: q.discountAmount,
    taxAmount: q.taxAmount,
    totalAmount: q.totalAmount,
    notes: q.notes,
    issuedAt: q.issuedAt,
    expiresAt: q.expiresAt,
    sentAt: q.sentAt,
    viewedAt: q.viewedAt,
    acceptedAt: q.acceptedAt,
    declinedAt: q.declinedAt,
    // Who signed and when; never the address, the browser or where the file is kept.
    signedName: q.signedName,
    signedAt: q.signedAt,
    items: q.items.map((i) => ({
      id: i.id,
      description: i.description,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      discountPercent: i.discountPercent,
      discountAmount: i.discountAmount,
      taxPercent: i.taxPercent,
      taxAmount: i.taxAmount,
      totalPrice: i.totalPrice,
      product: i.product ? { name: i.product.name } : null,
    })),
    company: q.company ? { name: q.company.name } : null,
    contact: q.contact,
    owner: q.owner,
  };
}

export type PublicQuoteRead =
  | { status: 200; quote: ReturnType<typeof shownQuote> & { language: string; sellerName: string } }
  | { status: 404 | 429 };

/** What the customer's link shows, recording the first view and a lapsed expiry on the way. */
export async function readPublicQuote(token: string, ip: string): Promise<PublicQuoteRead> {
  // The token is the only credential here, so guessing has to cost something.
  if (!(await checkRateLimit(`quote_public:${ip}`, 60, 60_000))) return { status: 429 };

  const tenant = await resolveQuoteTenant(token);
  if (!tenant) return { status: 404 };
  const { db } = tenant;
  const quote = await loadQuote(db, token);
  if (!quote) return { status: 404 };

  const seller = await sellerIdentity(db, tenant.name);
  const extra = { language: documentLanguage(quote.company), sellerName: seller.name };
  const shown = { ...shownQuote(quote), ...extra };

  // An expired quote is still readable — the customer should see why they can no longer
  // accept it — but it is recorded as expired rather than left claiming to be open.
  if (isExpired(quote.expiresAt) && OPEN_QUOTE.includes(quote.status)) {
    await db
      .update(quotes)
      .set({ status: "expired", updatedAt: new Date() })
      .where(and(eq(quotes.id, quote.id), inArray(quotes.status, OPEN_QUOTE)));
    return { status: 200, quote: { ...shown, status: "expired" } };
  }

  // The first opening only, decided by the update: two tabs opening at once notify once.
  if (quote.status === "sent") {
    const now = new Date();
    const viewed = await db
      .update(quotes)
      .set({ viewedAt: now, status: "viewed" })
      .where(and(eq(quotes.id, quote.id), eq(quotes.status, "sent")))
      .returning({ id: quotes.id });
    if (viewed.length > 0) {
      await db.insert(quoteActivities).values({ quoteId: quote.id, type: "viewed", ipAddress: ip });
      // The moment to call is when they are reading it.
      await runWithTenant(tenant.id, () => tellQuoteOwner(quote, "viewed"));
      return { status: 200, quote: { ...shown, status: "viewed", viewedAt: now } };
    }
  }
  return { status: 200, quote: shown };
}
