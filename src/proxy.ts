import { NextResponse } from "next/server";

import NextAuth from "next-auth";

import { authConfig } from "./auth.config";

// Edge-compatible in-memory rate limiter (per-process).
// WARNING: On serverless/multi-instance deployments each invocation runs in a
// fresh process, so this store is reset on every cold start.  For real
// distributed rate-limiting, replace with a Redis / Vercel KV backed counter.
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

const { auth } = NextAuth(authConfig);

export const proxy = auth((req) => {
  const { nextUrl } = req;
  const pathname = nextUrl.pathname;

  const isLoggedIn = !!req.auth?.user;
  const activeTenantId = (req.auth?.user as { activeTenantId?: string | null } | undefined)?.activeTenantId;

  // On Vercel, x-vercel-forwarded-for is set by the infrastructure and cannot be
  // spoofed by clients. Fall back to the rightmost X-Forwarded-For entry (appended
  // by the trusted edge proxy) rather than the leftmost (which is client-supplied).
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
    return;
  }

  const isOnLogin =
    pathname.startsWith("/auth/v1/login") || pathname.startsWith("/auth/v2/login") || pathname.startsWith("/login");

  const isOnPublicAuth =
    pathname.startsWith("/auth/v1/forgot-password") ||
    pathname.startsWith("/auth/v1/reset-password") ||
    pathname.startsWith("/auth/v1/accept-invitation") ||
    pathname.startsWith("/auth/v1/register") ||
    pathname.startsWith("/auth/v2/register");

  if (isOnPublicAuth) return;

  if (isOnLogin) {
    if (isLoggedIn) {
      return Response.redirect(new URL("/select-tenant", nextUrl));
    }
    return;
  }

  // ── Tenant selection page ─────────────────────────────────────────────────────
  if (pathname.startsWith("/select-tenant")) {
    if (!isLoggedIn) {
      return Response.redirect(new URL("/auth/v1/login", nextUrl));
    }
    return;
  }

  // ── CRM dashboard: requires auth + active tenant ──────────────────────────────
  if (pathname.startsWith("/dashboard")) {
    if (!isLoggedIn) {
      return Response.redirect(new URL("/auth/v1/login", nextUrl));
    }

    if (!activeTenantId) {
      return Response.redirect(new URL("/select-tenant", nextUrl));
    }

    // Inject tenant context as an internal header — never trusted from the client
    const res = NextResponse.next();
    res.headers.set("x-tenant-id", activeTenantId);
    return res;
  }

  // ── Root "/" redirect ─────────────────────────────────────────────────────────
  if (pathname === "/") {
    if (!isLoggedIn) return Response.redirect(new URL("/auth/v1/login", nextUrl));
    if (activeTenantId) return Response.redirect(new URL("/dashboard/crm", nextUrl));
    return Response.redirect(new URL("/select-tenant", nextUrl));
  }

  // ── Admin panel ───────────────────────────────────────────────────────────────
  if (pathname.startsWith("/admin")) {
    const res = NextResponse.next();
    res.headers.set("x-pathname", pathname);
    return res;
  }

  // ── Tenant-scoped API routes ──────────────────────────────────────────────────
  // For session-authenticated requests, inject the active tenant from the JWT so
  // getDb() resolves to the correct per-tenant database instead of platformDb.
  // Routes that operate across all tenants (cron, webhooks) or are truly public
  // (geo, currency, public quotes) are intentionally excluded.
  if (pathname.startsWith("/api/") && !isPublicApiPath(pathname)) {
    if (isLoggedIn && activeTenantId) {
      const res = NextResponse.next();
      res.headers.set("x-tenant-id", activeTenantId);
      return res;
    }
    // API-key authenticated requests have no JWT session, so no tenant header is
    // set here.  Those routes must resolve the tenant from request parameters and
    // call createTenantDb() directly rather than relying on getDb().
    return;
  }

  return;
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
