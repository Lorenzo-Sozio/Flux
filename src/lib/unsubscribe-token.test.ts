/**
 * The unsubscribe link in every marketing email.
 *
 * ⚠️⚠️ A marketing email without a working way out is unlawful, and the failure
 * before this test existed was worse than a broken link: the link could not be
 * generated at all, because it read a secret no environment sets.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { generateUnsubscribeToken, verifyUnsubscribeToken } from "./unsubscribe-token";

const NAMES = ["TRACKING_SECRET", "AUTH_SECRET", "NEXTAUTH_SECRET"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(NAMES.map((n) => [n, process.env[n]]));
  for (const n of NAMES) delete process.env[n];
});
afterEach(() => {
  for (const n of NAMES) {
    if (saved[n] === undefined) delete process.env[n];
    else process.env[n] = saved[n];
  }
});

describe("the unsubscribe link", () => {
  it("⚠️⚠️ can be generated with only AUTH_SECRET, which is what every environment sets", () => {
    process.env.AUTH_SECRET = "auth-secret-for-tests";
    const token = generateUnsubscribeToken("anna@example.com", "log-1");
    expect(verifyUnsubscribeToken(token)).toEqual({ email: "anna@example.com", logId: "log-1" });
  });

  it("uses TRACKING_SECRET when set, like the tracking links beside it", () => {
    process.env.AUTH_SECRET = "auth";
    process.env.TRACKING_SECRET = "tracking";
    const token = generateUnsubscribeToken("anna@example.com", "log-1");
    delete process.env.TRACKING_SECRET;
    expect(verifyUnsubscribeToken(token), "was not signed with TRACKING_SECRET").toBeNull();
  });

  it("⚠️⚠️ refuses a token whose address was changed", () => {
    process.env.AUTH_SECRET = "auth";
    const token = generateUnsubscribeToken("anna@example.com", "log-1");
    const payload = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    payload.e = "bruno@example.com";
    const forged = Buffer.from(JSON.stringify(payload)).toString("base64url");
    expect(verifyUnsubscribeToken(forged)).toBeNull();
  });

  it("says which secret is missing when none is set", () => {
    expect(() => generateUnsubscribeToken("a@b.c", "l")).toThrow(/AUTH_SECRET/);
  });
});
