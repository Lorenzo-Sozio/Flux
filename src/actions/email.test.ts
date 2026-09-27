/**
 * Sending an email from a record: once it has gone, nothing reports it as failed.
 */
import { describe, expect, it, vi } from "vitest";

let insertFails = false;
const sent: unknown[] = [];

vi.mock("@/lib/tenant-context", () => ({
  getDb: async () => ({
    select: () => ({ from: () => ({ where: async () => [{ email: "luca@firm.it" }] }) }),
    insert: () => ({
      values: () => (insertFails ? Promise.reject(new Error("fk violation")) : Promise.resolve(undefined)),
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
