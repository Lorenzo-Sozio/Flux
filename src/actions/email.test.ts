/**
 * Sending an email from a record: once it has gone, nothing reports it as failed.
 */
import { describe, expect, it, vi } from "vitest";

let insertFails = false;
const sent: unknown[] = [];
const logged: Record<string, unknown>[] = [];

vi.mock("@/lib/tenant-context", () => ({
  getDb: async () => ({
    select: () => ({
      from: () => ({
        where: async () => [{ email: "luca@firm.it", name: "Luca" }],
        // The deal an email is sent from: its name and value fill {{trattativa}} and {{valore}}.
        leftJoin: () => ({
          where: async () => [
            { name: "Rinnovo 2027", amount: "1000", amountOriginal: null, currency: "EUR", company: null },
          ],
        }),
      }),
    }),
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        logged.push(row);
        return insertFails ? Promise.reject(new Error("fk violation")) : Promise.resolve(undefined);
      },
    }),
  }),
}));
vi.mock("@/lib/auth-guard", () => ({ requireWriteAccess: async () => ({ user: { id: "luca" } }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/email-provider", () => ({
  sendEmail: async (o: unknown) => {
    sent.push(o);
    return { success: true };
  },
}));

const { sendEmailAction } = await import("./email");

describe("⚠️⚠️ sendEmailAction", () => {
  it("reports success when the email went out, even if logging it on the record failed", async () => {
    insertFails = true;
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      sendEmailAction({ to: "anna@x.it", subject: "Ciao", body: "<p>Ciao</p>", leadId: "l1" }),
    ).resolves.toEqual({ success: true });
    expect(sent).toHaveLength(1);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("⚠️ where the customer's answer goes", () => {
  it("to the person who wrote, when replies cannot reach Flux", async () => {
    insertFails = false;
    sent.length = 0;
    vi.stubEnv("RESEND_INBOUND_WEBHOOK_SECRET", "");
    vi.stubEnv("INBOUND_EMAIL_SECRET", "");

    await sendEmailAction({ to: "anna@x.it", subject: "Ciao", body: "<p>Ciao</p>", leadId: "l1" });

    expect(sent[0]).toMatchObject({ replyTo: "luca@firm.it" });
    vi.unstubAllEnvs();
  });

  it("back to the workspace, where it is filed on the record and reaches the owner, when they can", async () => {
    sent.length = 0;
    vi.stubEnv("INBOUND_EMAIL_SECRET", "s3cret");

    await sendEmailAction({ to: "anna@x.it", subject: "Ciao", body: "<p>Ciao</p>", leadId: "l1" });

    expect(sent[0]).not.toHaveProperty("replyTo");
    vi.unstubAllEnvs();
  });
});

describe("an email sent from a deal", () => {
  it("is logged on the deal as well as on its contact, so both timelines show it", async () => {
    insertFails = false;
    logged.length = 0;

    await sendEmailAction({
      to: "mario@rossi.it",
      subject: "Offerta",
      body: "<p>Ecco</p>",
      contactId: "ct1",
      dealId: "d1",
    });

    expect(logged[0]).toMatchObject({ type: "email", contactId: "ct1", dealId: "d1" });
  });
});

describe("⚠️ copies", () => {
  it("sends Cc and Bcc, cleaned, and records them on the record", async () => {
    insertFails = false;
    sent.length = 0;
    logged.length = 0;

    const result = await sendEmailAction({
      to: "mario@rossi.it",
      cc: "Anna <ANNA@x.it>; luca@y.com",
      bcc: "capo@firm.it",
      subject: "Offerta",
      body: "<p>Ecco</p>",
      contactId: "ct1",
    });

    expect(result).toEqual({ success: true });
    expect(sent[0]).toMatchObject({ cc: "anna@x.it, luca@y.com", bcc: "capo@firm.it" });
    expect(JSON.parse(String(logged[0].content))).toMatchObject({
      cc: ["anna@x.it", "luca@y.com"],
      bcc: ["capo@firm.it"],
    });
  });

  it("refuses an address that is not one, and sends nothing", async () => {
    sent.length = 0;

    const result = await sendEmailAction({
      to: "mario@rossi.it",
      cc: "anna@x.it, luca",
      subject: "S",
      body: "<p>B</p>",
    });

    expect(result.success).toBe(false);
    expect(!result.success && result.error).toContain("luca");
    expect(sent).toHaveLength(0);
  });
});

describe("⚠️ the fields only the server can fill", () => {
  it("fills the sender's and, from a deal, the deal's — the recipient's were filled by the dialog", async () => {
    insertFails = false;
    sent.length = 0;

    await sendEmailAction({
      to: "mario@rossi.it",
      subject: "{{trattativa}}: prossimi passi",
      body: "<p>Valore {{valore}}.</p><p>{{mittente}}</p>",
      contactId: "ct1",
      dealId: "d1",
    });

    expect(sent[0]).toMatchObject({ subject: "Rinnovo 2027: prossimi passi" });
    expect(String((sent[0] as { html: string }).html)).toContain("Luca");
    expect(String((sent[0] as { html: string }).html)).toMatch(/Valore 1\.000,00\s€/);
  });
});
