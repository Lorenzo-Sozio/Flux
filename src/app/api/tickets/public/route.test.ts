/** The rating endpoint: what each outcome answers (src/lib/ticket-public-page.ts decides it). */
import { beforeEach, describe, expect, it, vi } from "vitest";

const submitTicketRating = vi.fn();
vi.mock("@/lib/ticket-public-page", () => ({ submitTicketRating: (b: unknown) => submitTicketRating(b) }));

const { POST } = await import("./route");

const post = (body: string) => POST(new Request("https://crm.example/api/tickets/public", { method: "POST", body }));

beforeEach(() => submitTicketRating.mockReset());

describe("POST /api/tickets/public", () => {
  it("passes the body on and answers 200 when the answer is recorded", async () => {
    submitTicketRating.mockResolvedValue({ ok: true });
    const res = await post(JSON.stringify({ workspace: "acme", token: "t", rating: "good" }));
    expect(res.status).toBe(200);
    expect(submitTicketRating).toHaveBeenCalledWith({ workspace: "acme", token: "t", rating: "good" });
  });

  it("⚠️ says which failure it was, by status", async () => {
    for (const [reason, status] of [
      ["notFound", 404],
      ["notYet", 409],
      ["invalid", 400],
    ] as const) {
      submitTicketRating.mockResolvedValue({ ok: false, reason });
      expect((await post("{}")).status).toBe(status);
    }
  });

  it("refuses a body that is not JSON without reaching the database", async () => {
    expect((await post("not json")).status).toBe(400);
    expect(submitTicketRating).not.toHaveBeenCalled();
  });
});
