/**
 * The address a request came from, as the platform in front of us saw it — for rate limits
 * and for the record a simple electronic signature keeps.
 *
 * ⚠️⚠️ **Only a header the platform sets, and overwrites, is believed.**
 * - On Cloudflare Workers, `cf-connecting-ip`: Cloudflare replaces whatever a client sent.
 * - On Vercel, `x-vercel-forwarded-for`, which Vercel sets the same way. Anywhere else it is
 *   an ordinary header a client can write: trusted there, it let anybody sign a quote "from"
 *   any address and step around every rate limit with a new value per request.
 * - Otherwise the last hop of `x-forwarded-for`, appended by the proxy in front, never the
 *   first, which is whatever the client typed.
 *
 * A pure module: the proxy imports it as well as the routes.
 */
type Env = Record<string, string | undefined>;

function onWorkers(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
}

export function clientIp(headers: Headers, env: Env = process.env, workers = onWorkers()): string {
  if (workers) {
    const cf = headers.get("cf-connecting-ip")?.trim();
    if (cf) return cf;
  }
  if (env.VERCEL) {
    const vercel = headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
    if (vercel) return vercel;
  }
  return headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "unknown";
}
