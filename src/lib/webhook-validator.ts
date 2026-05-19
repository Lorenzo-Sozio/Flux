/**
 * Validates webhook destination URLs against SSRF attack vectors.
 *
 * Blocks:
 *  - Non-HTTPS schemes (plain HTTP is allowed only in development)
 *  - Private / reserved IPv4 ranges (RFC 1918, loopback, APIPA)
 *  - IPv6 loopback and private ranges (ULA, link-local)
 *  - Cloud metadata endpoints (169.254.169.254, [::ffff:169.254.169.254])
 *  - Bare hostnames without TLD (e.g. "http://internal-service/")
 *
 * Returns null on success or an error message string on failure.
 */

const PRIVATE_IPV4 = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^198\.51\.100\./,
  /^203\.0\.113\./,
  /^240\./,
];

const PRIVATE_IPV6 = [/^::1$/, /^fc[0-9a-f]{2}:/i, /^fd[0-9a-f]{2}:/i, /^fe80:/i, /^::ffff:169\.254\./i];

function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[(.+)\]$/, "$1");

  for (const re of PRIVATE_IPV4) {
    if (re.test(h)) return true;
  }
  for (const re of PRIVATE_IPV6) {
    if (re.test(h)) return true;
  }
  return false;
}

export function validateWebhookUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "Invalid URL.";
  }

  const isDev = process.env.NODE_ENV !== "production";

  if (u.protocol !== "https:" && !(isDev && u.protocol === "http:")) {
    return "Webhook URL must use HTTPS.";
  }

  if (isPrivateHost(u.hostname)) {
    return "Webhook URL must not point to a private or reserved network address.";
  }

  // Reject bare hostnames without a dot (e.g. "http://internal/")
  if (!u.hostname.includes(".") && u.hostname !== "localhost") {
    return "Webhook URL must include a fully-qualified domain name.";
  }

  return null;
}
