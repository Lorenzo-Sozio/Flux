/**
 * Who in a workspace holds a capability — read from the membership registry.
 *
 * Two places asked `users.role IN ('admin','owner')` of the workspace's copy of its
 * people — refreshed only on a dashboard visit, never pruned: the quote approval request and
 * the order bell reached people who had left, and missed anyone just promoted. The roles here
 * are the registry's, as they are now.
 */
import { describe, expect, it, vi } from "vitest";

const membri = [
  { userId: "o", role: "owner", tenantId: "t1" },
  { userId: "a", role: "admin", tenantId: "t1" },
  { userId: "e", role: "editor", tenantId: "t1" },
  { userId: "v", role: "viewer", tenantId: "t1" },
];

vi.mock("@/db", () => ({
  platformDb: {
    select: () => ({ from: () => ({ where: async () => membri }) }),
  },
}));

const { membersWith } = await import("./workspace-members");

describe("⚠️⚠️ membersWith", () => {
  it("returns the owner and the admins for an admin capability", async () => {
    expect((await membersWith("t1", "quote:approve")).sort()).toEqual(["a", "o"]);
  });

  it("returns editors too for an editor capability, never a viewer", async () => {
    expect((await membersWith("t1", "quote:write")).sort()).toEqual(["a", "e", "o"]);
  });

  it("returns only the owner for what only an owner may do", async () => {
    expect(await membersWith("t1", "billing:manage")).toEqual(["o"]);
  });
});
