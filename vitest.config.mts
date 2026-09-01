import { defineConfig } from "vitest/config";

/**
 * The first tests in this project, and they are deliberately narrow.
 *
 * They cover the **boundary surface**: who a machine-to-machine caller is, which tenant it
 * may write into, and what the import API accepts. That is where a regression stops being
 * an interface bug and becomes one customer's data written into another customer's
 * database — and it would not look like a failure, it would look like a successful 201.
 *
 * They are unit tests with mocked modules on purpose. A test that needs Postgres, a live
 * Next server and a seeded tenant is a test that gets skipped on the day it matters; these
 * run in under a second with `npm test`, so they can run before every commit.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // No global test APIs: an explicit `import { describe, it, expect } from "vitest"`
    // keeps a test file readable on its own, which matters more here than brevity.
    globals: false,
  },
  // Native since Vite 7 — resolves the `@/*` alias from tsconfig.json, so the tests import
  // exactly what the application imports. No plugin needed.
  resolve: { tsconfigPaths: true },
});
