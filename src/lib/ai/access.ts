/**
 * Whether the copilot may run for this workspace, right now.
 *
 * Four keys, all needed, checked cheapest first:
 * 1. **the deployment** has a provider configured (./config.ts) — no database needed;
 * 2. **the plan** is active and has the `ai` module — a flag set per plan in /admin/plans;
 * 3. **the workspace** has not switched it off (Settings → Features);
 * 4. **the month's requests** are within the plan's `aiRequestsPerMonth`, counted *before* the
 *    call (`reserveAiRequest`), so two requests at once cannot both take the last one.
 *
 * ⚠️ The refusals are distinct on purpose: "your plan does not include it", "your administrator
 * switched it off" and "this deployment has no provider" are three different people to ask.
 */
import "server-only";

import { getEntitlements, type TenantEntitlements } from "@/lib/billing/licensing";
import { incrementUsage } from "@/lib/billing/usage";
import { getTenantById } from "@/lib/get-tenant";
import { isPlatformStaffRole } from "@/lib/permissions";
import { getCurrentTenantId, getDb } from "@/lib/tenant-context";
import { readWorkspaceFeatures } from "@/lib/workspace-features";

import { type AiRoute, aiRoute } from "./config";
import { AI_TASKS, type AiEntry, type AiTask } from "./types";

/**
 * - `off` / `config` — the deployment (./config.ts);
 * - `no_workspace` — called outside a workspace;
 * - `inactive` — the subscription is suspended or not active;
 * - `plan` — the plan does not include the copilot;
 * - `workspace` — the workspace switched it off;
 * - `limit` — the month's requests are spent.
 */
export type AiRefusal = "off" | "config" | "no_workspace" | "inactive" | "plan" | "workspace" | "limit";

/** The decision without the reads, so its order can be tested. */
export function decideAiAccess(input: {
  route: AiRoute["state"];
  entitlements: Pick<TenantEntitlements, "isActive" | "isSuspended" | "enabledModules"> | null;
  workspaceOn: boolean;
}): AiRefusal | null {
  if (input.route !== "on") return input.route;
  if (!input.entitlements) return "no_workspace";
  if (!input.entitlements.isActive || input.entitlements.isSuspended) return "inactive";
  if (!input.entitlements.enabledModules.includes("ai")) return "plan";
  if (!input.workspaceOn) return "workspace";
  return null;
}

/** Whether one more request fits: `used` already counts it. */
export function withinAiLimit(used: number, limit: number | null): boolean {
  return limit === null || used <= limit;
}

export type AiAccess = { ok: true; tenantId: string } | { ok: false; refusal: AiRefusal };

/**
 * Keys 1 and 2 only: whether the copilot is *offered* to this workspace at all — what decides
 * if its switch appears in Settings → Features. A switch for something the plan does not
 * include would only say "on" about a thing nobody can use.
 */
export async function aiOfferedToWorkspace(): Promise<boolean> {
  if (!AI_TASKS.some((task) => aiRoute(task).state === "on")) return false;
  const tenantId = await getCurrentTenantId();
  const tenant = tenantId ? await getTenantById(tenantId) : null;
  if (!tenant) return false;
  const entitlements = await getEntitlements(tenant.id);
  return decideAiAccess({ route: "on", entitlements, workspaceOn: true }) === null;
}

/**
 * What a page shows for a copilot control (keys 1–3): ready, disabled with the reason, or
 * nothing at all.
 *
 * ⚠️ A control nobody can use and nobody can fix is noise, so it is hidden: a workspace switched
 * off by its administrator, an inactive subscription. One the person *can* do something about is
 * shown disabled, with the reason: a plan without the copilot (upgrade), and — for Flux's own
 * staff only — a deployment with no provider or a wrong one (set the key). Customers of a
 * deployment without a provider never see it.
 */
export type { AiEntry };

/** Whether the signed-in person is Flux's own staff, from the session's user. */
export function aiViewer(user: unknown): { isPlatformStaff: boolean } {
  return { isPlatformStaff: isPlatformStaffRole((user as { role?: string | null } | undefined)?.role ?? null) };
}

/** The pure half of `aiEntries`, so what is shown to whom can be tested. */
export function entryFor(refusal: AiRefusal | null, isPlatformStaff: boolean): AiEntry | null {
  if (refusal === null) return { state: "ready" };
  if (refusal === "plan") return { state: "unavailable", reason: "plan" };
  if ((refusal === "off" || refusal === "config") && isPlatformStaff) return { state: "unavailable", reason: refusal };
  return null;
}

/**
 * The entry for each of these tasks, reading the plan and the workspace once for all of them.
 * Reads nothing when the deployment has no provider and the viewer is not staff — the usual
 * case, and the one every page view pays.
 */
export async function aiEntries<T extends AiTask>(
  tasks: readonly T[],
  viewer: { isPlatformStaff: boolean },
): Promise<Partial<Record<T, AiEntry>>> {
  const out: Partial<Record<T, AiEntry>> = {};
  const routes = tasks.map((task) => [task, aiRoute(task).state] as const);
  const routed = routes.filter(([, state]) => state === "on");

  let planRefusal: AiRefusal | null = "no_workspace";
  if (routed.length > 0) {
    const tenantId = await getCurrentTenantId();
    const tenant = tenantId ? await getTenantById(tenantId) : null;
    if (tenant) {
      const [entitlements, features] = await Promise.all([
        getEntitlements(tenant.id),
        readWorkspaceFeatures(await getDb()),
      ]);
      planRefusal = decideAiAccess({ route: "on", entitlements, workspaceOn: features.ai });
    }
  }
  for (const [task, state] of routes) {
    const entry = entryFor(state === "on" ? planRefusal : state, viewer.isPlatformStaff);
    if (entry) out[task] = entry;
  }
  return out;
}

/** Checks keys 1–3. Reads nothing when the deployment has no provider. */
export async function aiAccess(task: AiTask): Promise<AiAccess> {
  const route = aiRoute(task).state;
  if (route !== "on") return { ok: false, refusal: route };

  const tenantId = await getCurrentTenantId();
  const tenant = tenantId ? await getTenantById(tenantId) : null;
  if (!tenant) return { ok: false, refusal: "no_workspace" };

  const [entitlements, features] = await Promise.all([
    getEntitlements(tenant.id),
    readWorkspaceFeatures(await getDb()),
  ]);
  const refusal = decideAiAccess({ route, entitlements, workspaceOn: features.ai });
  return refusal ? { ok: false, refusal } : { ok: true, tenantId: tenant.id };
}

/**
 * Key 4: takes one request from the month's allowance, or says there is none left.
 *
 * ⚠️ Counted before the call and not given back when it fails: a failed call may still have
 * been billed by the provider, and a count that only goes up cannot be raced below the limit.
 */
export async function reserveAiRequest(tenantId: string): Promise<boolean> {
  const { limits } = await getEntitlements(tenantId);
  // null is "unlimited"; `effectiveLimits` has already turned a missing value into 0.
  const limit = limits.aiRequestsPerMonth;
  if (limit === 0) return false;
  return withinAiLimit(await incrementUsage(tenantId, "aiRequestsPerMonth"), limit);
}
