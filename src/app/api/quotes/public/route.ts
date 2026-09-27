/**
 * Public quote endpoint — no session, no tenant header.
 *
 * It used to call `getDb()`, which reads the `x-tenant-id` header the proxy only
 * injects for authenticated dashboard requests. The proxy explicitly excludes
 * this path, so every customer who opened a quote link got a 500 (audit rilievo
 * B-01). The tenant is now derived from the token itself (src/lib/quote-public.ts).
 */
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";

import { and, eq, inArray } from "drizzle-orm";

import { quoteActivities, quotes } from "@/db/schema";
import { clientIp } from "@/lib/client-ip";
import { announceQuoteDecision, tellQuoteOwner } from "@/lib/quote-events";
import { isExpired, OPEN_QUOTE, readPublicQuote, resolveQuoteTenant } from "@/lib/quote-public";
import { readSignature, signQuote } from "@/lib/quote-signature";
import { checkRateLimit } from "@/lib/rate-limiter";
import { runWithTenant } from "@/lib/tenant-context";

/** A decline reason is a sentence or a paragraph, not a document. */
const MAX_REASON = 2000;

// GET /api/quotes/public?token=xxx  — fetch quote by public token (no auth)
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });
  const read = await readPublicQuote(token, clientIp(await headers()));
  if (read.status === 429) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  if (read.status !== 200) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ quote: read.quote });
}

// POST /api/quotes/public  — accept or decline quote by public token
export async function POST(req: NextRequest) {
  const notActionable = () =>
    NextResponse.json(
      { error: "Quote cannot be actioned in its current status", code: "not_actionable" },
      { status: 409 },
    );
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  // Strings, or nothing: an object where a token goes is a request, not a token.
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const action = body.action === "accepted" || body.action === "declined" ? body.action : null;
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, MAX_REASON) || null : null;
  if (!token || !action) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const headersList = await headers();
  const ip = clientIp(headersList);
  const userAgent = headersList.get("user-agent")?.slice(0, 500) ?? null;

  if (!(await checkRateLimit(`quote_decide:${ip}`, 20, 60_000))) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const tenant = await resolveQuoteTenant(token);
  if (!tenant) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { db } = tenant;

  const quote = await db.query.quotes.findFirst({ where: eq(quotes.publicToken, token) });
  if (!quote) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!OPEN_QUOTE.includes(quote.status)) return notActionable();

  // An expiry date that is never checked is decoration: a quote could be accepted
  // months after it lapsed, at a price nobody still honours.
  if (isExpired(quote.expiresAt)) {
    await db
      .update(quotes)
      .set({ status: "expired", updatedAt: new Date() })
      .where(and(eq(quotes.id, quote.id), inArray(quotes.status, OPEN_QUOTE)));
    return NextResponse.json(
      { error: "This quote has expired. Please ask for an updated one.", code: "expired" },
      { status: 409 },
    );
  }

  const now = new Date();
  let updateData:
    | { status: "accepted"; acceptedAt: Date }
    | { status: "declined"; declinedAt: Date; declineReason: string | null };
  if (action === "accepted") {
    // ⚠️⚠️ Accepting is signing (src/lib/quote-signature.ts): a typed name, a ticked consent,
    // and the fingerprint of the PDF being accepted. A click alone is not an acceptance.
    const signature = readSignature(body);
    if (!signature) {
      return NextResponse.json(
        { error: "Type your name and tick the consent to sign.", code: "signature_required" },
        { status: 422 },
      );
    }
    const signed = await signQuote(
      db,
      quote.id,
      // The address the platform saw (src/lib/client-ip.ts), never one the client wrote.
      { name: signature.name, ip, userAgent, workspaceName: tenant.name },
      now,
    );
    if (!signed.ok) return notActionable();
    updateData = { status: "accepted", acceptedAt: now };
  } else {
    updateData = { status: "declined", declinedAt: now, declineReason: reason };
    // ⚠️⚠️ Only while it is still open: a decline racing a signature must not overwrite an
    // accepted, signed quote — and two declines at once decline, notify and announce once.
    const declined = await db
      .update(quotes)
      .set(updateData)
      .where(and(eq(quotes.id, quote.id), inArray(quotes.status, OPEN_QUOTE)))
      .returning({ id: quotes.id });
    if (declined.length === 0) return notActionable();
  }
  await db.insert(quoteActivities).values({
    quoteId: quote.id,
    type: action,
    ipAddress: ip,
    userAgent: userAgent ?? undefined,
  });

  // ⚠️⚠️ The customer's own answer, which until now stayed inside this database. An
  // assistant that delivered the quote had no way to learn it, and kept chasing someone who
  // had already accepted. Awaited for the same reason the send is: on Workers a promise
  // still running after the response can be killed, and there would be nothing to retry
  // from. The actor is null because whoever clicked has no account here.
  await announceQuoteDecision({ ...quote, ...updateData }, action, null, db);
  await runWithTenant(tenant.id, () => tellQuoteOwner(quote, action, action === "declined" ? reason : null));

  return NextResponse.json({ success: true });
}
