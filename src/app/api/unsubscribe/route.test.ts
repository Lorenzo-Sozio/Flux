/**
 * Unsubscribing (decision of 27 September 2026): opening the link asks, only a POST acts —
 * the page's button, or the mail client's one-click button (RFC 8058).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const probes = vi.hoisted(() => ({ calls: [] as string[] }));
vi.hoisted(() => {
  process.env.AUTH_SECRET = "unsubscribe-test-secret";
});
// Nothing is found: what matters is whether the request tried to act at all.
vi.mock("@/lib/tenant-resolve", () => ({
  resolveTenantByProbe: async (key: string) => {
    probes.calls.push(key);
    return null;
  },
}));

const { GET, POST } = await import("./route");
const { NextRequest } = await import("next/server");
const { generateUnsubscribeToken, unsubscribeUrlFor } = await import("@/lib/unsubscribe-token");
const { listUnsubscribeHeaders } = await import("@/lib/email-provider");

const token = generateUnsubscribeToken("mario@cliente.it", "log-1");
const url = `https://crm.example/api/unsubscribe?token=${encodeURIComponent(token)}`;

beforeEach(() => {
  probes.calls = [];
});

describe("⚠️⚠️ opening the link", () => {
  it("asks, and changes nothing: a mail scanner opens every link", async () => {
    const res = await GET(new NextRequest(url));
    const html = await res.text();
    expect(html).toContain("mario@cliente.it");
    expect(html).toMatch(/<form method="post" action="\/api\/unsubscribe\?token=/);
    expect(probes.calls).toEqual([]);
  });

  it("a forged token is refused before anything", async () => {
    const res = await GET(new NextRequest("https://crm.example/api/unsubscribe?token=forged"));
    expect(await res.text()).toContain("invalid");
    expect(probes.calls).toEqual([]);
  });
});

describe("⚠️⚠️ the button, and the mail client's one click", () => {
  it("a POST with the token in the address acts — as RFC 8058's one-click does", async () => {
    await POST(
      new NextRequest(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
      }),
    );
    expect(probes.calls).toEqual(["campaignLog:log-1"]);
  });

  it("a POST with the token in the form acts too", async () => {
    await POST(
      new NextRequest("https://crm.example/api/unsubscribe", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `token=${encodeURIComponent(token)}`,
      }),
    );
    expect(probes.calls).toEqual(["campaignLog:log-1"]);
  });
});

describe("the headers that give a mail client its button", () => {
  it("both of RFC 8058's, for an https address only", () => {
    expect(listUnsubscribeHeaders("https://crm.example/api/unsubscribe?token=t")).toEqual({
      "List-Unsubscribe": "<https://crm.example/api/unsubscribe?token=t>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    expect(listUnsubscribeHeaders("http://localhost:3000/x")).toEqual({});
    expect(listUnsubscribeHeaders(undefined)).toEqual({});
  });

  it("rebuilt from the queued email: its campaign log, or its sequence enrollment — nothing for the rest", () => {
    const campaign = unsubscribeUrlFor(
      { toEmail: "a@b.it", campaignLogId: "log-1", sequenceEnrollmentId: null },
      "https://crm.example",
      "seq:",
    );
    expect(campaign).toBe(`https://crm.example/api/unsubscribe?token=${generateUnsubscribeToken("a@b.it", "log-1")}`);
    const step = unsubscribeUrlFor(
      { toEmail: "a@b.it", campaignLogId: null, sequenceEnrollmentId: "e1" },
      "https://crm.example",
      "seq:",
    );
    expect(step).toContain(generateUnsubscribeToken("a@b.it", "seq:e1"));
    expect(
      unsubscribeUrlFor({ toEmail: "a@b.it", campaignLogId: null, sequenceEnrollmentId: null }, "https://x", "seq:"),
    ).toBeNull();
  });
});
