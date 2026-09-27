import { NextResponse } from "next/server";

import { submitTicketRating } from "@/lib/ticket-public-page";

/**
 * A customer's rating of a resolved request, from its status page (/t/<workspace>/<token>).
 * No session: the token in the body is the whole of the permission. The proxy holds it to a
 * few tries a minute per address.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid" }, { status: 400 });
  }
  const result = await submitTicketRating(body);
  if (result.ok) return NextResponse.json(result);
  const status = result.reason === "notFound" ? 404 : result.reason === "notYet" ? 409 : 400;
  return NextResponse.json(result, { status });
}
