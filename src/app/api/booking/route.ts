import { type NextRequest, NextResponse } from "next/server";

import { getTranslations } from "next-intl/server";

import { submitBooking } from "@/lib/booking-public";

/**
 * A visitor books a slot from a public booking page (src/lib/booking-public.ts).
 *
 * No session: the workspace and the person come from the address, the slot is checked
 * against what is offered, and the proxy rate-limits this path by address.
 *
 * ⚠️ `website` is a field no person sees. A form that fills it is a script; it is answered
 * as if it had worked, so it has no reason to try again, and nothing is written.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid" }, { status: 400 });
  }
  const str = (k: string, max: number) => (typeof body[k] === "string" ? (body[k] as string).trim().slice(0, max) : "");

  if (str("website", 200)) return NextResponse.json({ ok: true });

  const workspace = str("workspace", 63).toLowerCase();
  const token = str("token", 40);
  const start = new Date(str("start", 40));
  const name = str("name", 120);
  const email = str("email", 254).toLowerCase();
  if (!workspace || !token || Number.isNaN(start.getTime()) || !name || !EMAIL.test(email)) {
    return NextResponse.json({ ok: false, reason: "invalid" }, { status: 422 });
  }

  const t = await getTranslations("booking");
  const result = await submitBooking(
    workspace,
    token,
    start,
    { name, email, phone: str("phone", 40) || null, note: str("note", 2000) || null },
    t("defaultTitle"),
  );
  if (result.ok) {
    return NextResponse.json({ ok: true, startAt: result.startAt.toISOString(), endAt: result.endAt.toISOString() });
  }
  return NextResponse.json(result, { status: result.reason === "notFound" ? 404 : 409 });
}
