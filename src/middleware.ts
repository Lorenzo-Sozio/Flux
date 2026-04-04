import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

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

export default auth((req) => {
  const { nextUrl, auth: session } = req;
  const pathname = nextUrl.pathname;

  // ── Rate limiting on sensitive endpoints ──────────────────────────────────
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
  const isLoggedIn = !!session?.user;
  const isOnLogin = pathname.startsWith("/login") || pathname.startsWith("/auth/v1/login") || pathname.startsWith("/auth/v2/login");
  const isOnPublicAuth = pathname.startsWith("/auth/v1/forgot-password") ||
    pathname.startsWith("/auth/v1/reset-password") ||
    pathname.startsWith("/auth/v1/accept-invitation") ||
    pathname.startsWith("/auth/v1/register") ||
    pathname.startsWith("/auth/v2/register");

  if (isOnLogin || isOnPublicAuth) {
    if (isLoggedIn && isOnLogin) {
      return Response.redirect(new URL("/dashboard/crm", nextUrl));
    }
    return; // allow public auth pages
  }

  // Require login for dashboard
  if (pathname.startsWith("/dashboard") || pathname === "/") {
    if (!isLoggedIn) {
      return Response.redirect(new URL("/auth/v1/login", nextUrl));
    }

    // ── Role-based access control ───────────────────────────────────────────
    const role = (session?.user as any)?.role ?? "viewer";

    // Users and Roles management → admin/owner only
    if (
      pathname.startsWith("/dashboard/users") ||
      pathname.startsWith("/dashboard/roles")
    ) {
      if (!["admin", "owner"].includes(role)) {
        return Response.redirect(new URL("/unauthorized", nextUrl));
      }
    }

    // Settings (custom fields, SMTP, webhooks) → admin/owner
    if (pathname.startsWith("/dashboard/settings")) {
      if (!["admin", "owner"].includes(role)) {
        return Response.redirect(new URL("/unauthorized", nextUrl));
      }
    }
  }

  return; // allow
});

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.png$).*)"],
};
