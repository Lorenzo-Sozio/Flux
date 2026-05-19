import { NextResponse } from "next/server";

import { timingSafeEqual } from "crypto";

/**
 * Validates the Authorization: Bearer <CRON_SECRET> header.
 * Fails CLOSED — if CRON_SECRET is not set, all requests are rejected.
 * Returns a 401/500 Response on failure, or null on success.
 */
export function verifyCronRequest(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured on this server." }, { status: 500 });
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  let authorized = false;
  try {
    const a = Buffer.from(provided);
    const b = Buffer.from(secret);
    authorized = a.length === b.length && timingSafeEqual(a, b);
  } catch {}

  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
