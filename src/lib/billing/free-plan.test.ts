/**
 * Which plan means "not paying".
 *
 * On the tested surface because of what the answer decides: whether a workspace
 * gets a plan id, and whether its subscription is recorded as free or as active.
 * Getting it wrong does not fail — it produces a workspace that looks like a
 * paying customer in the billing tables while Stripe has never heard of it, and
 * the discrepancy surfaces on an invoice rather than in a log.
 */
import { describe, expect, it } from "vitest";

import { breaksFreePlanSlug, FREE_PLAN_SLUG, isFreePlan } from "./free-plan";

describe("isFreePlan", () => {
  it("recognises the free plan by its slug", () => {
    expect(isFreePlan({ name: FREE_PLAN_SLUG })).toBe(true);
  });

  it("⚠️ recognises nothing else, however free it looks", () => {
    // A plan priced at zero is still not the plan the billing logic means, and
    // guessing from the price would make a temporary discount into a downgrade.
    for (const name of ["basic", "professional", "enterprise", "custom", "free-tier", "Free", "FREE", ""]) {
      expect(isFreePlan({ name }), name).toBe(false);
    }
  });

  it("survives no plan at all", () => {
    expect(isFreePlan(null)).toBe(false);
    expect(isFreePlan(undefined)).toBe(false);
  });
});

describe("breaksFreePlanSlug", () => {
  it("⚠️ refuses to rename the free plan", () => {
    // The whole point: the slug is what the billing logic recognises. Renaming
    // it starts recording free workspaces as active paying subscriptions.
    expect(breaksFreePlanSlug({ name: FREE_PLAN_SLUG }, { name: "free-tier" })).toBe(true);
  });

  it("⚠️ refuses to hand the slug to a different plan", () => {
    // Freeing the slug and claiming it elsewhere would move which plan counts as
    // free without anybody deciding to.
    expect(breaksFreePlanSlug({ name: "basic" }, { name: FREE_PLAN_SLUG })).toBe(true);
  });

  it("allows renaming any other plan", () => {
    expect(breaksFreePlanSlug({ name: "basic" }, { name: "starter" })).toBe(false);
  });

  it("allows an edit that does not touch the slug", () => {
    // Editing the display name and the price is the ordinary case, and it must
    // not be blocked by a rule about a field nobody changed.
    expect(breaksFreePlanSlug({ name: FREE_PLAN_SLUG }, {})).toBe(false);
    expect(breaksFreePlanSlug({ name: FREE_PLAN_SLUG }, { name: FREE_PLAN_SLUG })).toBe(false);
  });
});
