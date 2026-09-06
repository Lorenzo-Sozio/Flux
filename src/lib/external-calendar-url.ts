/**
 * external-calendar-url.ts — deciding whether an address is safe to fetch.
 *
 * A person pastes the secret iCal address of their own Google, Outlook or Apple
 * calendar and the server goes and fetches it. That is a request the server
 * makes to an address a **user chose**, which is the shape of a server-side
 * request forgery: point it at something only the server can reach and the
 * response — or merely the fact that it answered — comes back.
 *
 * ⚠️ So the address is checked before anything fetches it, and the checking
 * lives here rather than at the call site: a second caller that forgot would be
 * the whole hole, and there is no sign of it at the moment of forgetting.
 *
 * Pure. The DNS question — a public name that resolves to a private address — is
 * deliberately out of scope and named at the bottom, because pretending to solve
 * it here would be worse than saying where the line is.
 */

export type UrlVerdict = { ok: true; url: string } | { ok: false; reason: UrlRefusal };

export type UrlRefusal = "empty" | "not-a-url" | "scheme" | "private-host" | "our-own-feed";

/** Hosts that mean "this machine", in the spellings that reach a URL parser. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0", "[::]"]);

/**
 * Address ranges that are not on the public internet.
 *
 * ⚠️ 169.254.0.0/16 is the one that matters most and looks the most harmless:
 * it is where cloud providers put their instance metadata service, and a
 * successful fetch of it hands over credentials.
 */
function isPrivateIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true; // link-local, and the metadata service
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  return false;
}

/** IPv6 written in a URL arrives inside brackets. */
function isPrivateIPv6(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (!bare.includes(":")) return false;
  return (
    bare === "::1" ||
    bare === "::" ||
    bare.startsWith("fc") ||
    bare.startsWith("fd") || // unique local
    bare.startsWith("fe80") || // link-local
    bare.startsWith("::ffff:") // an IPv4 address wearing an IPv6 coat
  );
}

/**
 * Whether this address may be fetched, and the address to fetch if so.
 *
 * `ourOwnOrigin` is refused because subscribing to our own published feed puts
 * every appointment on the calendar twice — once as itself and once as an
 * external event — and the second copy cannot be edited. Nothing fails; the week
 * simply looks twice as busy as it is.
 */
export function checkExternalCalendarUrl(raw: string, ourOwnOrigin?: string | null): UrlVerdict {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: "empty" };

  // Calendar clients hand out `webcal://`, which is http(s) wearing a hat.
  const normalised = trimmed.replace(/^webcal:\/\//i, "https://");

  let url: URL;
  try {
    url = new URL(normalised);
  } catch {
    return { ok: false, reason: "not-a-url" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "scheme" };

  const host = url.hostname.toLowerCase();
  if (LOOPBACK.has(host) || isPrivateIPv4(host) || isPrivateIPv6(host)) {
    return { ok: false, reason: "private-host" };
  }

  // A bare name with no dot is an internal host on most networks.
  if (!host.includes(".") && !host.startsWith("[")) return { ok: false, reason: "private-host" };

  if (ourOwnOrigin) {
    try {
      if (url.origin === new URL(ourOwnOrigin).origin && url.pathname.startsWith("/api/calendar/")) {
        return { ok: false, reason: "our-own-feed" };
      }
    } catch {
      // A misconfigured origin is not a reason to refuse the user's address.
    }
  }

  return { ok: true, url: url.toString() };
}

/** How many hops a calendar address may take before we stop believing it. */
export const MAX_REDIRECTS = 3;

/**
 * Fetches an address, checking **every hop**, not only the first.
 *
 * ⚠️⚠️ This exists because `redirect: "follow"` throws the check above away.
 * The address a person saved is validated; the address they are *sent to* is
 * not. A server that answers `302 Location: http://169.254.169.254/latest/…`
 * gets its instance metadata fetched and parsed, and every guard in this file
 * was bypassed by one header. Nothing about the first request looks wrong, and
 * nothing in the logs says a second one happened.
 *
 * So redirects are followed by hand and each destination goes back through
 * `checkExternalCalendarUrl`. A hop we would have refused ends the walk, and the
 * caller is told the fetch failed — which is what it did.
 *
 * `request` is injected so this can be tested without a network: the walk, not
 * the fetching, is the part that has to be right.
 */
export async function fetchWithCheckedRedirects(
  startUrl: string,
  request: (url: string) => Promise<Response>,
): Promise<Response | null> {
  let current = startUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await request(current);
    if (response.status < 300 || response.status >= 400) return response;

    const location = response.headers.get("location");
    // A 3xx with nowhere to go is the far end's problem, not a redirect.
    if (!location) return response;

    let next: string;
    try {
      // Relative Locations are ordinary and must resolve against the hop we are
      // on — not against the address originally saved.
      next = new URL(location, current).toString();
    } catch {
      return null;
    }

    // ⚠️ The same check, unweakened. `ourOwnOrigin` is not passed: refusing our
    // own feed is about what a person may subscribe to, and has nothing to say
    // about where a third party is pointing us.
    const verdict = checkExternalCalendarUrl(next, null);
    if (!verdict.ok) return null;
    current = verdict.url;
  }

  // More hops than any real calendar needs is a loop or an attempt.
  return null;
}

/**
 * ⚠️ What this does **not** check: a public hostname whose DNS points at a
 * private address. Closing that needs the resolved address at the moment of
 * connection, which means resolving here and pinning the socket to what was
 * resolved — and neither the Workers runtime nor Next's fetch offers that hook.
 *
 * The exposure that remains is a request from our server to an internal address,
 * with the body handed to whoever set the DNS. It is bounded by the fetch being
 * a plain GET with no credentials, and by the response being parsed as a
 * calendar and discarded. Worth writing down rather than leaving as an absence.
 */
export const KNOWN_LIMIT = "DNS rebinding is not covered: a public name may resolve to a private address.";
