/**
 * auth-guard.ts
 * Server-side enforcement of the capability model defined in `permissions.ts`.
 * Call these at the top of any Server Action, route handler or Server Component.
 *
 * The rule that makes this work: **nothing outside this file reads a role
 * directly**. Pages, actions and UI all ask for a capability, so the three
 * layers cannot drift apart — which is exactly what happened before (audit
 * rilievi P-01 → P-06, U-02).
 */
import { auth } from "@/auth";
import { getAdminSession } from "@/lib/admin-session";
import { assertLimit, EntitlementError, getEntitlements, requireModule } from "@/lib/billing/licensing";
import type { PlanLimits, PlanModule } from "@/lib/billing/plans-config";
import { getTenantById } from "@/lib/get-tenant";
import {
  type Actor,
  type Capability,
  can,
  isPlatformStaffRole,
  normalizeTenantRole,
  type TenantRole,
} from "@/lib/permissions";
import { getCurrentTenantId } from "@/lib/tenant-context";

export class ForbiddenError extends Error {
  /** Machine-readable so the client can tell "not allowed" from "network died". */
  readonly code = "FORBIDDEN" as const;
  readonly capability?: Capability;

  constructor(message = "You do not have permission to perform this action.", capability?: Capability) {
    super(message);
    this.name = "ForbiddenError";
    this.capability = capability;
  }
}

export class UnauthenticatedError extends Error {
  readonly code = "UNAUTHENTICATED" as const;

  constructor(message = "You must be signed in to continue.") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

// Re-export for convenience
export { EntitlementError, requireModule, assertLimit };
export type { Actor, Capability, TenantRole };

// ─── Actor resolution ─────────────────────────────────────────────────────────

/**
 * Resolves the current actor from the session, or null when unauthenticated.
 *
 * `tenantRole` is the authority inside the workspace. `isPlatformStaff` is Flux's
 * own staff, granted owner-equivalent data access so support can reproduce
 * customer issues — and nothing more: no product feature may branch on it.
 */
export async function getActor(): Promise<Actor | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const user = session.user as { id: string; role?: string | null; tenantRole?: string | null };

  return {
    userId: session.user.id,
    tenantRole: normalizeTenantRole(user.tenantRole),
    isPlatformStaff: isPlatformStaffRole(user.role),
    name: session.user.name ?? null,
    email: session.user.email ?? null,
  };
}

/** Resolves the current actor or throws. */
export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw new UnauthenticatedError();
  return actor;
}

/**
 * The primary guard. Throws `UnauthenticatedError` when there is no session and
 * `ForbiddenError` when the actor lacks the capability.
 *
 *   await requireCapability("quote:write");
 */
export async function requireCapability(capability: Capability): Promise<Actor> {
  const actor = await requireActor();
  if (!can(actor, capability)) {
    throw new ForbiddenError(FORBIDDEN_MESSAGES[capability] ?? DEFAULT_FORBIDDEN, capability);
  }
  return actor;
}

/** Non-throwing form, for deciding what to render. */
export async function hasCapability(capability: Capability): Promise<boolean> {
  const actor = await getActor();
  return can(actor, capability);
}

/**
 * Messages worth writing by hand, because the generic one leaves the user with
 * nothing to do next. Anything absent falls back to DEFAULT_FORBIDDEN.
 */
const DEFAULT_FORBIDDEN = "You do not have permission to perform this action.";

const FORBIDDEN_MESSAGES: Partial<Record<Capability, string>> = {
  "record:write": "Your role is read-only. Ask a workspace admin for edit access.",
  "record:delete": "Your role is read-only. Ask a workspace admin for edit access.",
  "quote:write": "Your role is read-only. Ask a workspace admin for edit access.",
  "quote:approve": "Only workspace admins can approve quotes.",
  "ticket:write": "Your role is read-only. Ask a workspace admin for edit access.",
  "ticket:delete": "Only workspace admins can delete tickets.",
  "sla:manage": "Only workspace admins can change SLA policies.",
  "settings:manage": "Only workspace admins can change settings.",
  "pipeline:manage": "Only workspace admins can change the pipeline.",
  "customField:manage": "Only workspace admins can manage custom fields.",
  "webhook:manage": "Only workspace admins can manage webhooks.",
  "automation:manage": "Only workspace admins can manage automation rules.",
  "user:manage": "Only workspace admins can manage users.",
  "group:manage": "Only workspace admins can manage groups.",
  "billing:manage": "Only the workspace owner can change the subscription.",
  "report:manage": "Only workspace admins can save or delete shared reports.",
};

// ─── Backwards-compatible aliases ─────────────────────────────────────────────
//
// Dozens of call sites use these two names. They now resolve through the
// capability model, so behaviour is consistent everywhere without a sweeping
// rename. Prefer `requireCapability` in new code — it says what it protects.

/** Requires edit rights within the active workspace. Blocks `viewer`. */
export async function requireWriteAccess() {
  const actor = await requireCapability("record:write");
  return { user: { id: actor.userId, role: actor.tenantRole } };
}

/** Requires workspace `admin` or `owner`. */
export async function requireAdminAccess() {
  const actor = await requireCapability("settings:manage");
  return { user: { id: actor.userId, role: actor.tenantRole } };
}

/**
 * Verifies the admin_sess HMAC cookie (independent of the customer session).
 * Use in every /admin/* server action. This is Flux staff, not a customer role.
 */
export async function requireAdminPanelAccess(): Promise<{ user: { id: string; role: string } }> {
  const adminSession = await getAdminSession();
  if (!adminSession || !isPlatformStaffRole(adminSession.role)) {
    throw new ForbiddenError("Admin panel authentication required. Please sign in at /admin/login.");
  }
  return { user: { id: adminSession.userId, role: adminSession.role } };
}

// ─── Entitlements ─────────────────────────────────────────────────────────────

/** Returns the active tenant's entitlements, or null outside a tenant context. */
export async function getTenantEntitlements() {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) return null;

  const tenant = await getTenantById(tenantId);
  if (!tenant) return null;

  return getEntitlements(tenant.id);
}

/** Requires the subscription to be operational. */
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

/** Requires a module to be included in the tenant's plan. */
export async function requirePlanModule(module: PlanModule) {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) return; // outside tenant context

  const tenant = await getTenantById(tenantId);
  if (!tenant) return;

  await requireModule(tenant.id, module);
}

/** Asserts a quantitative plan limit hasn't been reached. */
export async function requirePlanLimit(metric: keyof PlanLimits, currentValue: number) {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) return; // outside tenant context

  const tenant = await getTenantById(tenantId);
  if (!tenant) return;

  await assertLimit(tenant.id, metric, currentValue);
}
