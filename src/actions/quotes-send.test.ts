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

const { previewQuoteEmailAction, sendQuoteEmailAction } = await import("./quotes");

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
    await expect(
      sendQuoteEmailAction("q1", { to: "cliente@x.it", subject: "Sollecito", bodyHtml: "<p>Domande?</p>" }),
    ).resolves.toEqual({ success: true });
    expect(sent).toHaveLength(1);
    // On the customer's timeline as an email, and on the quote as a reminder.
    expect(logged.map((l) => l.type)).toEqual(["email", "reminded"]);
    expect(updates).toEqual([]);
  });

  it("an email that did not leave changes nothing and says so", async () => {
    sendOk = false;
    quote.status = "draft";
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await sendQuoteEmailAction("q1", { to: "cliente@x.it", subject: "Preventivo", bodyHtml: "" });
    expect(result.success).toBe(false);
    expect(!result.success && result.error).toContain("smtp down");
    expect(logged).toEqual([]);
    expect(updates).toEqual([]);
    error.mockRestore();
  });

  it("a quote that cannot be sent is refused before anything is emailed", async () => {
    quote.status = "accepted";
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await sendQuoteEmailAction("q1", { to: "cliente@x.it", subject: "Preventivo", bodyHtml: "" });
    expect(result.success).toBe(false);
    expect(sent).toEqual([]);
    warn.mockRestore();
    error.mockRestore();
  });
});

describe("⚠️ what the customer receives", () => {
  it("the person's text, then the quote's number, total and the link that opens it", async () => {
    await sendQuoteEmailAction("q1", {
      to: "cliente@x.it",
      cc: "ufficio@x.it",
      subject: "Il preventivo",
      bodyHtml: "<p>Gentile cliente, ecco la proposta.</p>",
    });
    const email = sent[0] as { html: string; cc?: string };
    // The number heads the frame ("Preventivo P-2026-001") and is in the box under the text.
    expect(email.html.indexOf("P-2026-001")).toBeLessThan(email.html.indexOf("ecco la proposta"));
    expect(email.html.indexOf("ecco la proposta")).toBeLessThan(email.html.lastIndexOf("P-2026-001"));
    expect(email.html).toContain("https://crm.example.it/q/tok");
    expect(email.cc).toBe("ufficio@x.it");
  });

  it("⚠️ the preview is the same email — quote box and link included — and sends nothing", async () => {
    const shown = await previewQuoteEmailAction("q1", {
      subject: "Il preventivo",
      bodyHtml: "<p>Ecco la proposta.</p>",
    });
    expect(shown.ok).toBe(true);
    const html = shown.ok ? shown.html : "";
    expect(html.indexOf("Ecco la proposta")).toBeLessThan(html.lastIndexOf("P-2026-001"));
    expect(html).toContain("https://crm.example.it/q/tok");
    expect(sent).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });
});
