import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The credential in the address of a workspace's logo, as emails show it.
 *
 * A mail client fetches the images of an email with no session, so the logo needs an address
 * that works for anybody — and that address must open the logo of one workspace and nothing
 * else. It carries the workspace, signed: a token cannot be made for another workspace without
 * the key, and it reaches no route but the logo's.
 *
 * ⚠️ This is a **boundary surface**, small as it is: the token decides which workspace's
 * database is opened. Signed rather than stored, like the calendar feed's
 * (src/lib/calendar-feed-token.ts), so no migration and no row; the purpose is part of what is
 * signed, so a calendar token can never be read as a logo token or the other way round.
 */

const PURPOSE = "brand-logo";

function getSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET must be set");
  return s;
}

function sign(tenantId: string): string {
  return createHmac("sha256", getSecret()).update(`${PURPOSE}:${tenantId}`).digest("base64url");
}

export function signBrandLogoToken(tenantId: string): string {
  return `${Buffer.from(tenantId, "utf8").toString("base64url")}.${sign(tenantId)}`;
}

/** The workspace a token is for, or null for anything not certainly signed by us. */
export function verifyBrandLogoToken(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    const tenantId = Buffer.from(parts[0], "base64url").toString("utf8");
    if (!tenantId) return null;
    const a = Buffer.from(parts[1], "base64url");
    const b = Buffer.from(sign(tenantId), "base64url");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return tenantId;
  } catch {
    return null;
  }
}
