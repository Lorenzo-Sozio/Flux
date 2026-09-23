/**
 * A stand-in for the real `pg-cloudflare`, resolved in its place on purpose.
 *
 * `pg` requires this module by name to open a TCP socket on Cloudflare Workers, and
 * declares it as an **optional** dependency — so it is present on a developer's
 * machine and missing from a clean CI install. The bundler resolves that require at
 * build time whether or not the code path can ever run, so the deploy failed at its
 * last step with `Could not resolve "pg-cloudflare"`, after a Next build that had
 * succeeded, and no install flag fixed it reliably.
 *
 * Flux does not use it: on Workers the database is Neon, reached over HTTP. So this
 * satisfies the resolver and says what it is if anything ever calls it, rather than
 * pretending to be a socket and failing somewhere further away.
 *
 * ⚠️ The day Flux really does talk to a TCP Postgres from a Worker, this has to go and
 * the published package (or Hyperdrive) take its place.
 */
class CloudflareSocket {
  constructor() {
    throw new Error(
      "pg-cloudflare is stubbed in this build: a Worker cannot open a TCP connection to Postgres here. " +
        "Use a Neon connection string, or put Cloudflare Hyperdrive in front of the database.",
    );
  }
}

module.exports = { CloudflareSocket };
