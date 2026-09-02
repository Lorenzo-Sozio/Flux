import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";

import { desc, eq } from "drizzle-orm";

import { quoteActivities, quoteItems, quotes } from "@/db/schema";
import { announceQuoteDecision } from "@/lib/quote-events";
import { getDb } from "@/lib/tenant-context";

// GET /api/quotes/public?token=xxx  — fetch quote by public token (no auth)
export async function GET(req: NextRequest) {
  const db = await getDb();
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

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

  // Mark as viewed if status is 'sent'
  if (quote.status === "sent") {
    const headersList = await headers();
    const ip = headersList.get("x-forwarded-for") ?? undefined;
    await db.update(quotes).set({ viewedAt: new Date(), status: "viewed" }).where(eq(quotes.id, quote.id));
    await db.insert(quoteActivities).values({ quoteId: quote.id, type: "viewed", ipAddress: ip ?? undefined });
  }

  return NextResponse.json({ quote });
}

// POST /api/quotes/public  — accept or decline quote by public token
export async function POST(req: NextRequest) {
  const db = await getDb();
  const body = await req.json();
  const { token, action, reason } = body as { token: string; action: "accepted" | "declined"; reason?: string };

  if (!token || !["accepted", "declined"].includes(action)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const quote = await db.query.quotes.findFirst({ where: eq(quotes.publicToken, token) });
  if (!quote) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!["sent", "viewed"].includes(quote.status)) {
    return NextResponse.json({ error: "Quote cannot be actioned in its current status" }, { status: 409 });
  }

  const headersList = await headers();
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
  await announceQuoteDecision({ ...quote, ...updateData }, action, null);

  return NextResponse.json({ success: true });
}
