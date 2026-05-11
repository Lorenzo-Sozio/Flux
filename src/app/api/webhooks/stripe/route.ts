/**
 * Stripe Webhook Handler
 *
 * Security: verifies Stripe-Signature using STRIPE_WEBHOOK_SECRET.
 * Idempotency: each event is stored in billing_stripe_events; already-processed
 * events return 200 immediately.
 *
 * Events handled:
 *  - checkout.session.completed          → link subscription to tenant
 *  - customer.subscription.created       → sync new subscription
 *  - customer.subscription.updated       → plan/quantity/status changes
 *  - customer.subscription.deleted       → downgrade to free
 *  - invoice.payment_succeeded           → reactivate if past_due
 *  - invoice.payment_failed              → set past_due, start grace period
 */

import { NextRequest, NextResponse } from "next/server";
import { eq, or } from "drizzle-orm";
import { getStripe } from "@/lib/billing/stripe";
import type { Stripe } from "@/lib/billing/stripe";
import { platformDb } from "@/db";
import {
  billingSubscriptions,
  billingPlans,
  billingStripeEvents,
  billingTenantAddons,
} from "@/db/schema";
import {
  invalidateEntitlementCache,
  logEntitlementChange,
} from "@/lib/billing/licensing";
import { GRACE_PERIOD_DAYS } from "@/lib/billing/plans-config";

export const runtime = "nodejs";

// ─── Signature verification ───────────────────────────────────────────────────

async function getRawBody(req: NextRequest): Promise<Buffer> {
  const arr = await req.arrayBuffer();
  return Buffer.from(arr);
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !webhookSecret) {
    return NextResponse.json({ error: "Missing signature or secret" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    const rawBody = await getRawBody(req);
    event = getStripe().webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error("[stripe-webhook] Signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Idempotency: try to claim this event by inserting a new row.
  // onConflictDoNothing returns the inserted rows; an empty result means another
  // worker already claimed it — we bail immediately to avoid double-processing.
  const inserted = await platformDb
    .insert(billingStripeEvents)
    .values({
      id: event.id,
      type: event.type,
      payload: JSON.stringify(event.data.object),
      createdAt: new Date(event.created * 1000),
    })
    .onConflictDoNothing()
    .returning({ id: billingStripeEvents.id });

  if (inserted.length === 0) {
    // Row already exists — either fully processed or being processed concurrently.
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    await handleEvent(event);

    await platformDb
      .update(billingStripeEvents)
      .set({ processedAt: new Date() })
      .where(eq(billingStripeEvents.id, event.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[stripe-webhook] Error processing ${event.type}:`, message);

    await platformDb
      .update(billingStripeEvents)
      .set({ error: message })
      .where(eq(billingStripeEvents.id, event.id));

    // Return 500 so Stripe retries
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

// ─── Event router ─────────────────────────────────────────────────────────────

async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      await onCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
      await onSubscriptionUpserted(event.data.object as Stripe.Subscription);
      break;
    case "customer.subscription.deleted":
      await onSubscriptionDeleted(event.data.object as Stripe.Subscription);
      break;
    case "invoice.payment_succeeded":
      await onPaymentSucceeded(event.data.object as Stripe.Invoice);
      break;
    case "invoice.payment_failed":
      await onPaymentFailed(event.data.object as Stripe.Invoice);
      break;
    default:
      // Unhandled event — no-op
      break;
  }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function onCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  if (session.mode !== "subscription") return;

  const tenantId = session.metadata?.tenantId;
  const planId = session.metadata?.planId;
  if (!tenantId) return;

  // The subscription.created event will carry the full data;
  // here we just ensure the stripeCustomerId is persisted.
  const customerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id;

  if (customerId) {
    const existing = await platformDb.query.billingSubscriptions.findFirst({
      where: eq(billingSubscriptions.tenantId, tenantId),
    });
    if (existing) {
      await platformDb
        .update(billingSubscriptions)
        .set({ stripeCustomerId: customerId, updatedAt: new Date() })
        .where(eq(billingSubscriptions.tenantId, tenantId));
    }
  }
}

async function onSubscriptionUpserted(subscription: Stripe.Subscription): Promise<void> {
  const tenantId = subscription.metadata?.tenantId;
  if (!tenantId) return;

  // Prefer planId from metadata (set at checkout). For Billing Portal updates
  // where metadata may be stale or absent, fall back to matching by Stripe price ID.
  let planId = subscription.metadata?.planId || null;
  const billingCycle = subscription.metadata?.billingCycle ?? "monthly";

  if (!planId) {
    const priceId = subscription.items.data[0]?.price?.id;
    if (priceId) {
      const planByPrice = await platformDb.query.billingPlans.findFirst({
        where: or(
          eq(billingPlans.stripePriceMonthlyId, priceId),
          eq(billingPlans.stripePriceAnnualId, priceId),
        ),
      });
      if (planByPrice) planId = planByPrice.id;
    }
  }

  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id ?? null;

  // Map Stripe status to our status
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
  const newStatus = statusMap[subscription.status] ?? subscription.status;

  const baseItem = subscription.items.data[0];

  const previousSub = await platformDb.query.billingSubscriptions.findFirst({
    where: eq(billingSubscriptions.tenantId, tenantId),
    with: { plan: true },
  });

  await platformDb
    .update(billingSubscriptions)
    .set({
      stripeSubscriptionId: subscription.id,
      stripeCustomerId: customerId ?? undefined,
      stripeSubscriptionItemId: baseItem?.id ?? null,
      planId: planId ?? null,
      status: newStatus,
      billingCycle,
      quantity: subscription.items.data[0]?.quantity ?? 1,
      // current_period_* were renamed in newer Stripe API versions; cast for compatibility
      currentPeriodStart: (subscription as unknown as { current_period_start: number }).current_period_start
        ? new Date((subscription as unknown as { current_period_start: number }).current_period_start * 1000)
        : null,
      currentPeriodEnd: (subscription as unknown as { current_period_end: number }).current_period_end
        ? new Date((subscription as unknown as { current_period_end: number }).current_period_end * 1000)
        : null,
      trialEnd: subscription.trial_end
        ? new Date(subscription.trial_end * 1000)
        : null,
      canceledAt: subscription.canceled_at
        ? new Date(subscription.canceled_at * 1000)
        : null,
      gracePeriodEnd: null, // reset on update
      updatedAt: new Date(),
    })
    .where(eq(billingSubscriptions.tenantId, tenantId));

  invalidateEntitlementCache(tenantId);

  // Only log an audit entry when the plan actually changed
  if (previousSub?.planId !== planId) {
    await logEntitlementChange({
      tenantId,
      eventType: "plan_changed",
      previousValue: { status: previousSub?.status, planId: previousSub?.planId },
      newValue: { status: newStatus, planId },
      triggeredBy: "stripe_webhook",
    });
  }
}

async function onSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  const tenantId = subscription.metadata?.tenantId;
  if (!tenantId) return;

  // Downgrade to free, cancel all add-ons
  await platformDb
    .update(billingTenantAddons)
    .set({ status: "canceled", updatedAt: new Date() })
    .where(eq(billingTenantAddons.tenantId, tenantId));

  const previousSub = await platformDb.query.billingSubscriptions.findFirst({
    where: eq(billingSubscriptions.tenantId, tenantId),
  });

  await platformDb
    .update(billingSubscriptions)
    .set({
      planId: null,
      status: "free",
      stripeSubscriptionId: null,
      stripeSubscriptionItemId: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      canceledAt: new Date(),
      gracePeriodEnd: null,
      updatedAt: new Date(),
    })
    .where(eq(billingSubscriptions.tenantId, tenantId));

  invalidateEntitlementCache(tenantId);

  await logEntitlementChange({
    tenantId,
    eventType: "plan_changed",
    previousValue: { status: previousSub?.status, planId: previousSub?.planId },
    newValue: { status: "free", planName: "free" },
    triggeredBy: "stripe_webhook",
  });
}

async function onPaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
  const customerId =
    typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  if (!customerId) return;

  const sub = await platformDb.query.billingSubscriptions.findFirst({
    where: eq(billingSubscriptions.stripeCustomerId, customerId),
  });
  if (!sub) return;

  // Reactivate if it was past_due or suspended
  if (["past_due", "suspended"].includes(sub.status)) {
    await platformDb
      .update(billingSubscriptions)
      .set({ status: "active", gracePeriodEnd: null, updatedAt: new Date() })
      .where(eq(billingSubscriptions.id, sub.id));

    invalidateEntitlementCache(sub.tenantId);

    await logEntitlementChange({
      tenantId: sub.tenantId,
      eventType: "reactivated",
      previousValue: { status: sub.status },
      newValue: { status: "active" },
      triggeredBy: "stripe_webhook",
    });
  }
}

async function onPaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const customerId =
    typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  if (!customerId) return;

  const sub = await platformDb.query.billingSubscriptions.findFirst({
    where: eq(billingSubscriptions.stripeCustomerId, customerId),
  });
  if (!sub) return;

  const gracePeriodEnd = new Date();
  gracePeriodEnd.setDate(gracePeriodEnd.getDate() + GRACE_PERIOD_DAYS);

  await platformDb
    .update(billingSubscriptions)
    .set({
      status: "past_due",
      gracePeriodEnd,
      updatedAt: new Date(),
    })
    .where(eq(billingSubscriptions.id, sub.id));

  invalidateEntitlementCache(sub.tenantId);

  await logEntitlementChange({
    tenantId: sub.tenantId,
    eventType: "payment_failed",
    previousValue: { status: sub.status },
    newValue: { status: "past_due", gracePeriodEnd: gracePeriodEnd.toISOString() },
    triggeredBy: "stripe_webhook",
  });
}
