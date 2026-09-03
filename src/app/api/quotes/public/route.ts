/**
 * Public quote endpoint — no session, no tenant header.
 *
 * It used to call `getDb()`, which reads the `x-tenant-id` header the proxy only
 * injects for authenticated dashboard requests. The proxy explicitly excludes
 * this path, so every customer who opened a quote link got a 500 (audit rilievo
 * B-01). The tenant is now derived from the token itself.
 */
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";

import { eq } from "drizzle-orm";

import { quoteActivities, quotes } from "@/db/schema";
import { announceQuoteDecision } from "@/lib/quote-events";
import { checkRateLimit } from "@/lib/rate-limiter";
import { resolveTenantByProbe, type TenantDb } from "@/lib/tenant-resolve";

/** Locates the workspace that issued this quote token. */
async function resolveQuoteTenant(token: string): Promise<TenantDb | null> {
  const resolved = await resolveTenantByProbe(`quote:${token}`, async (db) => {
    const row = await db.query.quotes.findFirst({
      where: eq(quotes.publicToken, token),
      columns: { id: true },
    });
    return Boolean(row);
  });
  return resolved?.db ?? null;
}

function clientIp(h: Headers): string {
  return h.get("x-vercel-forwarded-for") ?? h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? "unknown";
}

/** True when a quote is past its expiry date. */
function isExpired(expiresAt: Date | null): boolean {
  return Boolean(expiresAt && expiresAt.getTime() < Date.now());
}

// GET /api/quotes/public?token=xxx  — fetch quote by public token (no auth)
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

  const headersList = await headers();

  // The token is the only credential here, so guessing has to cost something.
  if (!(await checkRateLimit(`quote_public:${clientIp(headersList)}`, 60, 60_000))) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const db = await resolveQuoteTenant(token);
  if (!db) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const quote = await db.query.quotes.findFirst({
    where: eq(quotes.publicToken, token),
    with: {
      company: true,
      contact: true,
      owner: true,
      items: { with: { product: true } },
    },
  });

  if (!quote) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // An expired quote is still readable — the customer should see why they can no
  // longer accept it — but it is recorded as expired rather than left claiming to
  // be open. Nothing set this status before, so `expired` was an unreachable state.
  if (isExpired(quote.expiresAt) && ["sent", "viewed"].includes(quote.status)) {
    await db.update(quotes).set({ status: "expired", updatedAt: new Date() }).where(eq(quotes.id, quote.id));
    return NextResponse.json({ quote: { ...quote, status: "expired" } });
  }

  // Mark as viewed the first time the recipient opens it
  if (quote.status === "sent") {
    const ip = headersList.get("x-forwarded-for") ?? undefined;
    await db.update(quotes).set({ viewedAt: new Date(), status: "viewed" }).where(eq(quotes.id, quote.id));
    await db.insert(quoteActivities).values({ quoteId: quote.id, type: "viewed", ipAddress: ip ?? undefined });
    return NextResponse.json({ quote: { ...quote, status: "viewed", viewedAt: new Date() } });
  }

  return NextResponse.json({ quote });
}

// POST /api/quotes/public  — accept or decline quote by public token
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { token, action, reason } = body as { token: string; action: "accepted" | "declined"; reason?: string };

  if (!token || !["accepted", "declined"].includes(action)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const headersList = await headers();

  if (!(await checkRateLimit(`quote_decide:${clientIp(headersList)}`, 20, 60_000))) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const db = await resolveQuoteTenant(token);
  if (!db) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const quote = await db.query.quotes.findFirst({ where: eq(quotes.publicToken, token) });
  if (!quote) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!["sent", "viewed"].includes(quote.status)) {
    return NextResponse.json({ error: "Quote cannot be actioned in its current status" }, { status: 409 });
  }

  // An expiry date that is never checked is decoration: a quote could be accepted
  // months after it lapsed, at a price nobody still honours.
  if (isExpired(quote.expiresAt)) {
    await db.update(quotes).set({ status: "expired", updatedAt: new Date() }).where(eq(quotes.id, quote.id));
    return NextResponse.json({ error: "This quote has expired. Please ask for an updated one." }, { status: 409 });
  }

  const ip = headersList.get("x-forwarded-for") ?? undefined;

  const updateData =
    action === "accepted"
      ? { status: "accepted" as const, acceptedAt: new Date() }
      : { status: "declined" as const, declinedAt: new Date(), declineReason: reason ?? null };

  await db.update(quotes).set(updateData).where(eq(quotes.id, quote.id));
  await db.insert(quoteActivities).values({ quoteId: quote.id, type: action, ipAddress: ip ?? undefined });

  // ⚠️⚠️ The customer's own answer, which until now stayed inside this database. An
  // assistant that delivered the quote had no way to learn it, and kept chasing someone who
  // had already accepted. Awaited for the same reason the send is: on Workers a promise
  // still running after the response can be killed, and there would be nothing to retry
  // from. The actor is null because whoever clicked has no account here.
  await announceQuoteDecision({ ...quote, ...updateData }, action, null, db);

  return NextResponse.json({ success: true });
}
