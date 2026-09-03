/**
 * app-url.ts — the one place that knows the application's public address.
 *
 * Before this module, three different variables were consulted for the same
 * answer: `NEXTAUTH_URL` (campaign sends and transactional email),
 * `NEXT_PUBLIC_APP_URL` (billing and the Cloudflare worker), and a
 * `http://localhost:3000` fallback that quietly caught both when neither was
 * set. Every unsubscribe link, tracking pixel, invitation and public quote link
 * then went out pointing at a developer's machine, and nothing failed loudly
 * enough to notice (audit rilievo B-04).
 *
 * The fallback is deliberately limited to development. In production a missing
 * value throws, because an email that has already been delivered cannot be
 * corrected.
 */

const DEV_FALLBACK = "http://localhost:3000";

/**
 * The origin the hosting platform reports, when it reports one.
 *
 * Vercel injects the deployment host; Cloudflare Workers does not, which is why
 * `NEXT_PUBLIC_APP_URL` belongs in the `vars` block of wrangler.jsonc. Consulted
 * only after the explicit configuration, so a deliberate custom domain always
 * wins over the platform's own hostname.
 */
function platformOrigin(): string | null {
  const host = (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL ?? "").trim();
  return host ? `https://${host.replace(/^https?:\/\//, "").replace(/\/+$/, "")}` : null;
}

function readAppUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? process.env.AUTH_URL ?? "").trim();

  if (raw) return raw.replace(/\/+$/, "");

  const fromPlatform = platformOrigin();
  if (fromPlatform) return fromPlatform;

  if (process.env.NODE_ENV === "production") {
    // Refusing here fails the one operation that was about to send a wrong link,
    // and leaves the rest of the product working. It must never be called at
    // module scope, or that single refusal becomes a build failure.
    throw new Error(
      "NEXT_PUBLIC_APP_URL is not set. Every outbound link (invitations, password " +
        "resets, unsubscribe, click tracking, public quotes) is built from it, so an " +
        "unset value silently ships dead links. Set it to the public origin, e.g. " +
        "https://app.example.com — on Cloudflare, in the `vars` block of wrangler.jsonc " +
        "AND as a build variable, because Next inlines NEXT_PUBLIC_* at build time.",
    );
  }

  return DEV_FALLBACK;
}

/**
 * The public origin, without a trailing slash. Resolved on each call so a test
 * or a script can override the environment before use.
 */
export function getAppUrl(): string {
  return readAppUrl();
}

/** Builds an absolute URL from a path. Accepts paths with or without a leading slash. */
export function appUrl(path = ""): string {
  if (!path) return getAppUrl();
  return `${getAppUrl()}/${path.replace(/^\/+/, "")}`;
}

/**
 * The configured origin, or null when there isn't one — never a guess.
 *
 * For callers that would rather omit a link than send a wrong one. A localhost
 * default in an outgoing webhook or email does not fail: it delivers a real
 * customer a link to a machine that is not theirs, which is the shape nobody
 * goes looking for.
 */
export function getAppUrlOrNull(): string | null {
  const raw = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? process.env.AUTH_URL ?? "").trim();
  if (raw) return raw.replace(/\/+$/, "");
  return platformOrigin();
}
