/**
 * The public booking form's endpoint: what it refuses before anything is written, and how
 * it answers.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: unknown[][] = [];
let answer: unknown = { ok: true, startAt: new Date("2026-09-29T07:00:00Z"), endAt: new Date("2026-09-29T08:00:00Z") };

vi.mock("@/lib/booking-public", () => ({
  submitBooking: async (...args: unknown[]) => {
    calls.push(args);
    return answer;
  },
}));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));

const { POST } = await import("./route");

function post(body: Record<string, unknown>) {
  return POST(
    new Request("http://x/api/booking", { method: "POST", body: JSON.stringify(body) }) as never,
  ) as Promise<Response>;
}

const valid = {
  workspace: "acme",
  token: "abcdefghijklmnopqrst",
  start: "2026-09-29T07:00:00.000Z",
  name: "Mario Rossi",
  email: "Mario@Example.com",
};

beforeEach(() => {
  calls.length = 0;
  answer = { ok: true, startAt: new Date("2026-09-29T07:00:00Z"), endAt: new Date("2026-09-29T08:00:00Z") };
});

describe("⚠️ the public booking endpoint", () => {
  it("books, with the address lowered and the default title in the reader's language", async () => {
    const res = await post(valid);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, startAt: "2026-09-29T07:00:00.000Z" });
    expect(calls[0][0]).toBe("acme");
    expect(calls[0][3]).toMatchObject({ name: "Mario Rossi", email: "mario@example.com" });
    expect(calls[0][4]).toBe("defaultTitle");
  });

  it("⚠️⚠️ a filled honeypot is answered as a success, and nothing is booked", async () => {
    const res = await post({ ...valid, website: "http://spam.example" });
    expect(await res.json()).toEqual({ ok: true });
    expect(calls).toEqual([]);
  });

  it("refuses what is not a name, an address or a time before trying anything", async () => {
    for (const body of [
      { ...valid, email: "not-an-address" },
      { ...valid, name: "  " },
      { ...valid, start: "tomorrow" },
    ]) {
      expect((await post(body)).status).toBe(422);
    }
    expect(calls).toEqual([]);
  });

  it("a slot taken meanwhile is a conflict, a closed page is not found", async () => {
    answer = { ok: false, reason: "taken" };
    expect((await post(valid)).status).toBe(409);
    answer = { ok: false, reason: "notFound" };
    expect((await post(valid)).status).toBe(404);
  });
});
