/**
 * db-ssl.ts — how a plain Postgres connection proves it is the right server.
 *
 * Neon is reached over HTTPS with a certificate any public trust store validates, and
 * needs nothing from this file. A Postgres reached over TCP is different: Railway's
 * proxy, like most managed Postgres endpoints, presents a **self-signed certificate
 * issued by the instance's own CA**, and its leaf says `CN=localhost` — a name no
 * client can match.
 *
 * The two usual answers are both bad. Connecting without TLS puts the password and
 * every row on the open internet; `rejectUnauthorized: false` keeps the encryption but
 * accepts *any* certificate, so anyone who can get in the middle can read and rewrite
 * the traffic while the connection still looks secure.
 *
 * ⚠️ So the CA is **pinned** instead: the certificate must chain to the one below, and
 * only the hostname check is relaxed — the part that cannot work by construction. An
 * attacker with their own self-signed certificate fails; the real server passes.
 *
 * `DATABASE_CA_PEM` overrides the pinned certificate, for a different provider or for
 * the day Railway rotates this one (`npm run db:ca` prints the current one).
 */

/**
 * Railway Postgres root CA, fetched from the instance on 23 September 2026.
 * SHA-256 16:9A:AF:B2:AF:66:41:42:F0:61:2A:7B:86:02:68:B4:6D:A1:EC:0F:28:7A:1C:2B:55:4C:17:87:8E:77:20:D9
 */
const RAILWAY_ROOT_CA = `-----BEGIN CERTIFICATE-----
MIIDBTCCAe2gAwIBAgIURitzlmhCLiv3brT3B2YPk6x/y0IwDQYJKoZIhvcNAQEL
BQAwEjEQMA4GA1UEAwwHcm9vdC1jYTAeFw0yNjA5MjMwODIyMDNaFw0yODEyMjEw
ODIyMDNaMBIxEDAOBgNVBAMMB3Jvb3QtY2EwggEiMA0GCSqGSIb3DQEBAQUAA4IB
DwAwggEKAoIBAQCTt5J/rdVGNApt02JhMXMZ3CxjuJw1uckFa29geGTCNVocRkA6
3EkzJxmjevu0ZYvVw5PgyVzv7cbrJ+0EB0eJaxXL1YElcAY2OhwFpwfZl9hLS2nt
YHLqaoLmIaG682Gn2h84d/cp8h4wuWbFOf2eF8AZm/J3u+cRq1SWSGwepurEo+MG
u4chRd1bVTHJHEanYXpgnJ2CjDFqCMHlJ/PfXOhPt+A+KShmA46h+AhKPeKnWkjr
QF5tZukhLHXvyavy8PBtmqIxwJxpwu0XPcaqssspnA6rBq861EGUStwEfr3ldc+8
C/U7FFn1/xdbbizXaTRg8xpkoPaseIRb4v7rAgMBAAGjUzBRMB0GA1UdDgQWBBTl
5Pa0W458c+zh9KQ+GF+sLVfBVDAfBgNVHSMEGDAWgBTl5Pa0W458c+zh9KQ+GF+s
LVfBVDAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQByEaLUO9hm
uInLpLxS/qRSh8CSTPFuRZC0p8WFeveJN6vPezXSCnFMT9CEqE0LJ1uiDErrFqzg
nEXWPXl4/NFfY9L4OuLZMoI3pDU5CoVQ8aVwqQlEbBQc8FvT0Y15OPNZuNeLaN9F
tRJ3JLEiw5TBbfrlbyJQqOJxyB/1azdOgriMG8aasb3rsCgA54OPojBLHqH1t15K
lZOqgR8iXm6J/acGym/OIBOAqeV06TlW7uhFnvdluS8HHeuxe4fZhwlHQ03Bc32b
5v9Ci0TkqFGVmKS6yNgsq4WWafdU9kOYxtdShG2rx82f6kA8N7mNKq6zUopGq+9H
99U0dW83n4JV
-----END CERTIFICATE-----
`;

/** True for a connection string Neon's HTTP driver can serve. */
export function isNeonUrl(url: string): boolean {
  // Whole labels, anchored at the end: `neon.tech.example.com` is somebody else's
  // domain, and treating it as Neon would send the credentials to an HTTP endpoint
  // of their choosing.
  const host = hostOf(url);
  return host === "neon.tech" || host.endsWith(".neon.tech");
}

/** The host, without the port and without the credentials before it. */
function hostOf(url: string): string {
  // Not `new URL()`: a Postgres password may carry characters that make the URL
  // parser throw, and a connection string that cannot be read is not a reason to
  // fall back to an unverified connection.
  const match = /^[a-z+]+:\/\/(?:[^@/]*@)?([^/?#]+)/i.exec(url.trim());
  const authority = match?.[1]?.toLowerCase() ?? "";
  // [::1]:5432 → ::1 ; host:5432 → host
  const bracketed = /^\[([^\]]+)\]/.exec(authority);
  if (bracketed) return bracketed[1];
  return authority.split(":")[0];
}

/**
 * ⚠️⚠️ **Whole names only.** `host.startsWith("localhost")` also accepts
 * `localhost.example.com`, which is a name anybody can register and point anywhere:
 * the connection would then be made to a stranger's server, over the open internet,
 * **with TLS switched off entirely** — because "this is local" is what turns it off.
 * A prefix test is the whole vulnerability; the comparison has to be for the name
 * itself, or for a label under `.localhost`, which is reserved and never resolves off
 * the machine.
 */
function isLoopback(host: string): boolean {
  return host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "::1";
}

export interface DbSslOptions {
  ca: string;
  rejectUnauthorized: true;
  checkServerIdentity: () => undefined;
}

/**
 * The TLS options for a TCP Postgres connection, or `undefined` when the caller
 * should use the driver's default (a locally hosted database in development, where
 * there is no certificate to pin and nothing crosses a network).
 */
export function sslFor(url: string): DbSslOptions | undefined {
  const host = hostOf(url);
  // An unreadable connection string is not a local one: it keeps the pinned CA.
  if (host && isLoopback(host)) return undefined;

  const ca = process.env.DATABASE_CA_PEM?.trim() || RAILWAY_ROOT_CA;
  return {
    ca,
    rejectUnauthorized: true,
    // The leaf certificate is issued for `localhost`, so there is no name to check.
    // Pinning the issuer above is what makes this connection authenticated.
    checkServerIdentity: () => undefined,
  };
}
