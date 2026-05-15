import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import { NextResponse } from "next/server";
import { extractSubdomainFromHost } from "./lib/subdomain";

// Edge-compatible in-memory rate limiter
// Key: IP + path → { count, resetAt }
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function rateLimit(ip: string, path: string, limit: number, windowMs: number): boolean {
  const key = `${ip}:${path}`;
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return true; // allowed
  }

  if (entry.count >= limit) return false; // blocked

  entry.count++;
  return true; // allowed
}

const { auth } = NextAuth(authConfig);

export const proxy = auth((req) => {
  const host = req.headers.get("host") ?? "";
  let subdomain = extractSubdomainFromHost(host);

  // Test-mode override: read __tenant_override cookie when on a Vercel preview URL
  // (wildcard subdomains are unavailable on vercel.app). Requires ENABLE_TENANT_OVERRIDE=true.
  if (!subdomain && process.env.ENABLE_TENANT_OVERRIDE === "true") {
    const override = req.cookies.get("__tenant_override")?.value;
    if (override) subdomain = override;
  }

  const isLoggedIn = !!req.auth?.user;

  // ── Tenant subdomain routing ──────────────────────────────────────────────
  if (subdomain) {
    const { pathname } = req.nextUrl;

    // /admin is only accessible from the main domain
    if (pathname.startsWith("/admin")) {
      const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000";
      const protocol = req.headers.get("x-forwarded-proto") ?? "http";
      return NextResponse.redirect(new URL("/", `${protocol}://${rootDomain}`));
    }

    // API routes handle multi-tenancy via getDb() reading the host header — no rewrite needed.
    if (pathname.startsWith("/api/")) return;

    // Root "/" → tenant landing page (sign-in splash).
    if (pathname === "/" || pathname === "") {
      const url = req.nextUrl.clone();
      url.pathname = `/tenant/${subdomain}`;
      return NextResponse.rewrite(url);
    }

    // Dashboard routes require authentication on the tenant subdomain.
    // Redirect unauthenticated users to the tenant's own login page so that
    // after login they land back on the correct subdomain (not the main domain).
    if (pathname.startsWith("/dashboard")) {
      if (!isLoggedIn) {
        return NextResponse.redirect(new URL("/auth/v1/login", req.url));
      }
    }

    // All other subdomain paths (/auth/*, etc.) pass through.
    // getDb() reads the host header for tenant-scoped DB access.
    return;
  }

  // ── Main domain: rate-limit + auth/RBAC ──────────────────────────────────
  const { nextUrl } = req;
  const pathname = nextUrl.pathname;

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  // Login endpoint: max 10 attempts per minute
  if (pathname === "/api/auth/callback/credentials") {
    if (!rateLimit(ip, "login", 10, 60_000)) {
      return new Response(JSON.stringify({ error: "Too many requests. Please wait." }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "60" },
      });
    }
  }

  // ── Auth route protection ─────────────────────────────────────────────────
  const isOnLogin =
    pathname.startsWith("/login") ||
    pathname.startsWith("/auth/v1/login") ||
    pathname.startsWith("/auth/v2/login");
  const isOnPublicAuth =
    pathname.startsWith("/auth/v1/forgot-password") ||
    pathname.startsWith("/auth/v1/reset-password") ||
    pathname.startsWith("/auth/v1/accept-invitation") ||
    pathname.startsWith("/auth/v1/register") ||
    pathname.startsWith("/auth/v2/register");

  // Public quote preview pages (no auth required)
  if (pathname.startsWith("/q/") || pathname.startsWith("/api/quotes/public")) {
    return;
  }

  if (isOnLogin || isOnPublicAuth) {
    if (isLoggedIn && isOnLogin) {
      // Main domain: send admin users to verify their identity first.
      // The admin layout redirects to /admin/tenants once the session cookie is set.
      return Response.redirect(new URL("/admin/login", nextUrl));
    }
    return;
  }

  // CRM dashboard is tenant-only — redirect main-domain visitors to admin panel.
  if (pathname.startsWith("/dashboard")) {
    if (!isLoggedIn) {
      return Response.redirect(new URL("/auth/v1/login", nextUrl));
    }
    return Response.redirect(new URL("/admin/tenants", nextUrl));
  }

  // Root "/" on main domain: admin panel if logged in, otherwise login.
  if (pathname === "/") {
    return Response.redirect(
      new URL(isLoggedIn ? "/admin/login" : "/auth/v1/login", nextUrl),
    );
  }

  // Inject pathname so admin layouts can detect /admin/login without a separate header package.
  if (pathname.startsWith("/admin")) {
    const res = NextResponse.next();
    res.headers.set("x-pathname", pathname);
    return res;
  }

  return;
});

export default proxy;

export const config = {
  matcher: [
    // Rate-limit the credentials login endpoint even though other api/auth routes are excluded
    "/api/auth/callback/credentials",
    "/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.png$).*)",
  ],
};
