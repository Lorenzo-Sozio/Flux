/**
 * auth-guard.ts
 * Server-side helpers to enforce role-based access in Server Actions.
 * Call these at the top of any mutation action.
 */
import { auth } from "@/auth";
import { getAdminSession } from "@/lib/admin-session";
import { assertLimit, EntitlementError, getEntitlements, requireModule } from "@/lib/billing/licensing";
import type { PlanLimits, PlanModule } from "@/lib/billing/plans-config";
import { getTenantById } from "@/lib/get-tenant";
import { getCurrentTenantId } from "@/lib/tenant-context";

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
 * Used for privileged CRM operations within a tenant: user management, webhooks, custom fields, settings.
 * Does NOT verify the admin panel 2FA cookie — use requireAdminPanelAccess() for /admin/* server actions.
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
 * Verifies the admin_sess HMAC cookie (independent of the customer NextAuth session).
 * Use this in every /admin/* server action.
 * Returns { user: { id, role } } so callers can log the acting admin's identity.
 */
export async function requireAdminPanelAccess(): Promise<{ user: { id: string; role: string } }> {
  const adminSession = await getAdminSession();
  if (!adminSession || (adminSession.role !== "admin" && adminSession.role !== "owner")) {
    throw new ForbiddenError("Admin panel authentication required. Please log in at /admin/login.");
  }
  return { user: { id: adminSession.userId, role: adminSession.role } };
}

/**
 * Returns the current tenant's entitlements.
 * Returns null when called outside a tenant context (e.g., admin panel).
 */
export async function getTenantEntitlements() {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) return null;

  const tenant = await getTenantById(tenantId);
  if (!tenant) return null;

  return getEntitlements(tenant.id);
}

/**
 * Requires the tenant's subscription to be active (not suspended/canceled).
 * Call at the top of any action that requires a paid or free plan to be operational.
 */
export async function requireActiveSubscription() {
  const ent = await getTenantEntitlements();
  if (!ent) return; // outside tenant context — no subscription check

  if (ent.isSuspended) {
    throw new ForbiddenError("Your account is suspended. Please contact support to reactivate.");
  }
  if (!ent.isActive) {
    throw new ForbiddenError("Your subscription is inactive. Please update your billing details.");
  }
}

/**
 * Requires that a specific module is enabled on the tenant's plan.
 * Usage: await requirePlanModule("marketing");
 */
export async function requirePlanModule(module: PlanModule) {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) return; // outside tenant context

  const tenant = await getTenantById(tenantId);
  if (!tenant) return;

  await requireModule(tenant.id, module);
}

/**
 * Asserts a quantitative plan limit hasn't been reached.
 * Usage: await requirePlanLimit("maxRecords", currentCount);
 */
export async function requirePlanLimit(metric: keyof PlanLimits, currentValue: number) {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) return; // outside tenant context

  const tenant = await getTenantById(tenantId);
  if (!tenant) return;

  await assertLimit(tenant.id, metric, currentValue);
}
