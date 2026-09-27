/**
 * Logging an activity is a note to colleagues, never a message to the customer.
 *
 * A call used to email the contact "Call scheduled: <content>" — and the timeline form
 * stamps every entry with "now", so each call logged with a note sent that note,
 * internal remarks included, to the person it was about. Nothing on the screen said so.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const inseriti: Record<string, unknown>[] = [];
const letture: string[] = [];
const inviati: unknown[] = [];

vi.mock("@/lib/tenant-context", () => ({
  getDb: async () => ({
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inseriti.push(v);
        return { returning: async () => [{ id: "a1", ...v }] };
      },
    }),
    // Any read is recorded: looking up the contact's address is the first half of
    // writing to them, and createActivity has no other reason to read anything.
    select: () => {
      letture.push("select");
      return { from: () => ({ where: async () => [{ email: "cliente@example.com", firstName: "Mario" }] }) };
    },
  }),
}));
vi.mock("@/lib/auth-guard", () => ({
  requireCapability: async () => undefined,
  requireWriteAccess: async () => undefined,
}));
vi.mock("@/lib/email-provider", () => ({
  sendEmail: async (options: unknown) => {
    inviati.push(options);
    return { success: true };
  },
  getEmailConfig: async () => ({}),
  getPlatformEmailConfig: async () => ({}),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { createActivity } = await import("@/actions/activities");

beforeEach(() => {
  inseriti.length = 0;
  letture.length = 0;
  inviati.length = 0;
  vi.stubGlobal("fetch", async (url: string) => {
    inviati.push({ fetch: url });
    return { ok: true, status: 200, json: async () => ({}), text: async () => "" } as unknown as Response;
  });
});

describe("⚠️⚠️ logging an activity never writes to the customer", () => {
  for (const [link, id] of [
    ["contactId", "c1"],
    ["leadId", "l1"],
  ] as const) {
    it(`a call logged on a ${link === "contactId" ? "contact" : "lead"} with a private note sends nothing`, async () => {
      await createActivity({
        type: "call",
        content: "Sensibile al prezzo, preferisce il concorrente",
        date: new Date(),
        ownerId: "u1",
        [link]: id,
      });

      expect(inviati).toEqual([]);
      expect(letture).toEqual([]);
      expect(inseriti).toHaveLength(1);
      expect(inseriti[0]).toMatchObject({ type: "call", [link]: id });
    });
  }

  it("the same holds for a meeting or an email logged by hand", async () => {
    for (const type of ["meeting", "email", "note"]) {
      await createActivity({ type, content: "appunto", date: new Date(), contactId: "c1" });
    }
    expect(inviati).toEqual([]);
  });
});
