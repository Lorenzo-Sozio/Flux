/**
 * Stands in for the `server-only` package when the tests run.
 *
 * ⚠️ `server-only` has no runtime of its own: it exists so that importing it from
 * a client bundle is a build error, and Next resolves it through its own
 * bundler. Under vitest there is no such resolution, so a module carrying the
 * guard could not be imported by a test at all — which would mean the guard was
 * paid for by leaving the code it protects untested.
 *
 * Aliased in vitest.config.mts. The guard still does its job in the application
 * build, which is the only place it was ever doing one.
 */
export {};
