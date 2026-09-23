/**
 * The sign-in page must not publish an account's password.
 *
 * ⚠️⚠️ It did: a "demo credentials" banner printed admin@flux.local / admin, copy
 * buttons and all, on every deployment including production — and the setup script
 * created exactly that account, with exactly that password. Anybody who opened the
 * sign-in page was handed a platform administrator.
 *
 * The banner is a demo affordance and is now rendered only where somebody set
 * DEMO_CREDENTIALS=1. This checks the gate is still there, because the banner is one
 * import away from coming back unconditionally and nothing on screen would say so.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const page = readFileSync("src/app/(main)/auth/v1/login/page.tsx", "utf8").split("\r\n").join("\n");

describe("the sign-in page", () => {
  it("⚠️⚠️ renders the demo credentials only behind an explicit flag", () => {
    const rendered = page.includes("<DemoCredentialsBanner");
    if (!rendered) return; // removed altogether is also an answer
    expect(page).toMatch(/process\.env\.DEMO_CREDENTIALS === "1"\s*&&\s*<DemoCredentialsBanner/);
  });

  it("does not print a password of its own", () => {
    expect(page).not.toMatch(/password\s*[:=]\s*"[^"]+"/i);
  });
});
