import { createHmac, timingSafeEqual } from "node:crypto";

function getSecret(): string {
  const s = process.env.TRACKING_SECRET ?? process.env.AUTH_SECRET;
  if (!s) throw new Error("TRACKING_SECRET or AUTH_SECRET must be set");
  return s;
}

/**
 * Signs a (logId, destinationUrl) pair with HMAC-SHA256.
 * The signature cryptographically binds the URL to the log entry,
 * preventing open-redirect abuse where an attacker supplies an arbitrary URL.
 */
export function signTrackingUrl(logId: string, url: string): string {
  return createHmac("sha256", getSecret()).update(`${logId}:${url}`).digest("base64url");
}

/**
 * Verifies that the (logId, url, sig) triple was produced by this server.
 * Returns false if the signature is missing, malformed, or invalid.
 */
export function verifyTrackingUrl(logId: string, url: string, sig: string): boolean {
  try {
    const expected = createHmac("sha256", getSecret()).update(`${logId}:${url}`).digest("base64url");
    const a = Buffer.from(sig, "base64url");
    const b = Buffer.from(expected, "base64url");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
