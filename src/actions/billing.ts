"use server";

/**
 * Billing Server Actions — tenant self-service.
 * Called from /dashboard/settings/billing pages.
 */

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { eq, and, desc } from "drizzle-orm";
import { platformDb } from "@/db";
import {
  tenants,
  tenantMembers,
  billingSubscriptions,
  billingPlans,
  billingTenantAddons,
} from "@/db/schema";
import { getStripe } from "@/lib/billing/stripe";
import {
  getEntitlements,
  invalidateEntitlementCache,
  logEntitlementChange,
} from "@/lib/billing/licensing";
import { getAllUsage } from "@/lib/billing/usage";
import { getCurrentSubdomain } from "@/lib/tenant-context";
import { getTenantBySubdomain } from "@/lib/get-tenant";
import type { BillingCycle, AddonType } from "@/lib/billing/plans-config";
import { ADDON_CONFIGS } from "@/lib/billing/plans-config";

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function requireBillingAdmin() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/v1/login");

  const subdomain = await getCurrentSubdomain();
  if (!subdomain) throw new Error("No tenant context");

  const tenant = await getTenantBySubdomain(subdomain);
  if (!tenant) throw new Error("Tenant not found");

  // Only owner or admin can manage billing
  const member = await platformDb.query.tenantMembers.findFirst({
    where: and(
      eq(tenantMembers.tenantId, tenant.id),
      eq(tenantMembers.userId, session.user.id),
    ),
  });
  if (!member || !["owner", "admin"].includes(member.role)) {
    throw new Error("Only admins can manage billing.");
  }

  return { session, tenant };
}

// ─── Get or create Stripe customer ───────────────────────────────────────────

async function getOrCreateStripeCustomer(tenantId: string, tenantName: string): Promise<string> {
  const sub = await platformDb.query.billingSubscriptions.findFirst({
    where: eq(billingSubscriptions.tenantId, tenantId),
  });

  if (sub?.stripeCustomerId) return sub.stripeCustomerId;

  const customer = await getStripe().customers.create({
    name: tenantName,
    metadata: { tenantId },
  });

  if (sub) {
    await platformDb
      .update(billingSubscriptions)
      .set({ stripeCustomerId: customer.id, updatedAt: new Date() })
      .where(eq(billingSubscriptions.id, sub.id));
  } else {
    await platformDb.insert(billingSubscriptions).values({
      tenantId,
      status: "free",
      stripeCustomerId: customer.id,
    });
  }

  return customer.id;
}

// ─── Public actions ───────────────────────────────────────────────────────────

/** Returns the current subscription details with plan and add-ons. */
export async function getSubscriptionDetails() {
  const { tenant } = await requireBillingAdmin();

  const sub = await platformDb.query.billingSubscriptions.findFirst({
    where: eq(billingSubscriptions.tenantId, tenant.id),
    with: { plan: true },
  });

  const addons = await platformDb
    .select()
    .from(billingTenantAddons)
    .where(
      and(
        eq(billingTenantAddons.tenantId, tenant.id),
        eq(billingTenantAddons.status, "active"),
      ),
    );

  const entitlements = await getEntitlements(tenant.id);
  const usage = await getAllUsage(tenant.id);

  return { subscription: sub, addons, entitlements, usage };
}

/** Returns all public plans for the plan selector. */
export async function getPublicPlans() {
  return platformDb
    .select()
    .from(billingPlans)
    .where(and(eq(billingPlans.isActive, true), eq(billingPlans.isPublic, true)));
}

/** Creates a Stripe Checkout Session and returns the redirect URL. */
export async function createCheckoutSession(
  planId: string,
  billingCycle: BillingCycle,
  userCount: number,
): Promise<{ url: string }> {
  const { tenant } = await requireBillingAdmin();

  const plan = await platformDb.query.billingPlans.findFirst({
    where: eq(billingPlans.id, planId),
  });
  if (!plan) throw new Error("Plan not found");

  const priceId =
    billingCycle === "annual" ? plan.stripePriceAnnualId : plan.stripePriceMonthlyId;
  if (!priceId) throw new Error("This plan has no Stripe price configured yet.");

  const customerId = await getOrCreateStripeCustomer(tenant.id, tenant.name);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const returnBase = `${appUrl}/dashboard/settings/billing`;

  const session = await getStripe().checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: Math.max(userCount, plan.minUsers) }],
    subscription_data: {
      trial_period_days: plan.trialDays > 0 ? plan.trialDays : undefined,
      metadata: { tenantId: tenant.id, planId: plan.id, billingCycle },
    },
    success_url: `${returnBase}?session_id={CHECKOUT_SESSION_ID}&success=1`,
    cancel_url: `${returnBase}?canceled=1`,
    metadata: { tenantId: tenant.id, planId: plan.id },
  });

  return { url: session.url! };
}

/** Creates a Stripe Billing Portal session for self-service subscription management. */
export async function createBillingPortalSession(): Promise<{ url: string }> {
  const { tenant } = await requireBillingAdmin();

  const sub = await platformDb.query.billingSubscriptions.findFirst({
    where: eq(billingSubscriptions.tenantId, tenant.id),
  });
  if (!sub?.stripeCustomerId) throw new Error("No Stripe customer found.");

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const session = await getStripe().billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: `${appUrl}/dashboard/settings/billing`,
  });

  return { url: session.url };
}

/** Returns the last 24 invoices from Stripe for the current tenant. */
export async function getInvoices() {
  const { tenant } = await requireBillingAdmin();

  const sub = await platformDb.query.billingSubscriptions.findFirst({
    where: eq(billingSubscriptions.tenantId, tenant.id),
  });
  if (!sub?.stripeCustomerId) return [];

  const invoices = await getStripe().invoices.list({
    customer: sub.stripeCustomerId,
    limit: 24,
  });

  return invoices.data.map((inv) => ({
    id: inv.id,
    number: inv.number,
    status: inv.status,
    amountDue: inv.amount_due,
    amountPaid: inv.amount_paid,
    currency: inv.currency,
    periodStart: inv.period_start,
    periodEnd: inv.period_end,
    hostedInvoiceUrl: inv.hosted_invoice_url,
    invoicePdf: inv.invoice_pdf,
    created: inv.created,
  }));
}

/** Adds an add-on to the active Stripe subscription. */
export async function addAddon(
  addonType: AddonType,
  quantity: number,
  billingCycle: BillingCycle = "monthly",
): Promise<void> {
  const { tenant } = await requireBillingAdmin();

  // Validate addonType against the canonical config — never accept a caller-supplied price ID
  const addonCfg = ADDON_CONFIGS[addonType];
  if (!addonCfg) throw new Error(`Unknown add-on type: ${addonType}`);

  const sub = await platformDb.query.billingSubscriptions.findFirst({
    where: eq(billingSubscriptions.tenantId, tenant.id),
  });
  if (!sub?.stripeSubscriptionId) throw new Error("No active subscription found.");

  // Look up the Stripe price from the plan's configured extra-user price (for extra_users)
  // or from the subscription's plan record for module add-ons.
  const plan = sub.planId
    ? await platformDb.query.billingPlans.findFirst({
        where: eq(billingPlans.id, sub.planId),
      })
    : null;

  let stripePriceId: string | null = null;
  if (addonType === "extra_users" && plan) {
    stripePriceId =
      billingCycle === "annual"
        ? plan.stripeExtraUserAnnualPriceId
        : plan.stripeExtraUserMonthlyPriceId;
  }

  if (!stripePriceId) {
    throw new Error(
      `No Stripe price configured for add-on "${addonType}". Please map it in the admin panel.`,
    );
  }

  // Add as a new line item on the Stripe subscription
  const item = await getStripe().subscriptionItems.create({
    subscription: sub.stripeSubscriptionId,
    price: stripePriceId,
    quantity,
  });

  await platformDb.insert(billingTenantAddons).values({
    tenantId: tenant.id,
    addonType,
    quantity,
    stripeSubscriptionItemId: item.id,
    stripePriceId,
    status: "active",
  });

  invalidateEntitlementCache(tenant.id);

  await logEntitlementChange({
    tenantId: tenant.id,
    eventType: "addon_added",
    newValue: { addonType, quantity },
    triggeredBy: `admin`,
  });
}

/** Removes an active add-on from the Stripe subscription. */
export async function removeAddon(addonId: string): Promise<void> {
  const { tenant } = await requireBillingAdmin();

  const addon = await platformDb.query.billingTenantAddons.findFirst({
    where: and(
      eq(billingTenantAddons.id, addonId),
      eq(billingTenantAddons.tenantId, tenant.id),
    ),
  });
  if (!addon) throw new Error("Add-on not found.");

  if (addon.stripeSubscriptionItemId) {
    await getStripe().subscriptionItems.del(addon.stripeSubscriptionItemId, {
      proration_behavior: "create_prorations",
    });
  }

  await platformDb
    .update(billingTenantAddons)
    .set({ status: "canceled", updatedAt: new Date() })
    .where(eq(billingTenantAddons.id, addonId));

  invalidateEntitlementCache(tenant.id);

  await logEntitlementChange({
    tenantId: tenant.id,
    eventType: "addon_removed",
    previousValue: { addonType: addon.addonType, quantity: addon.quantity },
    triggeredBy: `admin`,
  });
}

/** Returns usage dashboard data for the current tenant. */
export async function getUsageDashboard() {
  const { tenant } = await requireBillingAdmin();
  const usage = await getAllUsage(tenant.id);
  const entitlements = await getEntitlements(tenant.id);
  return { usage, entitlements };
}
