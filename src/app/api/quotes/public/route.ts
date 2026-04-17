import { desc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/db";
import { quoteActivities, quoteItems, quotes } from "@/db/schema";

// GET /api/quotes/public?token=xxx  — fetch quote by public token (no auth)
export async function GET(req: NextRequest) {
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

  return NextResponse.json({ success: true });
}
