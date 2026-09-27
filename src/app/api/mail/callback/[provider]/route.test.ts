/**
 * The way back from the consent screen (V3.2): nothing is redeemed unless the trip that
 * comes back is the one this person started, in this browser, for this workspace.
 */
import { NextRequest } from "next/server";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { beginOAuth, OAUTH_COOKIE } from "@/lib/mail-oauth";

const env = vi.hoisted(() => {
  process.env.AUTH_SECRET = "callback-test-secret";
  process.env.NEXT_PUBLIC_APP_URL = "https://crm.example";
  return {
    actor: { userId: "anna", tenantRole: "editor", isPlatformStaff: false } as {
      userId: string;
      tenantRole: string;
      isPlatformStaff: boolean;
    } | null,
    tenant: "t1",
  };
});
const saved: unknown[] = [];
const exchanged: unknown[] = [];

vi.mock("@/lib/auth-guard", () => ({ getActor: async () => env.actor }));
vi.mock("@/lib/tenant-context", () => ({ getCurrentTenantId: async () => env.tenant, getDb: async () => ({}) }));
vi.mock("@/lib/mail-connection", () => ({
  saveConnection: async (_db: unknown, input: unknown) => saved.push(input),
  loadConnection: async () => null,
  disconnectMailbox: async () => true,
}));
vi.mock("@/lib/mail-providers/registry", () => ({
  isProviderId: (p: string) => p === "google" || p === "microsoft",
  mayConnect: () => true,
  providerFor: () => ({
    exchangeCode: async (input: unknown) => {
      exchanged.push(input);
      return { accessToken: "at", refreshToken: "rt", expiresAt: new Date(), scopes: [] };
    },
    mailbox: async () => ({ email: "anna@x.it" }),
    startCursor: async () => "c0",
  }),
}));

const { GET } = await import("./route");

function callback(query: Record<string, string>, cookie?: string, provider = "google") {
  const req = new NextRequest(`https://crm.example/api/mail/callback/${provider}?${new URLSearchParams(query)}`, {
    headers: cookie ? { cookie: `${OAUTH_COOKIE}=${cookie}` } : {},
  });
  return GET(req, { params: Promise.resolve({ provider }) });
}
const outcome = (res: Response) => new URL(res.headers.get("location") ?? "").searchParams.get("mail");

beforeEach(() => {
  env.actor = { userId: "anna", tenantRole: "editor", isPlatformStaff: false };
  env.tenant = "t1";
  saved.length = 0;
  exchanged.length = 0;
});

describe("⚠️⚠️ the OAuth callback", () => {
  it("redeems the code with the verifier from the cookie, and saves the mailbox", async () => {
    const trip = beginOAuth({ tenantId: "t1", userId: "anna", provider: "google" });
    const res = await callback({ code: "abc", state: trip.state }, trip.cookie);
    expect(outcome(res)).toBe("connected");
    expect(exchanged[0]).toMatchObject({ code: "abc", redirectUri: "https://crm.example/api/mail/callback/google" });
    expect(saved[0]).toMatchObject({ userId: "anna", provider: "google", email: "anna@x.it", cursor: "c0" });
    // The cookie is spent.
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`${OAUTH_COOKIE}=;.*Max-Age=0`, "i"));
  });

  it("refuses a trip another person started, even with their cookie", async () => {
    const trip = beginOAuth({ tenantId: "t1", userId: "luca", provider: "google" });
    expect(outcome(await callback({ code: "abc", state: trip.state }, trip.cookie))).toBe("error");
    expect(exchanged).toEqual([]);
  });

  it("refuses a trip started in another workspace", async () => {
    const trip = beginOAuth({ tenantId: "t2", userId: "anna", provider: "google" });
    expect(outcome(await callback({ code: "abc", state: trip.state }, trip.cookie))).toBe("error");
    expect(saved).toEqual([]);
  });

  it("refuses the answer without the cookie of the browser that asked", async () => {
    const trip = beginOAuth({ tenantId: "t1", userId: "anna", provider: "google" });
    expect(outcome(await callback({ code: "abc", state: trip.state }))).toBe("error");
    expect(
      outcome(
        await callback(
          { code: "abc", state: trip.state },
          beginOAuth({ tenantId: "t1", userId: "anna", provider: "google" }).cookie,
        ),
      ),
    ).toBe("error");
    expect(exchanged).toEqual([]);
  });

  it("a no at the consent screen connects nothing", async () => {
    expect(outcome(await callback({ error: "access_denied" }))).toBe("denied");
    expect(exchanged).toEqual([]);
  });

  it("⚠️ a read-only member connects nothing: the sync would write on the records in their name", async () => {
    env.actor = { userId: "anna", tenantRole: "viewer", isPlatformStaff: false };
    const trip = beginOAuth({ tenantId: "t1", userId: "anna", provider: "google" });
    expect(outcome(await callback({ code: "abc", state: trip.state }, trip.cookie))).toBe("unavailable");
    expect(exchanged).toEqual([]);
  });

  it("nobody signed in: to the login page, nothing redeemed", async () => {
    env.actor = null;
    const trip = beginOAuth({ tenantId: "t1", userId: "anna", provider: "google" });
    const res = await callback({ code: "abc", state: trip.state }, trip.cookie);
    expect(res.headers.get("location")).toBe("https://crm.example/login");
    expect(exchanged).toEqual([]);
  });
});
