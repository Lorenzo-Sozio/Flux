/**
 * A rule's webhook reaches only addresses a settings webhook could.
 *
 * ⚠️⚠️ Settings webhooks were validated against private ranges, loopback and the cloud
 * metadata address; a rule's was not — and its address is a template, so a `{{…}}` could
 * put any host in it. Anybody who could write a rule could make the platform call its own
 * internals. Redirects are not followed either: they lead somewhere nobody validated.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { sendWebhook } from "./webhook-service";

const calls: { url: string; init: RequestInit }[] = [];

afterEach(() => {
  calls.length = 0;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function stubFetch() {
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { ok: true, status: 200, statusText: "OK", json: async () => ({}), text: async () => "" } as Response;
  });
}

const base = { method: "POST" as const, retryCount: 0, timeoutMs: 1000 };

describe("⚠️⚠️ sendWebhook", () => {
  it("refuses the cloud metadata address and loopback without calling them", async () => {
    vi.stubEnv("NODE_ENV", "production");
    stubFetch();
    for (const url of ["http://169.254.169.254/latest/meta-data", "https://127.0.0.1/admin", "https://localhost/x"]) {
      const r = await sendWebhook({ ...base, url }, {});
      expect(r.success).toBe(false);
    }
    expect(calls).toEqual([]);
  });

  it("checks the address after the merge, so a field cannot smuggle a host in", async () => {
    stubFetch();
    const r = await sendWebhook({ ...base, url: "https://{{lead.website}}/hook" }, { lead: { website: "10.0.0.5" } });
    expect(r.success).toBe(false);
    expect(calls).toEqual([]);
  });

  it("calls a public HTTPS address, and does not follow redirects", async () => {
    stubFetch();
    const r = await sendWebhook({ ...base, url: "https://hooks.example.com/in" }, {});
    expect(r.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].init.redirect).toBe("manual");
  });
});
