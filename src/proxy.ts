import { NextResponse } from "next/server";

import NextAuth from "next-auth";

import { authConfig } from "./auth.config";

// ─── CSP builder ─────────────────────────────────────────────────────────────

/**
 * Builds a per-request Content-Security-Policy string using a cryptographic
 * nonce. 'unsafe-inline' is intentionally absent from script-src; all
 * controlled inline scripts (ThemeBootScript, etc.) must carry the nonce.
 * 'strict-dynamic' allows Next.js to load its own chunks without explicit listing.
 */
function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV !== "production";

  return [
    "default-src 'self'",
    // 'strict-dynamic' lets nonce-bearing scripts load further scripts (Next.js chunks).
    // 'unsafe-eval' is added only in development where webpack hot reload needs it.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // CSS cannot execute code; unsafe-inline is acceptable here.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

// ─── Edge-compatible in-process rate limiter ──────────────────────────────────
//
// WARNING: This store is per-process and resets on cold starts.
// On multi-instance / serverless deployments it provides per-replica protection
// only. For strict distributed enforcement, replace with Vercel KV or Upstash
// Redis. Deeper server-action-level rate limiting (OTP, imports) uses the
// platform Postgres DB and is not affected by this limitation.

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function rateLimit(ip: string, path: string, limit: number, windowMs: number): boolean {
  const key = `${ip}:${path}`;
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= limit) return false;

  entry.count++;
  return true;
}

// ─── Middleware ───────────────────────────────────────────────────────────────

const { auth } = NextAuth(authConfig);

export const proxy = auth((req) => {
  const { nextUrl } = req;
  const pathname = nextUrl.pathname;

  const isLoggedIn = !!req.auth?.user;
  const activeTenantId = (req.auth?.user as { activeTenantId?: string | null } | undefined)?.activeTenantId;

  // Generate a per-request cryptographic nonce for the Content-Security-Policy.
  // Using randomUUID() — available in both Edge and Node.js runtimes.
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);

  /**
   * Creates a NextResponse.next() that:
   *  1. Injects request headers readable by server components via headers().
   *  2. Sets the Content-Security-Policy response header for browser enforcement.
   *
   * extraRequestHeaders: additional k/v pairs to set on the forwarded request.
   */
  function passThrough(extraRequestHeaders: Record<string, string> = {}): NextResponse {
    const requestHeaders = new Headers(req.headers);

    // ⚠️⚠️ **Anything a client sent under these names is removed before we add our
    // own.** These headers are how the application decides which customer's
    // database it is talking to and which nonce a script may carry; a request
    // arriving with them set is either confused or hostile.
    //
    // The authenticated path always overwrites `x-tenant-id`, so it was safe.
    // The public paths — cron, webhooks, tracking, unsubscribe, the public quote,
    // RSVP — pass through without setting it, and there a forged value used to
    // survive into the request. Nothing on those paths reads it today, because
    // they resolve the tenant from the data instead, but that is a property of
    // every route that exists rather than a rule the next one has to obey.
    // Stripping here makes it the rule.
    for (const header of ["x-tenant-id", "x-nonce", "x-pathname"]) {
      requestHeaders.delete(header);
    }

    requestHeaders.set("x-nonce", nonce);
    for (const [k, v] of Object.entries(extraRequestHeaders)) {
      requestHeaders.set(k, v);
    }
    const res = NextResponse.next({ request: { headers: requestHeaders } });
    res.headers.set("Content-Security-Policy", csp);
    return res;
  }

  // On Vercel, x-vercel-forwarded-for is infrastructure-set and cannot be
  // spoofed by clients. Fall back to the rightmost X-Forwarded-For entry
  // (appended by the trusted edge proxy) rather than the leftmost (client-supplied).
  const ip =
    req.headers.get("x-vercel-forwarded-for") ??
    req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ??
    "unknown";

  // ── Rate-limit credentials login ─────────────────────────────────────────────
  if (pathname === "/api/auth/callback/credentials") {
    if (!rateLimit(ip, "login", 10, 60_000)) {
      return new Response(JSON.stringify({ error: "Too many requests. Please wait." }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "60" },
      });
    }
  }

  // ── Rate-limit admin login ────────────────────────────────────────────────────
  // Server action POSTs to /admin/login carry a Next-Action header; rate-limit them
  // separately from GETs so the login page itself remains accessible.
  if (pathname === "/admin/login" && req.method === "POST") {
    if (!rateLimit(ip, "admin-login", 5, 60_000)) {
      return new Response(JSON.stringify({ error: "Too many requests. Please wait." }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "60" },
      });
    }
  }

  // ── Public routes ─────────────────────────────────────────────────────────────
  // Quote preview pages accessible without auth
  if (pathname.startsWith("/q/") || pathname.startsWith("/api/quotes/public")) {
    return passThrough();
  }

  // `/login` still redirects here, so old links and bookmarks keep working.
  const isOnLogin = pathname.startsWith("/auth/v1/login") || pathname.startsWith("/login");

  const isOnPublicAuth =
    pathname.startsWith("/auth/v1/forgot-password") ||
    pathname.startsWith("/auth/v1/reset-password") ||
    pathname.startsWith("/auth/v1/accept-invitation") ||
    pathname.startsWith("/auth/v1/register");

  if (isOnPublicAuth) return passThrough();

  if (isOnLogin) {
    if (isLoggedIn) {
      return Response.redirect(new URL("/select-tenant", nextUrl));
    }
    return passThrough();
  }

  // ── Tenant selection page ─────────────────────────────────────────────────────
  if (pathname.startsWith("/select-tenant")) {
    if (!isLoggedIn) {
      return Response.redirect(new URL("/auth/v1/login", nextUrl));
    }
    return passThrough();
  }

  // ── CRM dashboard: requires auth + active tenant ──────────────────────────────
  if (pathname.startsWith("/dashboard")) {
    if (!isLoggedIn) {
      return Response.redirect(new URL("/auth/v1/login", nextUrl));
    }

    if (!activeTenantId) {
      return Response.redirect(new URL("/select-tenant", nextUrl));
    }

    // Inject tenant context as an internal request header — never trusted from the client.
    return passThrough({ "x-tenant-id": activeTenantId });
  }

  // ── Root "/" redirect ─────────────────────────────────────────────────────────
  if (pathname === "/") {
    if (!isLoggedIn) return Response.redirect(new URL("/auth/v1/login", nextUrl));
    if (activeTenantId) return Response.redirect(new URL("/dashboard/crm", nextUrl));
    return Response.redirect(new URL("/select-tenant", nextUrl));
  }

  // ── Admin panel ───────────────────────────────────────────────────────────────
  if (pathname.startsWith("/admin")) {
    return passThrough({ "x-pathname": pathname });
  }

  // ── Tenant-scoped API routes ──────────────────────────────────────────────────
  // For session-authenticated requests, inject the active tenant from the JWT so
  // getDb() resolves to the correct per-tenant database instead of platformDb.
  // Routes that operate across all tenants (cron, webhooks) or are truly public
  // (geo, currency, public quotes) are intentionally excluded.
  if (pathname.startsWith("/api/") && !isPublicApiPath(pathname)) {
    if (isLoggedIn && activeTenantId) {
      return passThrough({ "x-tenant-id": activeTenantId });
    }
    // API-key authenticated requests have no JWT session, so no tenant header is
    // set here.  Those routes must resolve the tenant from request parameters and
    // call createTenantDb() directly rather than relying on getDb().
    return passThrough();
  }

  return passThrough();
});

/**
 * API routes that must NOT receive the x-tenant-id injection:
 * - /api/auth/*      NextAuth callbacks — handled by NextAuth itself
 * - /api/cron/*      Cron jobs iterate all tenants via platformDb (by design)
 * - /api/webhooks/*  Stripe / Resend webhooks identify the tenant from payload
 * - /api/track/*     Email open/click tracking — no user session
 * - /api/unsubscribe Email unsubscribe — no user session
 * - /api/geo/*       Static reference data, no tenant concept
 * - /api/currency/*  Exchange rate cache, no tenant concept
 * - /api/quotes/public  Public quote preview, no auth required
 * - /api/appointments/rsvp  External RSVP link — no session
 */
function isPublicApiPath(pathname: string): boolean {
  const PUBLIC_PREFIXES = [
    "/api/auth/",
    "/api/cron/",
    "/api/webhooks/",
    "/api/track/",
    "/api/unsubscribe",
    "/api/geo/",
    "/api/currency/",
    "/api/quotes/public",
    "/api/appointments/rsvp",
  ];
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

export default proxy;

export const config = {
  matcher: [
    // Rate-limit the credentials login endpoint
    "/api/auth/callback/credentials",
    // Exclude static assets, images, and the public Postman collection
    "/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.png$|admin/api-docs/postman-collection\\.json).*)",
  ],
};
