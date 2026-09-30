/**
 * ⚠️⚠️ Who may use the copilot, and how much — the checks that decide spend.
 *
 * A mistake here is silent in the expensive direction: a plan that does not include the
 * copilot using it anyway, or a month's allowance that never runs out, both look like a
 * working product and arrive as the provider's bill.
 */
import { describe, expect, it } from "vitest";

import { effectiveLimits } from "@/lib/billing/plans-config";

import { decideAiAccess, entryFor, withinAiLimit } from "./access";

const PLAN_WITH_AI = { isActive: true, isSuspended: false, enabledModules: ["crm", "ai"] as never };

describe("decideAiAccess", () => {
  it("lets a workspace in only when the deployment, the plan and the workspace all say yes", () => {
    expect(decideAiAccess({ route: "on", entitlements: PLAN_WITH_AI, workspaceOn: true })).toBeNull();
  });

  it("⚠️ refuses a plan without the copilot flag", () => {
    const plan = { ...PLAN_WITH_AI, enabledModules: ["crm", "sales"] as never };
    expect(decideAiAccess({ route: "on", entitlements: plan, workspaceOn: true })).toBe("plan");
  });

  it("⚠️ refuses a suspended or inactive subscription even when its plan has the flag", () => {
    expect(
      decideAiAccess({ route: "on", entitlements: { ...PLAN_WITH_AI, isSuspended: true }, workspaceOn: true }),
    ).toBe("inactive");
    expect(decideAiAccess({ route: "on", entitlements: { ...PLAN_WITH_AI, isActive: false }, workspaceOn: true })).toBe(
      "inactive",
    );
  });

  it("refuses a workspace whose administrator switched it off", () => {
    expect(decideAiAccess({ route: "on", entitlements: PLAN_WITH_AI, workspaceOn: false })).toBe("workspace");
  });

  it("says which of the three is missing, so the right person is asked", () => {
    expect(decideAiAccess({ route: "off", entitlements: PLAN_WITH_AI, workspaceOn: true })).toBe("off");
    expect(decideAiAccess({ route: "config", entitlements: PLAN_WITH_AI, workspaceOn: true })).toBe("config");
    expect(decideAiAccess({ route: "on", entitlements: null, workspaceOn: true })).toBe("no_workspace");
  });
});

describe("the monthly allowance", () => {
  it("allows up to the limit and refuses the request past it", () => {
    expect(withinAiLimit(100, 100)).toBe(true);
    expect(withinAiLimit(101, 100)).toBe(false);
    expect(withinAiLimit(1_000_000, null)).toBe(true);
  });

  it("⚠️ reads a plan saved before the copilot existed as no requests, not unlimited", () => {
    expect(effectiveLimits({ apiCallsPerMonth: 10 }, 5).aiRequestsPerMonth).toBe(0);
    expect(effectiveLimits({ aiRequestsPerMonth: null }, 5).aiRequestsPerMonth).toBeNull();
    expect(effectiveLimits({ aiRequestsPerMonth: 300 }, 5).aiRequestsPerMonth).toBe(300);
  });
});

describe("⚠️ what a screen shows for a copilot control", () => {
  it("is ready when every key says yes", () => {
    expect(entryFor(null, false)).toEqual({ state: "ready" });
  });

  it("shows a plan without the copilot as disabled, with the reason: the customer can upgrade", () => {
    expect(entryFor("plan", false)).toEqual({ state: "unavailable", reason: "plan" });
  });

  it("⚠️ shows a deployment without a provider only to Flux's staff, who can set the key", () => {
    expect(entryFor("off", true)).toEqual({ state: "unavailable", reason: "off" });
    expect(entryFor("config", true)).toEqual({ state: "unavailable", reason: "config" });
    expect(entryFor("off", false)).toBeNull();
    expect(entryFor("config", false)).toBeNull();
  });

  it("hides what nobody in the workspace can change from the screen", () => {
    expect(entryFor("workspace", true)).toBeNull();
    expect(entryFor("inactive", false)).toBeNull();
    expect(entryFor("no_workspace", true)).toBeNull();
  });
});
