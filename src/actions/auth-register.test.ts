/**
 * Signing up tells the people who create workspaces — and still signs the person in.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const inserted: Record<string, unknown>[] = [];
const announced: { name: string | null; email: string }[] = [];
let existing: { id: string }[] = [];

vi.mock("@/db", () => ({
  platformDb: {
    select: () => ({ from: () => ({ where: async () => existing }) }),
    insert: () => ({ values: async (v: Record<string, unknown>) => inserted.push(v) }),
  },
  createTenantDb: () => ({}),
}));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => undefined, signOut: async () => undefined }));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => fn() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/platform-staff", () => ({
  announceAccountWithoutWorkspace: async (p: { name: string | null; email: string }) => {
    announced.push(p);
  },
}));
vi.mock("@/lib/email", () => ({ sendInvitationEmail: async () => ({}), sendPasswordResetEmail: async () => ({}) }));
vi.mock("@/lib/i18n-server", () => ({ serverT: async () => (k: string) => k }));
vi.mock("@/lib/auth-guard", () => ({ requireActor: async () => ({}), requireCapability: async () => ({}) }));
vi.mock("@/lib/tenant-context", () => ({ getCurrentTenantId: async () => null, getDb: async () => ({}) }));
vi.mock("@/lib/tenant-db", () => ({ decryptDbUrl: () => "" }));

const { registerAction } = await import("./auth");

beforeEach(() => {
  inserted.length = 0;
  announced.length = 0;
  existing = [];
});

describe("⚠️⚠️ registerAction", () => {
  it("creates the account and announces that it has no workspace", async () => {
    const r = await registerAction({ name: "Anna", email: " Anna@Cliente.it ", password: "una-password-lunga" });

    expect(r).toEqual({ success: true });
    expect(inserted).toHaveLength(1);
    expect(announced).toEqual([{ name: "Anna", email: "anna@cliente.it" }]);
  }, 20_000);

  it("announces nothing for an address that already has an account", async () => {
    existing = [{ id: "u1" }];

    const r = await registerAction({ email: "anna@cliente.it", password: "una-password-lunga" });

    expect(r).toHaveProperty("error");
    expect(announced).toEqual([]);
  });
});
