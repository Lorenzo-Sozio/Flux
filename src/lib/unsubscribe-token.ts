import { createHmac, timingSafeEqual } from "crypto";

/**
 * ⚠️⚠️ This read `NEXTAUTH_SECRET` and nothing else. Auth.js v5 names it
 * `AUTH_SECRET`, which is what every environment of this product sets and what
 * env-check asks for; `NEXTAUTH_SECRET` was set nowhere. So generating the link
 * threw, and every campaign send stopped at its first recipient — with a queued
 * log row and no email, which reads as a campaign still sending.
 *
 * Same secrets, in the same order, as the tracking links in the same email. No
 * link was ever signed with the old name, so none stops working.
 */
function getSecret(): string {
  const secret = process.env.TRACKING_SECRET || process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("TRACKING_SECRET or AUTH_SECRET must be set");
  return secret;
}

/** Generate a signed unsubscribe token (HMAC-SHA256). */
export function generateUnsubscribeToken(email: string, logId: string): string {
  const secret = getSecret();
  const sig = createHmac("sha256", secret).update(`${email}:${logId}`).digest("base64url");
  return Buffer.from(JSON.stringify({ e: email, l: logId, s: sig })).toString("base64url");
}

/** Verify an unsubscribe token. Returns payload or null. */
export function verifyUnsubscribeToken(token: string): { email: string; logId: string } | null {
  try {
    const { e: email, l: logId, s: sig } = JSON.parse(Buffer.from(token, "base64url").toString("utf-8"));
    if (typeof email !== "string" || typeof logId !== "string" || typeof sig !== "string") return null;

    const secret = getSecret();
    const expected = createHmac("sha256", secret).update(`${email}:${logId}`).digest("base64url");

    // Timing-safe comparison to prevent oracle attacks
    const sigBuf = Buffer.from(sig, "base64url");
    const expectedBuf = Buffer.from(expected, "base64url");
    if (sigBuf.length !== expectedBuf.length) return null;
    if (!timingSafeEqual(sigBuf, expectedBuf)) return null;

    return { email, logId };
  } catch {
    return null;
  }
}
