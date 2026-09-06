/**
 * free-plan.ts — which plan means "not paying", asked in one place.
 *
 * The billing code decides two things from it: whether a workspace gets a
 * `planId` at all, and whether its subscription is recorded as `free` or as
 * `active`. Both were written as `plan.name === "free"`, scattered across the
 * server action and the admin screens.
 *
 * ⚠️ That string is editable. The admin panel offers the slug as a free-text
 * field labelled "Internal name (slug)", and `updatePlan` accepts it like any
 * other column — so renaming the free plan to `free-tier` would quietly start
 * recording every workspace on it as an **active paying subscription**, with a
 * plan id attached and Stripe never told. Nothing would fail; the number on the
 * invoice would just be wrong, and the screen that finds the current plan by the
 * same string would show none at all.
 *
 * This is the same rule the rest of the codebase already follows for roles:
 * never compare the string at the call site, ask a named question. Here the
 * question is one line, but it is one line in one file, and the slug it depends
 * on is now defended rather than assumed.
 */

/** The slug the billing logic recognises. Changing it is a data migration. */
export const FREE_PLAN_SLUG = "free";

/** The plan that means the workspace is not paying. */
export function isFreePlan(plan: { name: string } | null | undefined): boolean {
  return plan?.name === FREE_PLAN_SLUG;
}

/**
 * Whether a rename would break the recognition above.
 *
 * ⚠️ Renaming *to* the free slug is refused as well as renaming away from it.
 * Two plans cannot both be the free one — the column is unique, so the database
 * would refuse the second — but a rename that frees the slug and then claims it
 * elsewhere would move which plan counts as free without anybody deciding to.
 */
export function breaksFreePlanSlug(current: { name: string }, next: { name?: string }): boolean {
  if (next.name === undefined || next.name === current.name) return false;
  return current.name === FREE_PLAN_SLUG || next.name === FREE_PLAN_SLUG;
}
