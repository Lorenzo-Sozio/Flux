/**
 * What the error boundary decides, from the one thing that reaches it.
 *
 * Two of the four verdicts are expensive to get wrong. `stale` **reloads the page**,
 * so matching too much hides a real refusal behind a flicker; matching too little
 * tells somebody "something went wrong" about a tab that a reload would fix — which
 * happened twice in one week, and reads as the product being broken.
 */
import { describe, expect, it } from "vitest";

import { classifyError, shouldReloadForStaleBuild } from "./error-kind";

describe("a tab left on an older build", () => {
  for (const message of [
    // Turbopack, in development and in a deployed app's console.
    "Module [project]/src/actions/data:6abd25 was instantiated because it was required from module X, but the module factory is not available.",
    // webpack, which is what a production build throws.
    "ChunkLoadError: Loading chunk 402 failed. (missing: https://flux.example/_next/static/chunks/402.js)",
    "Loading chunk app/layout failed",
    // Safari and Firefox, for a dynamic import of a file that is gone.
    "Failed to fetch dynamically imported module: https://flux.example/_next/static/chunks/page.js",
    "Importing a module script failed.",
  ]) {
    it(`⚠️ is recognised: ${message.slice(0, 46)}…`, () => {
      expect(classifyError(message)).toBe("stale");
    });
  }
});

describe("everything else keeps its own answer", () => {
  it("⚠️⚠️ a refusal is a refusal, not a page to reload", () => {
    expect(classifyError("You do not have permission to do that.")).toBe("forbidden");
    expect(classifyError("This workspace is read-only for your role.")).toBe("forbidden");
  });

  it("a plan limit sends the reader to the plans", () => {
    expect(classifyError("Your plan does not include the marketing module.")).toBe("entitlement");
    expect(classifyError("You have reached the record limit of your subscription.")).toBe("entitlement");
  });

  it("⚠️⚠️ anything unrecognised stays unknown, and is shown rather than reloaded away", () => {
    for (const message of [
      "Failed query: select * from deal",
      "Cannot read properties of undefined (reading 'map')",
      "",
    ]) {
      expect(classifyError(message), message).toBe("unknown");
    }
  });
});

describe("reloading a tab that is on an older build", () => {
  const store = (initial: Record<string, string> = {}) => {
    const values = { ...initial };
    return {
      getItem: (k: string) => values[k] ?? null,
      setItem: (k: string, v: string) => {
        values[k] = v;
      },
    };
  };

  it("reloads the first time", () => {
    expect(shouldReloadForStaleBuild(store(), 1_000_000)).toBe(true);
  });

  it("⚠️⚠️ does not reload again straight away, so a reload that does not fix it cannot loop", () => {
    const s = store();
    const now = 1_000_000;
    expect(shouldReloadForStaleBuild(s, now)).toBe(true);
    expect(shouldReloadForStaleBuild(s, now + 1_000)).toBe(false);
    expect(shouldReloadForStaleBuild(s, now + 60_000)).toBe(false);
  });

  it("reloads again for the next deploy, hours later", () => {
    const s = store();
    expect(shouldReloadForStaleBuild(s, 1_000_000)).toBe(true);
    expect(shouldReloadForStaleBuild(s, 1_000_000 + 6 * 60_000)).toBe(true);
  });

  it("⚠️ never reloads where it cannot remember having done so", () => {
    expect(shouldReloadForStaleBuild(undefined, 1_000_000)).toBe(false);
    const throwing = {
      getItem: () => {
        throw new Error("storage disabled");
      },
      setItem: () => undefined,
    };
    expect(shouldReloadForStaleBuild(throwing, 1_000_000)).toBe(false);
  });
});
