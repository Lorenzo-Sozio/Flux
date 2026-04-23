import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */

const securityHeaders = [
  // Prevent browsers from MIME-sniffing a response away from the declared Content-Type
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Block the page from being embedded in an <iframe> (clickjacking protection)
  { key: "X-Frame-Options", value: "DENY" },
  // Force HTTPS for 1 year, including subdomains
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  // Disable Referer header when navigating to a different origin
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Restrict browser features not needed by this app
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  // Basic CSP: allow same-origin resources and trusted CDNs; tighten as needed
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js inline scripts require 'unsafe-inline' — narrow with nonces in production
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig = {
  reactCompiler: true,
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
