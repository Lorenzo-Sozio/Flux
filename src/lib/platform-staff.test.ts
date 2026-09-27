/**
 * A new account without a workspace reaches the people who can create one.
 *
 * ⚠️⚠️ Signing up ended on "contact an administrator", and nobody was told: a workspace can
 * only be created from the platform panel, and the panel's staff learned nothing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

let staff: { email: string | null }[] = [];
let failSend = false;
const sent: { to: string[]; email: string }[] = [];

vi.mock("@/db", () => ({
  platformDb: { select: () => ({ from: () => ({ where: async () => staff }) }) },
}));
vi.mock("@/lib/email", () => ({
  sendWorkspaceRequestEmail: async (to: string[], person: { email: string }) => {
    if (failSend) throw new Error("smtp down");
    sent.push({ to, email: person.email });
  },
}));

const { announceAccountWithoutWorkspace } = await import("./platform-staff");

afterEach(() => {
  staff = [];
  failSend = false;
  sent.length = 0;
  vi.restoreAllMocks();
});

describe("⚠️⚠️ announceAccountWithoutWorkspace", () => {
  it("writes to every member of the platform staff", async () => {
    staff = [{ email: "lorenzo@flux.it" }, { email: "supporto@flux.it" }, { email: null }];

    await announceAccountWithoutWorkspace({ name: "Anna", email: "anna@cliente.it" });

    expect(sent).toEqual([{ to: ["lorenzo@flux.it", "supporto@flux.it"], email: "anna@cliente.it" }]);
  });

  it("never fails the sign-up when the email cannot be sent — it says so in the log", async () => {
    staff = [{ email: "lorenzo@flux.it" }];
    failSend = true;
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(announceAccountWithoutWorkspace({ name: null, email: "anna@cliente.it" })).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });

  it("says so when there is nobody to tell", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await announceAccountWithoutWorkspace({ name: null, email: "anna@cliente.it" });

    expect(sent).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("anna@cliente.it"));
  });
});
