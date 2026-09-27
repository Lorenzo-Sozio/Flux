/**
 * The public forms' endpoint: open to any origin, answered the way a script and a plain
 * HTML form can both use, and never an open redirect.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: unknown[][] = [];
let answer: unknown = { ok: true, kind: "lead" };

vi.mock("@/lib/web-forms-public", () => ({
  submitWebForm: async (...args: unknown[]) => {
    calls.push(args);
    return answer;
  },
}));

const { OPTIONS, POST } = await import("./route");

function post(body: Record<string, unknown>, type = "application/json") {
  const payload = type === "application/json" ? JSON.stringify(body) : new URLSearchParams(body as never).toString();
  return POST(
    new Request("http://x/api/forms", { method: "POST", body: payload, headers: { "content-type": type } }) as never,
  ) as Promise<Response>;
}

const valid = { workspace: "Acme", token: "q7m2x9k4b8n6t5r2wzv3", name: "Mario", email: "m@example.com" };

beforeEach(() => {
  calls.length = 0;
  answer = { ok: true, kind: "lead" };
});

describe("⚠️ the public forms endpoint", () => {
  it("answers any origin, preflight included", async () => {
    expect(OPTIONS().headers.get("access-control-allow-origin")).toBe("*");
    expect((await post(valid)).headers.get("access-control-allow-origin")).toBe("*");
    expect(calls[0][0]).toBe("acme");
  });

  it("⚠️⚠️ a filled honeypot is a success that files nothing", async () => {
    expect(await (await post({ ...valid, website: "spam" })).json()).toEqual({ ok: true });
    expect(calls).toEqual([]);
  });

  it("a plain HTML form is redirected where it asked on success — only to http(s)", async () => {
    const ok = await post(
      { ...valid, redirect: "https://www.example.com/grazie" },
      "application/x-www-form-urlencoded",
    );
    expect(ok.status).toBe(303);
    expect(ok.headers.get("location")).toBe("https://www.example.com/grazie");
    const bad = await post({ ...valid, redirect: "javascript:alert(1)" }, "application/x-www-form-urlencoded");
    expect(bad.status).toBe(200);
  });

  it("⚠️ never redirects a failure: that would be a phishing hop with our name on it", async () => {
    answer = { ok: false, reason: "invalid" };
    const res = await post({ ...valid, redirect: "https://evil.example" });
    expect(res.status).toBe(422);
    expect(res.headers.get("location")).toBeNull();
  });

  it("says why: a closed form, a failed check, a missing field", async () => {
    answer = { ok: false, reason: "notFound" };
    expect((await post(valid)).status).toBe(404);
    answer = { ok: false, reason: "captcha" };
    expect((await post(valid)).status).toBe(403);
    expect((await post({ name: "x" })).status).toBe(422);
  });
});
