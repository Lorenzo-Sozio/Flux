import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * calendar-feed-token.ts — the credential in a calendar subscription URL.
 *
 * A calendar client cannot log in. Google Calendar, Outlook and Apple Calendar
 * fetch a URL on a schedule, with no session and no way to ask anyone for a
 * password, so the URL itself has to carry the identity. That makes it a
 * credential in a text box, and it is treated as one: the settings page says
 * plainly that anyone holding the link can read that person's appointments.
 *
 * ⚠️ This is a **boundary surface**. The token decides which workspace's
 * database is opened and whose appointments are returned, and every other entry
 * point that answers that question — the import API, the RSVP link, the public
 * quote page — is tested for the same reason: a mistake here does not look like
 * a failure, it looks like a calendar full of somebody else's meetings.
 *
 * Signed rather than stored, on purpose. A stored token needs a column on a
 * table that lives once per customer, so it needs a migration applied to every
 * customer database before the feature can work anywhere — and a row that
 * outlives the person it belongs to. A signature needs neither: what the token
 * claims is checked against a key the server holds, and a token for a workspace
 * that no longer exists opens nothing.
 *
 * The cost of that choice is revocation. There is no per-person revoke: a leaked
 * URL is withdrawn by rotating `CALENDAR_FEED_SECRET`, which invalidates every
 * subscription at once. That is worth saying out loud rather than discovering,
 * and it is why the secret is separate from `AUTH_SECRET` — rotating it must not
 * log everybody out.
 */

function getSecret(): string {
  const s = process.env.CALENDAR_FEED_SECRET ?? process.env.AUTH_SECRET;
  if (!s) throw new Error("CALENDAR_FEED_SECRET or AUTH_SECRET must be set");
  return s;
}

export interface FeedIdentity {
  tenantId: string;
  userId: string;
}

/**
 * The signed part.
 *
 * ⚠️ The two identifiers are joined by a character that cannot occur in either,
 * because they are UUIDs. Joining on something they *could* contain would let
 * one pair be re-read as another — the classic length-extension-by-punctuation
 * mistake, where `a:bc` and `ab:c` sign identically.
 */
function payload(identity: FeedIdentity): string {
  return `${identity.tenantId}:${identity.userId}`;
}

function sign(value: string): string {
  return createHmac("sha256", getSecret()).update(value).digest("base64url");
}

/**
 * The token that goes in a subscription URL.
 *
 * Self-describing: it carries who it is for, so verifying it costs one HMAC and
 * no lookup across every workspace.
 */
export function signCalendarFeedToken(identity: FeedIdentity): string {
  const body = Buffer.from(payload(identity), "utf8").toString("base64url");
  return `${body}.${sign(payload(identity))}`;
}

/**
 * Who a token is for, or nothing.
 *
 * Returns null for anything it is not certain about — malformed, unsigned,
 * signed with a different key, or altered after signing. A caller therefore
 * cannot accidentally treat a bad token as an anonymous one and carry on.
 */
export function verifyCalendarFeedToken(token: string): FeedIdentity | null {
  try {
    // ⚠️ The shape checks below carry no security — the signature does, on its
    // own — and mutation testing says so plainly: break any one of them and the
    // suite stays green, because a malformed token fails the signature anyway.
    // They are kept for strict parsing of attacker-supplied text, the same rule
    // the storage key follows, and deliberately have no mutation of their own: a
    // mutation that changes nothing observable is a test asking for an
    // implementation detail rather than for a behaviour. The one exception is
    // the identity check, which is reachable — a caller can sign an empty id.
    const parts = token.split(".");
    if (parts.length !== 2) return null;

    const [body, signature] = parts;
    if (!body || !signature) return null;

    const decoded = Buffer.from(body, "base64url").toString("utf8");
    const [tenantId, userId, ...rest] = decoded.split(":");
    if (!tenantId || !userId || rest.length > 0) return null;

    const expected = sign(decoded);
    const a = Buffer.from(signature, "base64url");
    const b = Buffer.from(expected, "base64url");
    if (a.length !== b.length) return null;
    if (!timingSafeEqual(a, b)) return null;

    return { tenantId, userId };
  } catch {
    // A token is attacker-supplied text. Anything it makes throw — invalid
    // base64, a payload that is not UTF-8 — is a token that does not verify,
    // not an error worth propagating to a route that would then answer 500.
    return null;
  }
}
