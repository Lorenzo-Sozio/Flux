import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */

// NOTE: Content-Security-Policy is intentionally absent here.
// It is generated per-request in src/proxy.ts (middleware) with a unique
// cryptographic nonce so that 'unsafe-inline' can be removed from script-src.
// Any CSP set here would use a static value and lack nonce support.
const securityHeaders = [
  // Prevent browsers from MIME-sniffing a response away from the declared Content-Type
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Block the page from being embedded in an <iframe> (clickjacking protection)
  { key: "X-Frame-Options", value: "DENY" },
  // Force HTTPS for 2 years, include subdomains, and opt into HSTS preload list.
  // Before adding 'preload', ensure all subdomains serve HTTPS: https://hstspreload.org
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Disable Referer header when navigating to a different origin
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Restrict browser features not needed by this app
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  // Prevents Flash / PDF plugins from loading cross-domain content
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
];

const nextConfig = {
  serverExternalPackages: ["drizzle-kit"],
  // Include tenant migration SQL files in the production bundle so migrate() can read them at runtime.
  // pg-cloudflare: Next traces it under Node's conditions, which resolve to dist/empty.js only;
  // the Worker bundle resolves it under "workerd" to dist/index.js / esm/index.mjs, which the
  // trace never copied into .open-next — "Could not resolve pg-cloudflare" at deploy.
  outputFileTracingIncludes: {
    "/**": ["./src/db/migrations-tenant/**/*", "./node_modules/pg-cloudflare/**/*"],
  },
  reactCompiler: true,
  experimental: {
    // ⚠️ A page visited in the last 30 seconds is shown again from the client cache instead of
    // waiting for the server — list → record → list, a section and back. Every save still
    // invalidates it (revalidatePath), so what the person changed is never shown stale; a
    // colleague's change can be at most this old. Prefetched loading skeletons are reused for the
    // static period (5 minutes by default).
    staleTimes: { dynamic: 30 },
  },
  compiler: {
    removeConsole: process.env.NODE_ENV === "production",
  },
  async headers() {
    return [
      {
        // Apply security headers to all routes
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/dashboard",
        destination: "/dashboard/default",
        permanent: false,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
