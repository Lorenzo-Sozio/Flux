/**
 * Who sees whose commissions (src/actions/commissions.ts): the owners filter is a view, the
 * capability is the permission.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";
import * as schema from "@/db/schema";
import { can, type TenantRole } from "@/lib/permissions";

const db = drizzle(new PGlite(), { schema });
let role: TenantRole = "editor";

vi.mock("@/lib/tenant-context", () => ({ getDb: async () => db }));
vi.mock("@/lib/workspace-time-zone", () => ({ getWorkspaceTimeZone: async () => "Europe/Rome" }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth-guard", () => ({
  requireCapability: async (capability: Parameters<typeof can>[1]) => {
    const actor = { userId: "anna", tenantRole: role, isPlatformStaff: false };
    if (!can(actor, capability)) throw new Error(`forbidden: ${capability}`);
    return actor;
  },
}));

const { approveCommissionMonthAction, getCommissions, saveCommissionRuleAction } = await import("./commissions");

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  role = "editor";
  for (const t of ["commission_line", "commission_statement", "commission_rule", "deal", "user"])
    await db.execute(sql.raw(`delete from "${t}"`));
  await db.execute(
    sql`insert into "user" (id, name, email) values ('anna', 'Anna', 'a@x.it'), ('luca', 'Luca', 'l@x.it')`,
  );
  await db.execute(sql`insert into deal (id, name, amount, owner_id, status, closed_at) values
    ('a', 'A', '1000', 'anna', 'won', '2026-09-10T10:00:00Z'),
    ('b', 'B', '1000', 'luca', 'won', '2026-09-11T10:00:00Z')`);
});

describe("⚠️⚠️ what a colleague earns", () => {
  it("is not shown to somebody who does not manage commissions, whatever they filter by", async () => {
    for (const owners of [undefined, [], ["luca"]]) {
      const data = await getCommissions({ period: "2026-09", owners });
      expect(data.canManage).toBe(false);
      expect(data.report?.lines.map((l) => l.dealId)).toEqual(["a"]);
      expect(data.rules).toEqual([]);
    }
  });

  it("is shown to whoever manages them", async () => {
    role = "admin";
    const data = await getCommissions({ period: "2026-09" });
    expect(data.canManage).toBe(true);
    expect(data.report?.lines.map((l) => l.dealId)).toEqual(["a", "b"]);
  });

  it("a rate for somebody, or a pipeline, that is not there is refused — not a 500", async () => {
    role = "admin";
    expect(await saveCommissionRuleAction({ userId: "nobody", ratePercent: 5, validFrom: "2026-01-01" })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await saveCommissionRuleAction({ pipelineId: "nope", ratePercent: 5, validFrom: "2026-01-01" })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await saveCommissionRuleAction({ userId: "luca", ratePercent: 5, validFrom: "2026-01-01" })).toEqual({
      ok: true,
    });
  });

  it("⚠️ setting a rate and approving a month are for managers", async () => {
    await expect(saveCommissionRuleAction({ ratePercent: 50, validFrom: "2026-01-01" })).rejects.toThrow(
      "commission:manage",
    );
    await expect(approveCommissionMonthAction("2026-09")).rejects.toThrow("commission:manage");
    const rules = await db.execute(sql`select count(*)::int as n from commission_rule`);
    expect(rules.rows[0]).toEqual({ n: 0 });
  });
});
