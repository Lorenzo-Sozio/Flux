/**
 * LicensingService — derives and caches tenant entitlements.
 *
 * Architecture:
 *  - Entitlements are computed from: plan + add-ons + subscription status.
 *  - Cached in-process with a 5-minute TTL; invalidated immediately on any
 *    plan/status change (webhook, admin action).
 *  - Every entitlement change is written to billing_audit_log.
 */

import { and, eq } from "drizzle-orm";

import { platformDb } from "@/db";
import { billingAuditLog, billingPlans, billingSubscriptions, billingTenantAddons } from "@/db/schema";

import type { PlanLimits, PlanModule, SubscriptionStatus } from "./plans-config";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TenantEntitlements {
  tenantId: string;
  planId: string | null;
  planName: string;
  status: SubscriptionStatus;

  // User seats
  maxUsers: number | null;
  includedUsers: number;

  // Feature gates
  enabledModules: PlanModule[];
  hasWhiteLabel: boolean;
  hasSandbox: boolean;
  supportTier: string;

  // Quantitative limits (null = unlimited)
  limits: PlanLimits;

  // Active add-ons
  addons: Array<{ type: string; quantity: number }>;

  // Derived booleans
  isActive: boolean; // status in [active, trialing, free]
  isSuspended: boolean;
  canUpgrade: boolean;

  computedAt: number; // epoch ms
}

// ─── In-memory cache ──────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes safety net

interface CacheEntry {
  data: TenantEntitlements;
  expiresAt: number;
}

const entitlementCache = new Map<string, CacheEntry>();

// ─── Free-plan baseline ───────────────────────────────────────────────────────

function freePlanEntitlements(tenantId: string): TenantEntitlements {
  return {
    tenantId,
    planId: null,
    planName: "free",
    status: "free",
    maxUsers: 1,
    includedUsers: 1,
    enabledModules: ["crm"],
    hasWhiteLabel: false,
    hasSandbox: false,
    supportTier: "community",
    limits: {
      maxUsers: 1,
      apiCallsPerMonth: 1_000,
      storageGb: 1,
      automationRunsPerMonth: 10,
      maxRecords: 500,
      maxWorkspaces: 1,
      maxIntegrations: 1,
    },
    addons: [],
    isActive: true,
    isSuspended: false,
    canUpgrade: true,
    computedAt: Date.now(),
  };
}

// ─── Core compute ─────────────────────────────────────────────────────────────

async function computeEntitlements(tenantId: string): Promise<TenantEntitlements> {
  const sub = await platformDb.query.billingSubscriptions.findFirst({
    where: eq(billingSubscriptions.tenantId, tenantId),
    with: { plan: true },
  });

  if (!sub || sub.status === "free" || !sub.plan) {
    return freePlanEntitlements(tenantId);
  }

  const plan = sub.plan;

  const addons = await platformDb
    .select()
    .from(billingTenantAddons)
    .where(and(eq(billingTenantAddons.tenantId, tenantId), eq(billingTenantAddons.status, "active")));

  const baseLimits: PlanLimits = plan.limits ? JSON.parse(plan.limits) : {};
  const baseModules: PlanModule[] = plan.enabledModules ? JSON.parse(plan.enabledModules) : ["crm"];

  // Merge add-on capabilities
  const extraUsers = addons.filter((a) => a.addonType === "extra_users").reduce((sum, a) => sum + a.quantity, 0);

  const effectiveMaxUsers = baseLimits.maxUsers !== null ? (baseLimits.maxUsers ?? 0) + extraUsers : null;

  const addonModules: PlanModule[] = [];
  for (const addon of addons) {
    if (addon.addonType === "helpdesk") addonModules.push("helpdesk");
    if (addon.addonType === "advanced_reporting") addonModules.push("reporting");
  }

  const allModules = Array.from(new Set([...baseModules, ...addonModules])) as PlanModule[];

  const hasWhiteLabel = plan.hasWhiteLabel || addons.some((a) => a.addonType === "white_label");
  const hasSandbox = plan.hasSandbox || addons.some((a) => a.addonType === "sandbox");

  const status = sub.status as SubscriptionStatus;
  const isActive = ["active", "trialing", "free"].includes(status);
  const isSuspended = status === "suspended";

  return {
    tenantId,
    planId: plan.id,
    planName: plan.name,
    status,
    maxUsers: effectiveMaxUsers,
    includedUsers: plan.includedUsers,
    enabledModules: allModules,
    hasWhiteLabel,
    hasSandbox,
    supportTier: plan.supportTier,
    limits: { ...baseLimits, maxUsers: effectiveMaxUsers },
    addons: addons.map((a) => ({ type: a.addonType, quantity: a.quantity })),
    isActive,
    isSuspended,
    canUpgrade: plan.name !== "enterprise",
    computedAt: Date.now(),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getEntitlements(tenantId: string): Promise<TenantEntitlements> {
  const cached = entitlementCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const data = await computeEntitlements(tenantId);
  entitlementCache.set(tenantId, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

export function invalidateEntitlementCache(tenantId: string): void {
  entitlementCache.delete(tenantId);
}

export function invalidateAllCaches(): void {
  entitlementCache.clear();
}

/** Checks if a module is enabled; throws ForbiddenError if not. */
export async function requireModule(tenantId: string, module: PlanModule): Promise<void> {
  const ent = await getEntitlements(tenantId);
  if (!ent.isActive || ent.isSuspended) {
    throw new EntitlementError(`Subscription inactive. Please update your billing.`);
  }
  if (!ent.enabledModules.includes(module)) {
    throw new EntitlementError(`The "${module}" module is not available on your current plan. Please upgrade.`);
  }
}

/** Returns true if the tenant has room for one more active user. */
export async function canAddUser(tenantId: string, currentActiveUsers: number): Promise<boolean> {
  const ent = await getEntitlements(tenantId);
  if (!ent.isActive) return false;
  if (ent.maxUsers === null) return true;
  return currentActiveUsers < ent.maxUsers;
}

/** Checks a quantitative limit; throws EntitlementError if exceeded. */
export async function assertLimit(tenantId: string, metric: keyof PlanLimits, currentValue: number): Promise<void> {
  const ent = await getEntitlements(tenantId);
  if (!ent.isActive || ent.isSuspended) {
    throw new EntitlementError("Subscription inactive. Please update your billing.");
  }
  const limit = ent.limits[metric];
  // Allow currentValue == limit (the tenant has exactly filled the quota).
  // Block when they would exceed it (currentValue is already at limit, next op would go over).
  if (limit !== null && currentValue >= limit) {
    throw new EntitlementError(
      `You have reached the ${metric} limit (${limit}) on your current plan. Please upgrade to continue.`,
    );
  }
}

/** Appends an entry to the immutable entitlement audit log. */
export async function logEntitlementChange(opts: {
  tenantId: string;
  eventType: string;
  previousValue?: object | null;
  newValue?: object | null;
  triggeredBy: string;
}): Promise<void> {
  await platformDb.insert(billingAuditLog).values({
    tenantId: opts.tenantId,
    eventType: opts.eventType,
    previousValue: opts.previousValue ? JSON.stringify(opts.previousValue) : null,
    newValue: opts.newValue ? JSON.stringify(opts.newValue) : null,
    triggeredBy: opts.triggeredBy,
  });
}

export class EntitlementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EntitlementError";
  }
}
