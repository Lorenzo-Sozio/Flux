/**
 * The rules for an API write run in the caller's workspace, or they do not run at all.
 *
 * A request carrying an API key has no `x-tenant-id`. The engine reads its rules through
 * `getDb()`, which throws without one, and the call sat inside `after()` unawaited — so
 * every rule an integration should have set off failed where nobody could see it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const visti: { ctx: Record<string, unknown>; tenant: string | null }[] = [];
const inCorso: Promise<unknown>[] = [];
let fallisce = false;

vi.mock("next/server", () => ({
  after: (fn: () => Promise<unknown>) => {
    inCorso.push(fn());
  },
}));
vi.mock("@/components/crm/automation/rule-engine", () => ({
  runAutomations: async (ctx: Record<string, unknown>) => {
    const { getOverriddenTenantId } = await import("@/lib/tenant-context");
    visti.push({ ctx, tenant: getOverriddenTenantId() });
    if (fallisce) throw new Error("rules table unreachable");
  },
}));
// tenant-context is the real one — it is what is being tested — so what it imports is
// replaced with nothing: no database is opened here.
vi.mock("@/db", () => ({ createTenantDb: () => ({}), platformDb: {} }));
vi.mock("@/db/auto-migrate", () => ({ ensureTenantMigrated: async () => undefined }));
vi.mock("@/lib/get-tenant", () => ({ getTenantById: async () => null }));
vi.mock("@/lib/tenant-db", () => ({ decryptDbUrl: () => "" }));

const { runRulesAfterApiWrite } = await import("@/lib/api-automations");

afterEach(() => {
  visti.length = 0;
  inCorso.length = 0;
  fallisce = false;
});

const ctx = { entityType: "lead", entityId: "l1", event: "onCreate", oldData: {}, newData: { id: "l1" } } as const;

describe("⚠️⚠️ runRulesAfterApiWrite", () => {
  it("runs the rules with the caller's workspace active", async () => {
    runRulesAfterApiWrite("t1", ctx);
    await Promise.all(inCorso);

    expect(visti).toHaveLength(1);
    expect(visti[0].tenant).toBe("t1");
    expect(visti[0].ctx).toMatchObject({ entityType: "lead", entityId: "l1", event: "onCreate" });
  });

  it("keeps two workspaces apart when their rules run at the same time", async () => {
    runRulesAfterApiWrite("t1", ctx);
    runRulesAfterApiWrite("t2", { ...ctx, entityId: "l2" });
    await Promise.all(inCorso);

    const byRecord = Object.fromEntries(visti.map((v) => [v.ctx.entityId, v.tenant]));
    expect(byRecord).toEqual({ l1: "t1", l2: "t2" });
  });

  it("says so when the rules fail, instead of leaving an unhandled rejection", async () => {
    fallisce = true;
    const errore = vi.spyOn(console, "error").mockImplementation(() => undefined);

    runRulesAfterApiWrite("t1", ctx);
    await expect(Promise.all(inCorso)).resolves.toBeDefined();

    expect(errore).toHaveBeenCalledWith(expect.stringContaining("lead l1"), expect.any(Error));
    errore.mockRestore();
  });
});
