/**
 * Which address a request came from (src/lib/client-ip.ts) and how much of a webhook
 * receiver's answer is kept (src/lib/webhook-response.ts): two things a caller controls,
 * and must not control more than it should.
 */
import { describe, expect, it } from "vitest";

import { clientIp } from "./client-ip";
import { readWebhookResponse } from "./webhook-response";

const h = (o: Record<string, string>) => new Headers(o);

describe("⚠️⚠️ the address a request came from", () => {
  it("on Workers, the one Cloudflare sets — never a header the client wrote", () => {
    const forged = h({
      "cf-connecting-ip": "203.0.113.9",
      "x-vercel-forwarded-for": "10.0.0.1",
      "x-forwarded-for": "10.0.0.2",
    });
    expect(clientIp(forged, {}, true)).toBe("203.0.113.9");
  });

  it("x-vercel-forwarded-for is believed on Vercel only", () => {
    const req = h({ "x-vercel-forwarded-for": "198.51.100.7", "x-forwarded-for": "1.1.1.1, 203.0.113.9" });
    expect(clientIp(req, { VERCEL: "1" }, false)).toBe("198.51.100.7");
    // Anywhere else it is an ordinary header: the last hop of x-forwarded-for instead.
    expect(clientIp(req, {}, false)).toBe("203.0.113.9");
  });

  it("⚠️ a cf-connecting-ip sent to a server not behind Cloudflare is not believed either", () => {
    expect(clientIp(h({ "cf-connecting-ip": "10.0.0.1", "x-forwarded-for": "203.0.113.9" }), {}, false)).toBe(
      "203.0.113.9",
    );
  });

  it("nothing to go on is 'unknown', not an empty bucket", () => {
    expect(clientIp(h({}), {}, false)).toBe("unknown");
  });
});

describe("⚠️ a webhook receiver's answer", () => {
  it("⚠️ is read no further than it keeps: a receiver that never stops is not read to the end", async () => {
    let pulls = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(new TextEncoder().encode("x".repeat(1024)));
      },
    });
    await readWebhookResponse(new Response(endless), 4096);
    expect(pulls).toBeLessThan(20);
  });

  it("is kept to its first few kilobytes, however much it sends", async () => {
    const huge = new Response("x".repeat(1_000_000));
    const kept = await readWebhookResponse(huge, 4096);
    expect(kept.length).toBeLessThanOrEqual(4097);
    expect(kept.endsWith("…")).toBe(true);
  });

  it("a short answer is kept whole, and no body is nothing", async () => {
    expect(await readWebhookResponse(new Response("ok"))).toBe("ok");
    expect(await readWebhookResponse(new Response(null, { status: 204 }))).toBe("");
  });
});
