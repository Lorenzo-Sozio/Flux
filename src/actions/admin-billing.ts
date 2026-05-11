"use server";

/**
 * Admin Billing Server Actions — platform-level management.
 * Called from /admin/billing pages.
 * Requires platform admin/owner session (no tenant subdomain needed).
 */

import { auth } from "@/auth";
import { eq, desc, and, gte, lte, count, sql, isNotNull, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { platformDb } from "@/db";
import {
  tenants,
  billingPlans,
  billingSubscriptions,
  billingTenantAddons,
  billingUsageStats,
} from "@/db/schema";
import { getStripe } from "@/lib/billing/stripe";
import {
  invalidateEntitlementCache,
  logEntitlementChange,
} from "@/lib/billing/licensing";
import { PLAN_CONFIGS } from "@/lib/billing/plans-config";

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function requirePlatformAdmin() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  const role = (session.user as { role?: string }).role;
  if (role !== "admin" && role !== "owner") throw new Error("Platform admin required");
  return session;
}

// ─── Plans CRUD ───────────────────────────────────────────────────────────────

export async function listPlans() {
  await requirePlatformAdmin();
  return platformDb
    .select()
    .from(billingPlans)
    .orderBy(billingPlans.sortOrder);
}

export async function getPlan(id: string) {
  await requirePlatformAdmin();
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
  limits: string;          // JSON string
  enabledModules: string;  // JSON string array
  supportTier: string;
  hasWhiteLabel: boolean;
  hasSandbox: boolean;
  isActive: boolean;
  isPublic: boolean;
  sortOrder: number;
  isCustom: boolean;
}

export async function createPlan(input: UpsertPlanInput) {
  await requirePlatformAdmin();
  const [plan] = await platformDb
    .insert(billingPlans)
    .values({ ...input, maxUsers: input.maxUsers ?? null })
    .returning();
  revalidatePath("/admin/billing");
  revalidatePath("/admin/plans");
  return plan;
}

export async function updatePlan(id: string, input: Partial<UpsertPlanInput>) {
  await requirePlatformAdmin();
  await platformDb
    .update(billingPlans)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(billingPlans.id, id));
  revalidatePath("/admin/billing");
  revalidatePath("/admin/plans");
}

export async function deletePlan(id: string) {
  await requirePlatformAdmin();
  // Soft delete
  await platformDb
    .update(billingPlans)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(billingPlans.id, id));
  revalidatePath("/admin/plans");
}

/**
 * Seeds the default Free/Basic/Professional/Enterprise plans.
 * Safe to call multiple times — uses INSERT … ON CONFLICT DO NOTHING logic
 * by checking name existence first.
 */
export async function seedDefaultPlans() {
  await requirePlatformAdmin();

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

export async function listSubscriptions(filters?: {
  status?: string;
  planId?: string;
}) {
  await requirePlatformAdmin();

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
  await requirePlatformAdmin();
  return platformDb.query.billingSubscriptions.findFirst({
    where: eq(billingSubscriptions.tenantId, tenantId),
    with: { plan: true, addons: true },
  });
}

/** Manual admin upgrade/downgrade (immediate, no proration via Stripe). */
export async function manualChangePlan(tenantId: string, planId: string, triggeredBy: string) {
  await requirePlatformAdmin();

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
  await requirePlatformAdmin();

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
  await requirePlatformAdmin();

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
  await requirePlatformAdmin();

  const sub = await platformDb.query.billingSubscriptions.findFirst({
    where: eq(billingSubscriptions.tenantId, tenantId),
  });

  // Cancel Stripe subscription if it exists
  if (sub?.stripeSubscriptionId) {
    await getStripe().subscriptions.cancel(sub.stripeSubscriptionId).catch(() => {});
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

// ─── Reporting metrics ────────────────────────────────────────────────────────

export async function getAdminMetrics() {
  await requirePlatformAdmin();

  const allSubs = await platformDb
    .select({
      status: billingSubscriptions.status,
      planId: billingSubscriptions.planId,
      billingCycle: billingSubscriptions.billingCycle,
      quantity: billingSubscriptions.quantity,
      currency: billingSubscriptions.currency,
    })
    .from(billingSubscriptions);

  const plans = await platformDb.select().from(billingPlans);
  const planMap = Object.fromEntries(plans.map((p) => [p.id, p]));

  let mrr = 0;
  let activeCount = 0;
  let trialCount = 0;
  let pastDueCount = 0;
  let suspendedCount = 0;
  let canceledCount = 0;

  const perPlan: Record<string, { count: number; mrr: number }> = {};

  for (const sub of allSubs) {
    if (sub.status === "canceled") { canceledCount++; continue; }
    if (sub.status === "suspended") { suspendedCount++; continue; }
    if (sub.status === "trialing") { trialCount++; continue; } // trials have not paid; exclude from MRR
    if (sub.status === "past_due") { pastDueCount++; }
    // Only active and past_due subs count toward MRR (revenue already billed/owed)
    if (["active", "past_due"].includes(sub.status)) {
      activeCount++;
      const plan = sub.planId ? planMap[sub.planId] : null;
      if (plan) {
        const pricePerUser =
          sub.billingCycle === "annual"
            ? plan.pricePerUserAnnual
            : plan.pricePerUserMonthly;
        const subMrr = pricePerUser * sub.quantity;
        mrr += subMrr;

        const key = plan.name;
        if (!perPlan[key]) perPlan[key] = { count: 0, mrr: 0 };
        perPlan[key].count++;
        perPlan[key].mrr += subMrr;
      }
    }
  }

  const arr = mrr * 12;
  const totalTenants = allSubs.length;
  const churnRate = totalTenants > 0 ? Math.round((canceledCount / totalTenants) * 100) : 0;
  const arpu = activeCount > 0 ? Math.round(mrr / activeCount) : 0;

  return {
    mrr,          // cents
    arr,          // cents
    arpu,         // cents
    churnRate,    // percent
    activeCount,
    trialCount,
    pastDueCount,
    suspendedCount,
    canceledCount,
    totalTenants,
    perPlan,
  };
}
