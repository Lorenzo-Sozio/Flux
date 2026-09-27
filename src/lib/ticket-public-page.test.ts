/** Who hears about a customer's answer, and how often (src/lib/ticket-public-page.ts). */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const notified: { userId: string; type: string }[] = [];
vi.mock("@/lib/notify", () => ({
  notify: async (n: { userId: string; type: string }) => {
    notified.push(n);
  },
}));
const sent: string[] = [];
vi.mock("@/lib/webhook-dispatch", () => ({
  dispatchWebhook: async (event: string) => {
    sent.push(event);
  },
}));
vi.mock("@/lib/tenant-context", () => ({ runWithTenant: (_: string, fn: () => Promise<unknown>) => fn() }));
vi.mock("@/lib/tenant-resolve", () => ({
  resolveTenantBySubdomain: async (s: string) => (s === "acme" ? { tenant: { id: "t", name: "Acme" }, db: {} } : null),
}));
const rateTicket = vi.fn();
vi.mock("@/lib/ticket-public", () => ({ rateTicket: (...a: unknown[]) => rateTicket(...a), loadStatusPage: vi.fn() }));

const { submitTicketRating } = await import("./ticket-public-page");

const answered = (over: Record<string, unknown>) =>
  rateTicket.mockResolvedValue({
    ok: true,
    ticketId: "k1",
    ticketNumber: "TKT-1",
    notifyUserId: "anna",
    rating: "bad",
    changed: true,
    ...over,
  });

beforeEach(() => {
  notified.length = 0;
  sent.length = 0;
  rateTicket.mockReset();
});

describe("a customer's answer", () => {
  it("⚠️⚠️ a bad one reaches whoever handled the ticket", async () => {
    answered({});
    expect(await submitTicketRating({ workspace: "acme", token: "x", rating: "bad" })).toEqual({ ok: true });
    expect(notified).toEqual([expect.objectContaining({ userId: "anna", type: "ticket_rated_bad" })]);
  });

  it("⚠️ once: a reloaded page or a comment after the click tells nobody again", async () => {
    answered({ changed: false });
    await submitTicketRating({ workspace: "acme", token: "x", rating: "bad" });
    expect(notified).toHaveLength(0);
    // Nor do the integrations: a repeat is not an event.
    expect(sent).toEqual([]);
  });

  it("a good one is recorded without an interruption", async () => {
    answered({ rating: "good" });
    await submitTicketRating({ workspace: "acme", token: "x", rating: "good" });
    expect(notified).toHaveLength(0);
    // The integrations hear every change, good or bad.
    expect(sent).toEqual(["ticket.rated"]);
  });

  it("an unknown workspace is not found, and nothing is looked up", async () => {
    expect(await submitTicketRating({ workspace: "nope", token: "x", rating: "bad" })).toEqual({
      ok: false,
      reason: "notFound",
    });
    expect(rateTicket).not.toHaveBeenCalled();
  });
});
