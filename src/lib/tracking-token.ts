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

/**
 * Every external link in `html`, rewritten to pass through the click tracker, signed.
 *
 * ⚠️⚠️ **One copy.** Campaigns and automations each had their own, and the automation's
 * left the signature off: the click route refuses an unsigned link with a 400, so every
 * tracked link in every automated email led to an error page. A second copy of a
 * function with a security property is where that property goes missing.
 *
 * Links already pointing at the tracker or at unsubscribe are left alone.
 */
export function trackLinks(html: string, logId: string, appBase: string): string {
  return html.replace(/href="(https?:\/\/[^"]+)"/gi, (match, url: string) => {
    if (url.includes("/api/track/") || url.includes("/api/unsubscribe")) return match;
    const sig = signTrackingUrl(logId, url);
    const tracked =
      `${appBase}/api/track/click` +
      `?log=${encodeURIComponent(logId)}` +
      `&url=${encodeURIComponent(url)}` +
      `&sig=${encodeURIComponent(sig)}`;
    return `href="${tracked}"`;
  });
}
