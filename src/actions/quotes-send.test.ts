/**
 * sendQuoteEmailAction: the status moves only for an email that actually left.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let quote: Record<string, unknown>;
let sendOk = true;
const sent: unknown[] = [];
const logged: Record<string, unknown>[] = [];
const updates: unknown[] = [];

vi.mock("@/lib/tenant-context", () => ({
  getCurrentTenantId: async () => "t1",
  getDb: async () => ({
    query: { quotes: { findFirst: async () => quote } },
    // The quote's lines, read for the approval check (line discounts count too).
    select: () => ({ from: () => ({ where: async () => [] }) }),
    insert: () => ({ values: async (v: Record<string, unknown>) => logged.push(v) }),
    update: () => ({ set: (v: unknown) => ({ where: async () => updates.push(v) }) }),
  }),
}));
vi.mock("@/lib/get-tenant", () => ({ getTenantById: async () => ({ id: "t1", settings: null }) }));
vi.mock("@/lib/auth-guard", () => ({
  ForbiddenError: class extends Error {},
  requireCapability: async () => ({ userId: "u1", tenantRole: "editor", isPlatformStaff: false }),
  requirePlanModule: async () => undefined,
}));
vi.mock("@/lib/email-provider", () => ({
  sendEmail: async (o: unknown) => {
    sent.push(o);
    return sendOk ? { success: true } : { success: false, error: "smtp down" };
  },
}));
vi.mock("@/lib/app-url", () => ({
  appUrl: (p: string) => `https://crm.example.it${p}`,
  getAppUrl: () => "https://crm.example.it",
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/server", () => ({ after: () => undefined }));

const { sendQuoteEmailAction } = await import("./quotes");

beforeEach(() => {
  sendOk = true;
  sent.length = 0;
  logged.length = 0;
  updates.length = 0;
  quote = {
    id: "q1",
    ownerId: "u1",
    status: "viewed",
    quoteNumber: "P-2026-001",
    totalAmount: "1220.00",
    currency: "EUR",
    publicToken: "tok",
    expiresAt: null,
    discountPercent: "0",
    company: { country: "Italia", language: "it" },
    contact: null,
  };
});

describe("⚠️⚠️ sendQuoteEmailAction", () => {
  it("a follow-up on an opened quote is sent and logged as a reminder, with no error", async () => {
    await expect(sendQuoteEmailAction("q1", "cliente@x.it", "Sollecito", "Domande?")).resolves.toEqual({
      success: true,
    });
    expect(sent).toHaveLength(1);
    expect(logged.map((l) => l.type)).toEqual(["reminded"]);
    expect(updates).toEqual([]);
  });

  it("an email that did not leave changes nothing and says so", async () => {
    sendOk = false;
    quote.status = "draft";
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(sendQuoteEmailAction("q1", "cliente@x.it", "Preventivo", "")).rejects.toThrow("smtp down");
    expect(logged).toEqual([]);
    expect(updates).toEqual([]);
    error.mockRestore();
  });

  it("a quote that cannot be sent is refused before anything is emailed", async () => {
    quote.status = "accepted";
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(sendQuoteEmailAction("q1", "cliente@x.it", "Preventivo", "")).rejects.toThrow();
    expect(sent).toEqual([]);
    error.mockRestore();
  });
});
