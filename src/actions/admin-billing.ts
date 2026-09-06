"use server";

/**
 * Admin Billing Server Actions — platform-level management.
 * Called from /admin/billing pages.
 * Requires platform admin/owner session (no tenant subdomain needed).
 */

import { revalidatePath } from "next/cache";

import { and, desc, eq, inArray, or } from "drizzle-orm";

import { platformDb } from "@/db";
import { billingPlans, billingSubscriptions, billingTenantAddons, tenants } from "@/db/schema";
import { requireAdminPanelAccess } from "@/lib/auth-guard";
import { breaksFreePlanSlug, FREE_PLAN_SLUG, isFreePlan } from "@/lib/billing/free-plan";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

import { invalidateEntitlementCache, logEntitlementChange } from "@/lib/billing/licensing";
import { ADDON_CONFIGS, type AddonType, PLAN_CONFIGS } from "@/lib/billing/plans-config";
import { getStripe } from "@/lib/billing/stripe";

// ─── Plans CRUD ───────────────────────────────────────────────────────────────

export async function listPlans() {
  await requireAdminPanelAccess();
  return platformDb.select().from(billingPlans).orderBy(billingPlans.sortOrder);
}

export async function getPlan(id: string) {
  await requireAdminPanelAccess();
  return platformDb.query.billingPlans.findFirst({
    where: eq(billingPlans.id, id),
  });
}

export interface UpsertPlanInput {
  name: string;
  displayName: string;
  description?: string;
  stripeProductId?: string;
  stripePriceMonthlyId?: string;
  stripePriceAnnualId?: string;
  stripeExtraUserMonthlyPriceId?: string;
  stripeExtraUserAnnualPriceId?: string;
  pricePerUserMonthly: number;
  pricePerUserAnnual: number;
  annualDiscountPercent: number;
  includedUsers: number;
  maxUsers?: number | null;
  minUsers: number;
  extraUserPriceMonthly: number;
  extraUserPriceAnnual: number;
  trialDays: number;
  limits: string; // JSON string
  enabledModules: string; // JSON string array
  supportTier: string;
  hasWhiteLabel: boolean;
  hasSandbox: boolean;
  isActive: boolean;
  isPublic: boolean;
  sortOrder: number;
  isCustom: boolean;
}

export async function createPlan(input: UpsertPlanInput) {
  await requireAdminPanelAccess();
  const [plan] = await platformDb
    .insert(billingPlans)
    .values({ ...input, maxUsers: input.maxUsers ?? null })
    .returning();
  revalidatePath("/admin/billing");
  revalidatePath("/admin/plans");
  return plan;
}

export async function updatePlan(id: string, input: Partial<UpsertPlanInput>) {
  await requireAdminPanelAccess();

  // ⚠️ The slug is not decoration: the billing logic recognises the free plan by
  // it. Renaming it would start recording workspaces on that plan as active
  // paying subscriptions, silently, and Stripe would never hear about it. The
  // display name is the one meant to be edited.
  const [current] = await platformDb.select().from(billingPlans).where(eq(billingPlans.id, id));
  if (current && breaksFreePlanSlug(current, input)) {
    throw new Error(
      `The "${FREE_PLAN_SLUG}" slug is what the billing logic recognises as the free plan. ` +
        "Change the display name instead, or migrate the data deliberately.",
    );
  }

  await platformDb
    .update(billingPlans)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(billingPlans.id, id));
  revalidatePath("/admin/billing");
  revalidatePath("/admin/plans");
}

export async function deletePlan(id: string) {
  await requireAdminPanelAccess();
  // Soft delete
  await platformDb.update(billingPlans).set({ isActive: false, updatedAt: new Date() }).where(eq(billingPlans.id, id));
  revalidatePath("/admin/plans");
}

/**
 * Seeds the default Free/Basic/Professional/Enterprise plans.
 * Safe to call multiple times — uses INSERT … ON CONFLICT DO NOTHING logic
 * by checking name existence first.
 */
export async function seedDefaultPlans() {
  await requireAdminPanelAccess();

  for (const [, cfg] of Object.entries(PLAN_CONFIGS)) {
    const existing = await platformDb.query.billingPlans.findFirst({
      where: eq(billingPlans.name, cfg.name),
    });
    if (existing) continue;

    await platformDb.insert(billingPlans).values({
      name: cfg.name,
      displayName: cfg.displayName,
      description: cfg.description,
      pricePerUserMonthly: cfg.pricePerUserMonthly,
      pricePerUserAnnual: cfg.pricePerUserAnnual,
      annualDiscountPercent: cfg.annualDiscountPercent,
      includedUsers: cfg.includedUsers,
      maxUsers: cfg.maxUsers,
      minUsers: cfg.minUsers,
      extraUserPriceMonthly: cfg.extraUserPriceMonthly,
      extraUserPriceAnnual: cfg.extraUserPriceAnnual,
      trialDays: cfg.trialDays,
      limits: JSON.stringify(cfg.limits),
      enabledModules: JSON.stringify(cfg.enabledModules),
      supportTier: cfg.supportTier,
      hasWhiteLabel: cfg.hasWhiteLabel,
      hasSandbox: cfg.hasSandbox,
      isPublic: cfg.isPublic,
      sortOrder: cfg.sortOrder,
    });
  }

  revalidatePath("/admin/plans");
}

// ─── Subscription management ──────────────────────────────────────────────────

export async function listSubscriptions(filters?: { status?: string; planId?: string }) {
  await requireAdminPanelAccess();

  const conditions = [];
  if (filters?.status) conditions.push(eq(billingSubscriptions.status, filters.status));
  if (filters?.planId) conditions.push(eq(billingSubscriptions.planId, filters.planId));

  const query = platformDb
    .select({
      subscription: billingSubscriptions,
      tenant: { id: tenants.id, name: tenants.name, subdomain: tenants.subdomain },
      plan: { id: billingPlans.id, name: billingPlans.name, displayName: billingPlans.displayName },
    })
    .from(billingSubscriptions)
    .leftJoin(tenants, eq(billingSubscriptions.tenantId, tenants.id))
    .leftJoin(billingPlans, eq(billingSubscriptions.planId, billingPlans.id))
    .orderBy(desc(billingSubscriptions.updatedAt));

  if (conditions.length > 0) {
    return query.where(and(...conditions));
  }
  return query;
}

export async function getTenantSubscription(tenantId: string) {
  await requireAdminPanelAccess();
  return platformDb.query.billingSubscriptions.findFirst({
    where: eq(billingSubscriptions.tenantId, tenantId),
    with: { plan: true, addons: true },
  });
}

/** Manual admin upgrade/downgrade (immediate, no proration via Stripe). */
export async function manualChangePlan(tenantId: string, planId: string, triggeredBy: string) {
  await requireAdminPanelAccess();

  const previous = await platformDb.query.billingSubscriptions.findFirst({
    where: eq(billingSubscriptions.tenantId, tenantId),
    with: { plan: true },
  });

  const newPlan = await platformDb.query.billingPlans.findFirst({
    where: eq(billingPlans.id, planId),
  });
  if (!newPlan) throw new Error("Plan not found");

  await platformDb
    .update(billingSubscriptions)
    .set({
      planId,
      status: "active",
      gracePeriodEnd: null,
      canceledAt: null,
      updatedAt: new Date(),
    })
    .where(eq(billingSubscriptions.tenantId, tenantId));

  invalidateEntitlementCache(tenantId);

  await logEntitlementChange({
    tenantId,
    eventType: "plan_changed",
    previousValue: { planName: previous?.plan?.name },
    newValue: { planName: newPlan.name },
    triggeredBy: `admin:${triggeredBy}`,
  });

  revalidatePath("/admin/billing");
}

/** Suspends a tenant (blocks all access, keeps data). */
export async function suspendTenant(tenantId: string, adminId: string) {
  await requireAdminPanelAccess();

  const previous = await platformDb.query.billingSubscriptions.findFirst({
    where: eq(billingSubscriptions.tenantId, tenantId),
  });

  await platformDb
    .update(billingSubscriptions)
    .set({ status: "suspended", updatedAt: new Date() })
    .where(eq(billingSubscriptions.tenantId, tenantId));

  invalidateEntitlementCache(tenantId);

  await logEntitlementChange({
    tenantId,
    eventType: "suspended",
    previousValue: { status: previous?.status },
    newValue: { status: "suspended" },
    triggeredBy: `admin:${adminId}`,
  });

  revalidatePath("/admin/billing");
}

/** Reactivates a suspended tenant to their previous plan or free. */
export async function reactivateTenant(tenantId: string, adminId: string) {
  await requireAdminPanelAccess();

  const sub = await platformDb.query.billingSubscriptions.findFirst({
    where: eq(billingSubscriptions.tenantId, tenantId),
  });

  // Verify the Stripe subscription is still active before trusting our local record.
  // This prevents marking a tenant "active" when Stripe canceled the sub but a webhook was missed.
  let newStatus = "free";
  if (sub?.stripeSubscriptionId) {
    try {
      const stripeSub = await getStripe().subscriptions.retrieve(sub.stripeSubscriptionId);
      if (["active", "trialing", "past_due"].includes(stripeSub.status)) {
        newStatus = stripeSub.status === "trialing" ? "trialing" : "active";
      } else {
        // Stripe sub is gone — clear the stale reference
        await platformDb
          .update(billingSubscriptions)
          .set({ stripeSubscriptionId: null, stripeSubscriptionItemId: null })
          .where(eq(billingSubscriptions.tenantId, tenantId));
      }
    } catch {
      // Stripe lookup failed — default to free to be safe
    }
  }

  await platformDb
    .update(billingSubscriptions)
    .set({ status: newStatus, gracePeriodEnd: null, updatedAt: new Date() })
    .where(eq(billingSubscriptions.tenantId, tenantId));

  invalidateEntitlementCache(tenantId);

  await logEntitlementChange({
    tenantId,
    eventType: "reactivated",
    previousValue: { status: "suspended" },
    newValue: { status: newStatus },
    triggeredBy: `admin:${adminId}`,
  });

  revalidatePath("/admin/billing");
}

/** Downgrades a tenant to Free plan (clears Stripe subscription, removes add-ons). */
export async function downgradeToFree(tenantId: string, adminId: string) {
  await requireAdminPanelAccess();

  const sub = await platformDb.query.billingSubscriptions.findFirst({
    where: eq(billingSubscriptions.tenantId, tenantId),
  });

  // Cancel Stripe subscription if it exists
  if (sub?.stripeSubscriptionId) {
    await getStripe()
      .subscriptions.cancel(sub.stripeSubscriptionId)
      .catch(() => {
        /* best-effort: local record is authoritative */
      });
  }

  // Remove all active add-ons
  await platformDb
    .update(billingTenantAddons)
    .set({ status: "canceled", updatedAt: new Date() })
    .where(and(eq(billingTenantAddons.tenantId, tenantId), eq(billingTenantAddons.status, "active")));

  // Reset to free plan
  await platformDb
    .update(billingSubscriptions)
    .set({
      planId: null,
      status: "free",
      stripeSubscriptionId: null,
      stripeSubscriptionItemId: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      trialEnd: null,
      gracePeriodEnd: null,
      updatedAt: new Date(),
    })
    .where(eq(billingSubscriptions.tenantId, tenantId));

  invalidateEntitlementCache(tenantId);

  await logEntitlementChange({
    tenantId,
    eventType: "plan_changed",
    previousValue: { planId: sub?.planId, status: sub?.status },
    newValue: { planName: "free", status: "free" },
    triggeredBy: `admin:${adminId}`,
  });

  revalidatePath("/admin/billing");
}

/**
 * Admin-UI: manually assign any plan to a tenant.
 * Self-contained (single auth check, all validation inline).
 * Handles free-plan downgrade vs. paid plan change.
 */
export async function adminSetTenantPlan(tenantId: string, planId: string) {
  const session = await requireAdminPanelAccess();

  if (!UUID_RE.test(tenantId)) throw new Error("Invalid tenant ID format");
  if (!UUID_RE.test(planId)) throw new Error("Invalid plan ID format");

  const [tenant, plan] = await Promise.all([
    platformDb.query.tenants.findFirst({ where: eq(tenants.id, tenantId) }),
    platformDb.query.billingPlans.findFirst({ where: eq(billingPlans.id, planId) }),
  ]);
  if (!tenant) throw new Error("Tenant not found");
  if (!plan) throw new Error("Plan not found");
  if (!plan.isActive) throw new Error("Cannot assign an inactive plan");

  const adminId = session.user.id ?? "unknown";

  const previousSub = await platformDb.query.billingSubscriptions.findFirst({
    where: eq(billingSubscriptions.tenantId, tenantId),
    with: { plan: true },
  });

  if (!previousSub) {
    // Tenant predates billing — provision the subscription row now
    await platformDb.insert(billingSubscriptions).values({
      tenantId,
      planId: isFreePlan(plan) ? null : planId,
      status: isFreePlan(plan) ? "free" : "active",
    });
  } else if (isFreePlan(plan)) {
    // Cancel any active Stripe subscription
    if (previousSub.stripeSubscriptionId) {
      await getStripe()
        .subscriptions.cancel(previousSub.stripeSubscriptionId)
        .catch(() => {
          /* best-effort: local record is authoritative */
        });
    }
    // Remove active add-ons
    await platformDb
      .update(billingTenantAddons)
      .set({ status: "canceled", updatedAt: new Date() })
      .where(and(eq(billingTenantAddons.tenantId, tenantId), eq(billingTenantAddons.status, "active")));

    await platformDb
      .update(billingSubscriptions)
      .set({
        planId: null,
        status: "free",
        stripeSubscriptionId: null,
        stripeSubscriptionItemId: null,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        trialEnd: null,
        gracePeriodEnd: null,
        canceledAt: null,
        updatedAt: new Date(),
      })
      .where(eq(billingSubscriptions.tenantId, tenantId));
  } else {
    await platformDb
      .update(billingSubscriptions)
      .set({
        planId,
        status: "active",
        gracePeriodEnd: null,
        canceledAt: null,
        updatedAt: new Date(),
      })
      .where(eq(billingSubscriptions.tenantId, tenantId));
  }

  invalidateEntitlementCache(tenantId);

  await logEntitlementChange({
    tenantId,
    eventType: "plan_changed",
    previousValue: { planName: previousSub?.plan?.name ?? "free" },
    newValue: { planName: plan.name },
    triggeredBy: `admin:${adminId}`,
  });

  revalidatePath("/admin/tenants");
  revalidatePath("/admin/billing");
}

/**
 * Re-syncs a tenant's subscription from Stripe, discarding any manual override.
 * If no Stripe subscription exists, resets to free.
 */
export async function adminSyncTenantSubscription(tenantId: string) {
  const session = await requireAdminPanelAccess();

  if (!UUID_RE.test(tenantId)) throw new Error("Invalid tenant ID format");

  const tenant = await platformDb.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
  });
  if (!tenant) throw new Error("Tenant not found");

  const adminId = session.user.id ?? "unknown";

  const sub = await platformDb.query.billingSubscriptions.findFirst({
    where: eq(billingSubscriptions.tenantId, tenantId),
    with: { plan: true },
  });

  if (!sub?.stripeSubscriptionId) {
    // No Stripe subscription on record — reset to free
    const resetValues = {
      planId: null as string | null,
      status: "free",
      gracePeriodEnd: null as Date | null,
      canceledAt: null as Date | null,
      updatedAt: new Date(),
    };
    if (sub) {
      await platformDb.update(billingSubscriptions).set(resetValues).where(eq(billingSubscriptions.tenantId, tenantId));
    } else {
      await platformDb.insert(billingSubscriptions).values({ tenantId, status: "free" });
    }

    invalidateEntitlementCache(tenantId);
    await logEntitlementChange({
      tenantId,
      eventType: "plan_changed",
      previousValue: { planName: sub?.plan?.name ?? "free" },
      newValue: { planName: "free" },
      triggeredBy: `admin:${adminId}:stripe_sync`,
    });

    revalidatePath("/admin/tenants");
    revalidatePath("/admin/billing");
    return;
  }

  // Retrieve the live subscription from Stripe
  const stripeSub = await getStripe().subscriptions.retrieve(sub.stripeSubscriptionId);

  // Resolve our plan by matching the Stripe price ID
  let planId: string | null = null;
  const priceId = stripeSub.items.data[0]?.price?.id;
  if (priceId) {
    const matched = await platformDb.query.billingPlans.findFirst({
      where: or(eq(billingPlans.stripePriceMonthlyId, priceId), eq(billingPlans.stripePriceAnnualId, priceId)),
    });
    if (matched) planId = matched.id;
  }

  // Map Stripe status → our status
  const statusMap: Record<string, string> = {
    active: "active",
    trialing: "trialing",
    past_due: "past_due",
    canceled: "canceled",
    unpaid: "past_due",
    incomplete: "past_due",
    incomplete_expired: "canceled",
    paused: "suspended",
  };
  const newStatus = statusMap[stripeSub.status] ?? stripeSub.status;

  // Detect billing cycle from the Stripe price interval
  const interval = stripeSub.items.data[0]?.price?.recurring?.interval;
  const billingCycle = interval === "year" ? "annual" : "monthly";

  const raw = stripeSub as unknown as {
    current_period_start?: number;
    current_period_end?: number;
  };

  await platformDb
    .update(billingSubscriptions)
    .set({
      planId,
      status: newStatus,
      billingCycle,
      quantity: stripeSub.items.data[0]?.quantity ?? 1,
      currentPeriodStart: raw.current_period_start ? new Date(raw.current_period_start * 1000) : null,
      currentPeriodEnd: raw.current_period_end ? new Date(raw.current_period_end * 1000) : null,
      trialEnd: stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000) : null,
      canceledAt: stripeSub.canceled_at ? new Date(stripeSub.canceled_at * 1000) : null,
      gracePeriodEnd: null,
      updatedAt: new Date(),
    })
    .where(eq(billingSubscriptions.tenantId, tenantId));

  invalidateEntitlementCache(tenantId);

  await logEntitlementChange({
    tenantId,
    eventType: "plan_changed",
    previousValue: { planName: sub.plan?.name ?? "free" },
    newValue: { planName: planId ?? "free", status: newStatus },
    triggeredBy: `admin:${adminId}:stripe_sync`,
  });

  revalidatePath("/admin/tenants");
  revalidatePath("/admin/billing");
}

// ─── Reporting metrics ────────────────────────────────────────────────────────

export async function getAdminMetrics() {
  await requireAdminPanelAccess();

  // Fetch subscriptions, plan definitions, and active add-ons in parallel.
  const [allSubs, plans, activeAddons] = await Promise.all([
    platformDb
      .select({
        status: billingSubscriptions.status,
        planId: billingSubscriptions.planId,
        billingCycle: billingSubscriptions.billingCycle,
        quantity: billingSubscriptions.quantity,
      })
      .from(billingSubscriptions),

    platformDb.select().from(billingPlans),

    // Add-on MRR: join with the parent subscription to resolve billing cycle,
    // restricted to subscriptions that are still generating revenue.
    platformDb
      .select({
        addonType: billingTenantAddons.addonType,
        quantity: billingTenantAddons.quantity,
        billingCycle: billingSubscriptions.billingCycle,
      })
      .from(billingTenantAddons)
      .innerJoin(billingSubscriptions, eq(billingTenantAddons.tenantId, billingSubscriptions.tenantId))
      .where(
        and(eq(billingTenantAddons.status, "active"), inArray(billingSubscriptions.status, ["active", "past_due"])),
      ),
  ]);

  const planMap = Object.fromEntries(plans.map((p) => [p.id, p]));

  let mrr = 0;
  // activeCount: only status="active" — does NOT include past_due.
  // past_due still contributes to MRR (revenue is billed/owed) but must not
  // inflate the "Active" tenant counter shown in the dashboard.
  let activeCount = 0;
  let trialCount = 0;
  let pastDueCount = 0;
  let suspendedCount = 0;
  let canceledCount = 0;
  let freeCount = 0;

  const perPlan: Record<string, { count: number; mrr: number }> = {};

  for (const sub of allSubs) {
    if (sub.status === "canceled") {
      canceledCount++;
      continue;
    }
    if (sub.status === "suspended") {
      suspendedCount++;
      continue;
    }
    if (sub.status === "trialing") {
      trialCount++;
      continue;
    }
    if (sub.status === "free") {
      freeCount++;
      continue;
    }

    if (sub.status === "past_due") pastDueCount++;
    if (sub.status === "active") activeCount++;

    // Both active and past_due contribute to MRR (already billed or overdue).
    if (sub.status === "active" || sub.status === "past_due") {
      const plan = sub.planId ? planMap[sub.planId] : null;
      if (plan) {
        const pricePerUser = sub.billingCycle === "annual" ? plan.pricePerUserAnnual : plan.pricePerUserMonthly;
        const subMrr = pricePerUser * sub.quantity;
        mrr += subMrr;

        const key = plan.name;
        if (!perPlan[key]) perPlan[key] = { count: 0, mrr: 0 };
        perPlan[key].count++;
        perPlan[key].mrr += subMrr;
      }
    }
  }

  // Add-on MRR: priceAnnual / priceMonthly are monthly-equivalent cents.
  for (const addon of activeAddons) {
    const config = ADDON_CONFIGS[addon.addonType as AddonType];
    if (!config) continue;
    const addonPrice = addon.billingCycle === "annual" ? config.priceAnnual : config.priceMonthly;
    mrr += addonPrice * addon.quantity;
  }

  const arr = mrr * 12;
  const totalTenants = allSubs.length;

  // Churn rate: fraction of *paid* subscribers who canceled.
  // Excludes free tenants (never paid) from the denominator so the metric
  // reflects actual revenue churn, not growth-stage conversion funnels.
  const paidEver = activeCount + pastDueCount + trialCount + suspendedCount + canceledCount;
  const churnRate = paidEver > 0 ? Math.round((canceledCount / paidEver) * 100) : 0;

  // ARPU: MRR divided by all currently-paying accounts (active + past_due).
  const payingCount = activeCount + pastDueCount;
  const arpu = payingCount > 0 ? Math.round(mrr / payingCount) : 0;

  return {
    mrr, // cents
    arr, // cents
    arpu, // cents
    churnRate, // percent
    activeCount,
    trialCount,
    pastDueCount,
    suspendedCount,
    canceledCount,
    freeCount,
    totalTenants,
    perPlan,
  };
}
