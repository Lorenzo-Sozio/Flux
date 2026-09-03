/**
 * permissions.ts — the single source of truth for "who may do what".
 *
 * Pure module: no server imports, no DB, no `next/headers`. It is imported by
 * server actions, server components AND client components so that the three
 * layers can never disagree about a capability.
 *
 * ─── The two role scales ──────────────────────────────────────────────────────
 *
 * There are two, and conflating them was the single most damaging defect in the
 * product (audit rilievi P-01 → P-06):
 *
 *   1. TENANT role — `tenant_members.role`, exposed as `session.user.tenantRole`.
 *      This is the authority INSIDE a workspace: owner > admin > editor > viewer.
 *      Everything a customer does is governed by this.
 *
 *   2. PLATFORM role — `user.role`, exposed as `session.user.role`.
 *      This identifies Flux's own staff, who operate the /admin panel across all
 *      tenants. It is NOT a workspace role, and a workspace admin must never be
 *      able to write it — that was a direct path from "tenant admin" to
 *      "superadmin over every customer".
 *
 * Rule of thumb: if the check is about a customer's own data, use the tenant
 * role. Platform staff get read/write parity with a tenant owner so support can
 * reproduce issues, but nothing else in the product may branch on it.
 */

// ─── Tenant roles ─────────────────────────────────────────────────────────────

export const TENANT_ROLES = ["viewer", "editor", "admin", "owner"] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

/** Higher rank = more authority. Used for every comparison; never compare strings. */
const RANK: Record<TenantRole, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
  owner: 3,
};

/**
 * Coerces any stored value to a valid tenant role, failing closed to `viewer`.
 * Legacy rows wrote `"user"` where they meant `"editor"`, so that one value is
 * mapped rather than downgraded — every other unknown becomes read-only.
 */
export function normalizeTenantRole(raw: string | null | undefined): TenantRole {
  if (raw === "user") return "editor"; // legacy alias
  return (TENANT_ROLES as readonly string[]).includes(raw ?? "") ? (raw as TenantRole) : "viewer";
}

/** True when `user.role` marks a member of Flux's own staff. */
export function isPlatformStaffRole(raw: string | null | undefined): boolean {
  return raw === "admin" || raw === "owner";
}

// ─── Capabilities ─────────────────────────────────────────────────────────────

/**
 * Every gated capability in the product, with the minimum tenant role it needs.
 * Add a capability here rather than writing a role comparison at the call site —
 * that is what let pages and actions drift apart in the first place.
 */
export const CAPABILITIES = {
  // CRM data
  "record:read": "viewer",
  "record:write": "editor",
  "record:delete": "editor",
  "record:import": "editor",
  "record:export": "viewer",

  // Sales documents
  "quote:write": "editor",
  "quote:approve": "admin",
  "order:write": "editor",
  "order:delete": "admin",
  "product:manage": "admin",

  // Support
  "ticket:read": "viewer",
  "ticket:write": "editor",
  "ticket:delete": "admin",
  "sla:manage": "admin",
  "macro:manage": "editor",
  "chatChannel:manage": "admin",

  // Reporting — reading a report needs no more authority than reading the rows
  // behind it; only saving and deleting shared reports is privileged.
  "report:read": "viewer",
  "report:manage": "admin",

  // Configuration
  "settings:read": "admin",
  "settings:manage": "admin",
  "pipeline:manage": "admin",
  "customField:manage": "admin",
  "webhook:manage": "admin",
  "emailSettings:manage": "admin",
  "automation:manage": "admin",
  "target:manage": "admin",

  // People and money
  "user:read": "admin",
  "user:manage": "admin",
  "group:manage": "admin",
  "billing:read": "admin",
  "billing:manage": "owner",
} as const satisfies Record<string, TenantRole>;

export type Capability = keyof typeof CAPABILITIES;

/** The actor a capability check is made against. */
export interface Actor {
  userId: string;
  tenantRole: TenantRole;
  /** Flux staff operating across tenants — treated as a tenant owner for data access. */
  isPlatformStaff: boolean;
  /** Display identity, carried so callers need not re-read the session for a name. */
  name?: string | null;
  email?: string | null;
}

/**
 * The only permission predicate in the codebase.
 *
 * Accepts either a resolved Actor or a bare role string, so a client component
 * that only received `tenantRole` as a prop can call it exactly like the server.
 */
export function can(actor: Actor | TenantRole | string | null | undefined, capability: Capability): boolean {
  // No actor is not a viewer. `hasCapability` passes null when nobody is signed
  // in, and reading is still something only a member of the workspace may do.
  if (actor === null || actor === undefined) return false;

  const required = RANK[CAPABILITIES[capability]];

  if (typeof actor === "object") {
    if (actor.isPlatformStaff) return true;
    return RANK[actor.tenantRole] >= required;
  }

  return RANK[normalizeTenantRole(actor)] >= required;
}

/** Convenience for the very common "may this actor change anything?" question. */
export function canWrite(actor: Actor | TenantRole | string | null | undefined): boolean {
  return can(actor, "record:write");
}

/** Roles a given actor is allowed to hand out. Nobody may grant above their own rank. */
export function assignableRoles(actor: Actor | TenantRole | string | null | undefined): TenantRole[] {
  const rank = actor && typeof actor === "object" ? RANK[actor.tenantRole] : RANK[normalizeTenantRole(actor)];
  const ceiling = actor && typeof actor === "object" && actor.isPlatformStaff ? RANK.owner : rank;
  return TENANT_ROLES.filter((r) => RANK[r] <= ceiling);
}

/** True when `a` outranks `b`. Used to stop an admin from editing an owner. */
export function outranks(a: TenantRole | string, b: TenantRole | string): boolean {
  return RANK[normalizeTenantRole(a)] > RANK[normalizeTenantRole(b)];
}
