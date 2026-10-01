/**
 * The public address of a workspace's logo (src/lib/brand-logo-token.ts, the route at
 * src/app/api/brand/logo/[token]/route.ts). A boundary surface: the token decides which
 * workspace's database is opened, and a mistake reads like an image that loads.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signCalendarFeedToken } from "./calendar-feed-token";

const opened: string[] = [];
let getDbCalled = false;

vi.mock("@/lib/tenant-resolve", () => ({
  openTenantDb: async (tenantId: string) => {
    opened.push(tenantId);
    return tenantId === "gone" ? null : { tenantId };
  },
}));
vi.mock("@/lib/workspace-logo", () => ({
  loadWorkspaceLogo: async (db: { tenantId: string }) =>
    db.tenantId === "nologo"
      ? null
      : { bytes: new TextEncoder().encode(`logo-of-${db.tenantId}`), contentType: "image/png" },
}));
vi.mock("@/lib/tenant-context", () => ({
  getDb: async () => {
    getDbCalled = true;
    throw new Error("no tenant header on a public route");
  },
}));

vi.stubEnv("AUTH_SECRET", "a-secret-long-enough-for-the-tests-0123456789");

const { signBrandLogoToken, verifyBrandLogoToken } = await import("./brand-logo-token");
const { GET } = await import("@/app/api/brand/logo/[token]/route");

const get = (token: string) => GET(new Request("https://crm.example.it/x"), { params: Promise.resolve({ token }) });

beforeEach(() => {
  opened.length = 0;
  getDbCalled = false;
});

describe("⚠️⚠️ the logo token", () => {
  it("names the workspace it was signed for, and only that one", () => {
    expect(verifyBrandLogoToken(signBrandLogoToken("t-acme"))).toBe("t-acme");
  });

  it("refuses a token whose workspace was swapped", () => {
    const [, sig] = signBrandLogoToken("t-acme").split(".");
    const forged = `${Buffer.from("t-other").toString("base64url")}.${sig}`;
    expect(verifyBrandLogoToken(forged)).toBeNull();
  });

  it("refuses an altered signature, a malformed token and an empty one", () => {
    const token = signBrandLogoToken("t-acme");
    expect(verifyBrandLogoToken(`${token.slice(0, -2)}xx`)).toBeNull();
    expect(verifyBrandLogoToken("not-a-token")).toBeNull();
    expect(verifyBrandLogoToken("a.b.c")).toBeNull();
    expect(verifyBrandLogoToken("")).toBeNull();
  });

  it("⚠️ a calendar feed token, signed with the same key, is not a logo token", () => {
    vi.stubEnv("CALENDAR_FEED_SECRET", "a-secret-long-enough-for-the-tests-0123456789");
    const calendar = signCalendarFeedToken({ tenantId: "t-acme", userId: "u1" });
    expect(verifyBrandLogoToken(calendar)).toBeNull();
  });

  it("a different key signs a different token", () => {
    const token = signBrandLogoToken("t-acme");
    vi.stubEnv("AUTH_SECRET", "another-secret-entirely-9876543210-abcdefgh");
    expect(verifyBrandLogoToken(token)).toBeNull();
    vi.stubEnv("AUTH_SECRET", "a-secret-long-enough-for-the-tests-0123456789");
  });
});

describe("⚠️⚠️ the logo route", () => {
  it("serves the logo of the workspace in the token, cacheable, and never asks the request for one", async () => {
    const res = await get(signBrandLogoToken("t-acme"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("logo-of-t-acme");
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("public");
    expect(opened).toEqual(["t-acme"]);
    expect(getDbCalled).toBe(false);
  });

  it("opens no database for a token that does not verify", async () => {
    const res = await get("dC1hY21l.forged");
    expect(res.status).toBe(404);
    expect(opened).toEqual([]);
  });

  it("answers 404 for a workspace that is gone or has no logo, like a bad token", async () => {
    expect((await get(signBrandLogoToken("gone"))).status).toBe(404);
    expect((await get(signBrandLogoToken("nologo"))).status).toBe(404);
  });
});
