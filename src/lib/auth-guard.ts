/**
 * auth-guard.ts
 * Server-side helpers to enforce role-based access in Server Actions.
 * Call these at the top of any mutation action.
 */
import { auth } from "@/auth";
import { getCurrentSubdomain } from "@/lib/tenant-context";
import { getTenantBySubdomain } from "@/lib/get-tenant";
import {
  getEntitlements,
  EntitlementError,
  requireModule,
  assertLimit,
} from "@/lib/billing/licensing";
import type { PlanModule, PlanLimits } from "@/lib/billing/plans-config";

export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to perform this action.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

// Re-export for convenience
export { EntitlementError, requireModule, assertLimit };

/** Returns the current session or throws if unauthenticated. */
async function getSessionOrThrow() {
  const session = await auth();
  if (!session?.user?.id) throw new ForbiddenError("You must be logged in.");
  return session;
}

/**
 * Requires at least "user" role.
 * Viewers are read-only and cannot mutate any record.
 */
export async function requireWriteAccess() {
  const session = await getSessionOrThrow();
  const role = session.user.role as string | undefined;
  if (role === "viewer") {
    throw new ForbiddenError("Viewers cannot make changes.");
  }
  return session;
}

/**
 * Requires "admin" or "owner" role.
 * Used for privileged operations: user management, webhooks, custom fields, settings.
 */
export async function requireAdminAccess() {
  const session = await getSessionOrThrow();
  const role = session.user.role as string | undefined;
  if (role !== "admin" && role !== "owner") {
    throw new ForbiddenError("Only administrators can perform this action.");
  }
  return session;
}

/**
 * Returns the current tenant's entitlements.
 * Throws if no tenant context is found (i.e., called from main domain).
 */
export async function getTenantEntitlements() {
  const subdomain = await getCurrentSubdomain();
  if (!subdomain) return null;

  const tenant = await getTenantBySubdomain(subdomain);
  if (!tenant) return null;

  return getEntitlements(tenant.id);
}

/**
 * Requires the tenant's subscription to be active (not suspended/canceled).
 * Call at the top of any action that requires a paid or free plan to be operational.
 */
export async function requireActiveSubscription() {
  const ent = await getTenantEntitlements();
  if (!ent) return; // main domain — no subscription context

  if (ent.isSuspended) {
    throw new ForbiddenError(
      "Your account is suspended. Please contact support to reactivate.",
    );
  }
  if (!ent.isActive) {
    throw new ForbiddenError(
      "Your subscription is inactive. Please update your billing details.",
    );
  }
}

/**
 * Requires that a specific module is enabled on the tenant's plan.
 * Usage: await requirePlanModule("marketing");
 */
export async function requirePlanModule(module: PlanModule) {
  const subdomain = await getCurrentSubdomain();
  if (!subdomain) return; // main domain

  const tenant = await getTenantBySubdomain(subdomain);
  if (!tenant) return;

  await requireModule(tenant.id, module);
}

/**
 * Asserts a quantitative plan limit hasn't been reached.
 * Usage: await requirePlanLimit("maxRecords", currentCount);
 */
export async function requirePlanLimit(metric: keyof PlanLimits, currentValue: number) {
  const subdomain = await getCurrentSubdomain();
  if (!subdomain) return;

  const tenant = await getTenantBySubdomain(subdomain);
  if (!tenant) return;

  await assertLimit(tenant.id, metric, currentValue);
}
