/**
 * Extracts the tenant subdomain from a request Host header.
 * Pure function — no imports, safe for Edge runtime and middleware.
 *
 * Three environments handled:
 *   localhost dev  : tenant1.localhost:3000  → "tenant1"
 *   Vercel preview : tenant1---proj.vercel.app → "tenant1"
 *   Production     : tenant1.myapp.com       → "tenant1"
 *
 * Returns null when the host IS the root domain (no subdomain).
 */
export function extractSubdomainFromHost(host: string): string | null {
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000";
  const hostname = host.split(":")[0]; // strip port
  const rootHostname = rootDomain.split(":")[0];

  // Exact match → no subdomain
  if (hostname === rootHostname) return null;

  // Vercel preview: tenant1---project-abc.vercel.app
  if (hostname.endsWith(".vercel.app")) {
    const parts = hostname.split("---");
    return parts.length > 1 ? parts[0] : null;
  }

  // Standard: subdomain.rootDomain (covers .localhost and production)
  if (hostname.endsWith(`.${rootHostname}`)) {
    const sub = hostname.slice(0, hostname.length - rootHostname.length - 1);
    return sub || null;
  }

  return null;
}
