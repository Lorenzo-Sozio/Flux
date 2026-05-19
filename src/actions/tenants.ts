"use server";

import { revalidatePath } from "next/cache";

import path from "node:path";

import { neon } from "@neondatabase/serverless";
import { and, eq, gt, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

import { auth } from "@/auth";
import { createTenantDb, invalidateTenantDbCache, platformDb } from "@/db";
import { billingPlans, billingSubscriptions, tenantMembers, tenants, userInvitations, users } from "@/db/schema";
import { requireAdminPanelAccess } from "@/lib/auth-guard";
import { sendInvitationEmail } from "@/lib/email";
import { invalidateTenantCache } from "@/lib/get-tenant";
import { decryptDbUrl, encryptDbUrl } from "@/lib/tenant-db";

/**
 * Validates subdomain format: lowercase, alphanumeric + hyphens, 3-63 chars
 */
function validateSubdomain(subdomain: string): boolean {
  const regex = /^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/;
  return regex.test(subdomain) && subdomain.length >= 3 && subdomain.length <= 63;
}

function validateUserId(userId: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId);
}

function validateSettings(settings: unknown): boolean {
  if (!settings) return true;
  if (typeof settings !== "object") return false;
  const s = settings as Record<string, unknown>;
  return (
    Object.keys(s).every(
      (key) => ["emoji", "primaryColor", "theme", "logo"].includes(key) && typeof s[key] === "string",
    ) &&
    (s.emoji === undefined || (typeof s.emoji === "string" && s.emoji.length <= 10))
  );
}

/**
 * Validates that a DB URL targets a Neon endpoint specifically.
 * Prevents SSRF: without this check an admin could supply an internal-network
 * hostname (e.g., 169.254.169.254) and cause the app to probe cloud metadata.
 */
function validateNeonDbUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === "postgresql:" || parsed.protocol === "postgres:") && parsed.hostname.endsWith(".neon.tech")
    );
  } catch {
    return false;
  }
}

/**
 * Validates tenant name: non-empty, max 255 chars
 */
function validateName(name: string): boolean {
  return name.trim().length > 0 && name.length <= 255;
}

/**
 * List all tenants (admin only, main domain only)
 */
export async function listTenants() {
  await requireAdminPanelAccess();

  const result = await platformDb
    .select({
      id: tenants.id,
      name: tenants.name,
      subdomain: tenants.subdomain,
      settings: tenants.settings,
      lastMigratedAt: tenants.lastMigratedAt,
      createdAt: tenants.createdAt,
      updatedAt: tenants.updatedAt,
      subscriptionStatus: billingSubscriptions.status,
      planId: billingSubscriptions.planId,
      planName: billingPlans.name,
      planDisplayName: billingPlans.displayName,
    })
    .from(tenants)
    .leftJoin(billingSubscriptions, eq(billingSubscriptions.tenantId, tenants.id))
    .leftJoin(billingPlans, eq(billingPlans.id, billingSubscriptions.planId))
    .orderBy(tenants.createdAt);

  return result;
}

/**
 * Get a single tenant by subdomain (admin only, main domain only)
 */
export async function getTenant(subdomain: string) {
  await requireAdminPanelAccess();

  if (!validateSubdomain(subdomain)) {
    throw new Error("Invalid subdomain format.");
  }

  const [tenant] = await platformDb
    .select({
      id: tenants.id,
      name: tenants.name,
      subdomain: tenants.subdomain,
      settings: tenants.settings,
      createdAt: tenants.createdAt,
      updatedAt: tenants.updatedAt,
    })
    .from(tenants)
    .where(eq(tenants.subdomain, subdomain));

  if (!tenant) {
    throw new Error("Tenant not found.");
  }

  return tenant;
}

/**
 * Create a new tenant
 *
 * Security considerations:
 * - Validates all inputs
 * - Checks subdomain uniqueness
 * - Requires admin access + main domain
 * - Doesn't expose DB credentials in response
 */
export async function createTenant(name: string, subdomain: string, dbUrl: string, settings?: unknown) {
  await requireAdminPanelAccess();

  // Validate inputs
  if (!validateName(name)) {
    throw new Error("Invalid tenant name. Must be 1-255 characters.");
  }

  if (!validateSubdomain(subdomain)) {
    throw new Error("Invalid subdomain. Must be 3-63 characters, lowercase alphanumeric with hyphens.");
  }

  if (!validateSettings(settings)) {
    throw new Error("Invalid settings format.");
  }

  // Check subdomain uniqueness
  const [existing] = await platformDb.select().from(tenants).where(eq(tenants.subdomain, subdomain));

  if (existing) {
    throw new Error(`Subdomain '${subdomain}' is already taken. Choose a different one.`);
  }

  if (!validateNeonDbUrl(dbUrl)) {
    throw new Error("Invalid database URL. Must be a Neon PostgreSQL connection string (*.neon.tech).");
  }

  const id = crypto.randomUUID();
  await platformDb.insert(tenants).values({
    id,
    name: name.trim(),
    subdomain: subdomain.toLowerCase(),
    dbUrl: encryptDbUrl(dbUrl),
    settings: settings ? JSON.stringify(settings) : null,
  });

  // Auto-add the creator as the tenant owner
  const session = await auth();
  if (session?.user?.id) {
    await platformDb.insert(tenantMembers).values({
      tenantId: id,
      userId: session.user.id,
      role: "owner",
    });
  }

  // Provision a free subscription so the licensing engine always finds one
  await platformDb.insert(billingSubscriptions).values({
    tenantId: id,
    status: "free",
  });

  // Run migrations immediately — idempotent, so safe to retry via "Migrate DB" if this fails.
  let migrationError: string | null = null;
  try {
    await runMigrations(id, dbUrl);
  } catch (err) {
    migrationError = err instanceof Error ? err.message : "Migration failed";
  }

  invalidateTenantCache(subdomain.toLowerCase());
  revalidatePath("/admin/tenants");

  return {
    id,
    name: name.trim(),
    subdomain: subdomain.toLowerCase(),
    migrationError,
  };
}

/**
 * Update tenant
 *
 * Currently allows updating name and settings only (not subdomain or dbUrl)
 */
export async function updateTenant(
  subdomain: string,
  updates: {
    name?: string;
    settings?: unknown;
  },
) {
  await requireAdminPanelAccess();

  if (!validateSubdomain(subdomain)) {
    throw new Error("Invalid subdomain format.");
  }

  // Validate updates
  if (updates.name !== undefined && !validateName(updates.name)) {
    throw new Error("Invalid tenant name. Must be 1-255 characters.");
  }

  if (updates.settings !== undefined && !validateSettings(updates.settings)) {
    throw new Error("Invalid settings format.");
  }

  // Verify tenant exists
  const [existing] = await platformDb.select().from(tenants).where(eq(tenants.subdomain, subdomain));

  if (!existing) {
    throw new Error("Tenant not found.");
  }

  // Update
  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (updates.name !== undefined) {
    updateData.name = updates.name.trim();
  }

  if (updates.settings !== undefined) {
    updateData.settings = updates.settings ? JSON.stringify(updates.settings) : null;
  }

  await platformDb.update(tenants).set(updateData).where(eq(tenants.subdomain, subdomain));

  invalidateTenantCache(subdomain);
  revalidatePath("/admin/tenants");

  return { success: true };
}

/**
 * Delete a tenant
 *
 * Security considerations:
 * - Requires admin access + main domain
 * - Requires confirmation (implemented in UI)
 * - Logs the action (TODO: implement audit log)
 * - Does NOT delete the tenant database (manual cleanup required)
 *   This is intentional to prevent accidental data loss
 */
export async function deleteTenant(subdomain: string) {
  await requireAdminPanelAccess();

  if (!validateSubdomain(subdomain)) {
    throw new Error("Invalid subdomain format.");
  }

  // Prevent deletion of 'admin' or other system tenants (if any)
  if (subdomain === "admin" || subdomain === "www") {
    throw new Error(`Cannot delete reserved subdomain: ${subdomain}`);
  }

  // Verify tenant exists before deletion
  const [existing] = await platformDb.select().from(tenants).where(eq(tenants.subdomain, subdomain));

  if (!existing) {
    throw new Error("Tenant not found.");
  }

  // Delete
  await platformDb.delete(tenants).where(eq(tenants.subdomain, subdomain));

  invalidateTenantCache(subdomain);
  invalidateTenantDbCache(existing.id);
  revalidatePath("/admin/tenants");

  return { success: true };
}

const TENANT_MIGRATIONS_FOLDER = path.join(process.cwd(), "src/db/migrations-tenant");

/** Core migration logic — runs migrations and stamps lastMigratedAt. */
async function runMigrations(tenantId: string, dbUrl: string) {
  const sql = neon(dbUrl);
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder: TENANT_MIGRATIONS_FOLDER });
  await platformDb.update(tenants).set({ lastMigratedAt: new Date() }).where(eq(tenants.id, tenantId));
}

/**
 * Applies pending Drizzle migrations to a single tenant's database.
 * Idempotent: Drizzle tracks applied migrations in the __drizzle_migrations journal table.
 */
export async function migrateTenantDb(subdomain: string) {
  await requireAdminPanelAccess();

  if (!validateSubdomain(subdomain)) {
    throw new Error("Invalid subdomain format.");
  }

  const [tenant] = await platformDb.select().from(tenants).where(eq(tenants.subdomain, subdomain));

  if (!tenant) {
    throw new Error("Tenant not found.");
  }

  await runMigrations(tenant.id, decryptDbUrl(tenant.dbUrl));

  return { success: true };
}

// ─── Tenant member management ─────────────────────────────────────────────────

/** Returns all members of a tenant with their user details. */
export async function listTenantMembers(subdomain: string) {
  await requireAdminPanelAccess();

  const [tenant] = await platformDb.select().from(tenants).where(eq(tenants.subdomain, subdomain));
  if (!tenant) throw new Error("Tenant not found.");

  return platformDb
    .select({
      memberId: tenantMembers.id,
      userId: tenantMembers.userId,
      role: tenantMembers.role,
      createdAt: tenantMembers.createdAt,
      name: users.name,
      email: users.email,
    })
    .from(tenantMembers)
    .innerJoin(users, eq(tenantMembers.userId, users.id))
    .where(eq(tenantMembers.tenantId, tenant.id))
    .orderBy(tenantMembers.createdAt);
}

/**
 * Adds a platform user (looked up by email) as a tenant member.
 * Also upserts the user record into the tenant DB so FK constraints work.
 */
export async function addTenantMember(subdomain: string, email: string, role: string) {
  await requireAdminPanelAccess();

  if (!validateSubdomain(subdomain)) throw new Error("Invalid subdomain.");

  const validRoles = ["owner", "admin", "editor", "viewer"];
  if (!validRoles.includes(role)) throw new Error("Invalid role.");

  const [tenant] = await platformDb.select().from(tenants).where(eq(tenants.subdomain, subdomain));
  if (!tenant) throw new Error("Tenant not found.");
  if (!tenant.lastMigratedAt) {
    throw new Error("Tenant database has not been migrated yet. Run 'Migrate DB' first.");
  }

  // Resolve user by email in platform DB
  const [user] = await platformDb.select().from(users).where(eq(users.email, email.toLowerCase().trim()));
  if (!user) throw new Error(`No account found for "${email}". The user must register first.`);

  // Insert membership (unique constraint prevents duplicates)
  await platformDb
    .insert(tenantMembers)
    .values({ tenantId: tenant.id, userId: user.id, role })
    .onConflictDoUpdate({
      target: [tenantMembers.tenantId, tenantMembers.userId],
      set: { role },
    });

  // Sync user record to tenant DB so tenant-side FKs work
  const tenantDb = createTenantDb(tenant.id, decryptDbUrl(tenant.dbUrl));
  await tenantDb
    .insert(users)
    .values({ id: user.id, name: user.name ?? "", email: user.email ?? "", role })
    .onConflictDoUpdate({
      target: users.id,
      set: { name: user.name ?? "", role },
    });

  revalidatePath("/admin/tenants");
  return { success: true };
}

/** Removes a member from a tenant (cannot remove the last owner). */
export async function removeTenantMember(subdomain: string, userId: string) {
  await requireAdminPanelAccess();
  if (!validateSubdomain(subdomain)) throw new Error("Invalid subdomain.");
  if (!validateUserId(userId)) throw new Error("Invalid user ID format.");

  const [tenant] = await platformDb.select().from(tenants).where(eq(tenants.subdomain, subdomain));
  if (!tenant) throw new Error("Tenant not found.");

  // Prevent removing the last owner
  const owners = await platformDb
    .select()
    .from(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, tenant.id), eq(tenantMembers.role, "owner")));
  const isLastOwner = owners.length === 1 && owners[0].userId === userId;
  if (isLastOwner) throw new Error("Cannot remove the last owner of a tenant.");

  await platformDb
    .delete(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, tenant.id), eq(tenantMembers.userId, userId)));

  revalidatePath("/admin/tenants");
  return { success: true };
}

/** Updates the role of an existing member. */
export async function updateTenantMemberRole(subdomain: string, userId: string, role: string) {
  await requireAdminPanelAccess();
  if (!validateSubdomain(subdomain)) throw new Error("Invalid subdomain.");
  if (!validateUserId(userId)) throw new Error("Invalid user ID format.");

  const validRoles = ["owner", "admin", "editor", "viewer"];
  if (!validRoles.includes(role)) throw new Error("Invalid role.");

  const [tenant] = await platformDb.select().from(tenants).where(eq(tenants.subdomain, subdomain));
  if (!tenant) throw new Error("Tenant not found.");
  if (!tenant.lastMigratedAt) {
    throw new Error("Tenant database has not been migrated yet. Run 'Migrate DB' first.");
  }

  // Prevent demoting the last owner
  if (role !== "owner") {
    const owners = await platformDb
      .select()
      .from(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, tenant.id), eq(tenantMembers.role, "owner")));
    if (owners.length === 1 && owners[0].userId === userId) {
      throw new Error("Cannot demote the last owner of a tenant.");
    }
  }

  await platformDb
    .update(tenantMembers)
    .set({ role })
    .where(and(eq(tenantMembers.tenantId, tenant.id), eq(tenantMembers.userId, userId)));

  // Keep tenant DB user role in sync
  const tenantDb = createTenantDb(tenant.id, decryptDbUrl(tenant.dbUrl));
  await tenantDb.update(users).set({ role }).where(eq(users.id, userId));

  revalidatePath("/admin/tenants");
  return { success: true };
}

// ─── Tenant invitation management ────────────────────────────────────────────

/**
 * Smart invite: if the email belongs to an existing platform user, adds them
 * directly as a member. If not, sends a tenant-scoped invitation email so they
 * can register and are auto-provisioned on acceptance.
 */
export async function inviteTenantMember(
  subdomain: string,
  email: string,
  role: string,
): Promise<{ added: true } | { invited: true; emailSent: boolean; inviteUrl: string }> {
  const adminSession = await requireAdminPanelAccess();

  if (!validateSubdomain(subdomain)) throw new Error("Invalid subdomain.");

  const validRoles = ["owner", "admin", "editor", "viewer"];
  if (!validRoles.includes(role)) throw new Error("Invalid role.");

  const normalizedEmail = email.toLowerCase().trim();
  if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error("Invalid email address.");
  }

  const [tenant] = await platformDb.select().from(tenants).where(eq(tenants.subdomain, subdomain));
  if (!tenant) throw new Error("Tenant not found.");

  // If user already exists: add directly
  const [existing] = await platformDb.select().from(users).where(eq(users.email, normalizedEmail));
  if (existing) {
    if (!tenant.lastMigratedAt) {
      throw new Error("Tenant database has not been migrated yet. Run 'Migrate DB' first.");
    }
    // Prevent silently demoting the last owner via re-invite
    if (role !== "owner") {
      const owners = await platformDb
        .select()
        .from(tenantMembers)
        .where(and(eq(tenantMembers.tenantId, tenant.id), eq(tenantMembers.role, "owner")));
      if (owners.length === 1 && owners[0].userId === existing.id) {
        throw new Error("Cannot demote the last owner of a tenant.");
      }
    }

    await platformDb
      .insert(tenantMembers)
      .values({ tenantId: tenant.id, userId: existing.id, role })
      .onConflictDoUpdate({
        target: [tenantMembers.tenantId, tenantMembers.userId],
        set: { role },
      });

    const tenantDb = createTenantDb(tenant.id, decryptDbUrl(tenant.dbUrl));
    await tenantDb
      .insert(users)
      .values({ id: existing.id, name: existing.name ?? "", email: existing.email ?? "", role })
      .onConflictDoUpdate({ target: users.id, set: { name: existing.name ?? "", role } });

    revalidatePath(`/admin/tenants/${subdomain}`);
    return { added: true };
  }

  // User doesn't exist: create tenant-scoped invitation
  const [adminUser] = await platformDb
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, adminSession.user.id));
  const inviterName = adminUser?.name ?? "An administrator";

  // Revoke any existing pending invitation for this email+tenant
  await platformDb
    .delete(userInvitations)
    .where(
      and(
        eq(userInvitations.email, normalizedEmail),
        eq(userInvitations.tenantId, tenant.id),
        isNull(userInvitations.acceptedAt),
      ),
    );

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await platformDb.insert(userInvitations).values({
    email: normalizedEmail,
    token,
    role: "user",
    invitedById: adminSession.user.id,
    expiresAt,
    tenantId: tenant.id,
    tenantRole: role,
  });

  const emailResult = await sendInvitationEmail(normalizedEmail, token, inviterName, role);

  revalidatePath(`/admin/tenants/${subdomain}`);

  return { invited: true, emailSent: emailResult.success, inviteUrl: emailResult.inviteUrl };
}

/** Returns pending (not yet accepted, not expired) tenant-scoped invitations. */
export async function listTenantPendingInvitations(subdomain: string) {
  await requireAdminPanelAccess();

  const [tenant] = await platformDb.select().from(tenants).where(eq(tenants.subdomain, subdomain));
  if (!tenant) throw new Error("Tenant not found.");

  return platformDb
    .select({
      id: userInvitations.id,
      email: userInvitations.email,
      tenantRole: userInvitations.tenantRole,
      expiresAt: userInvitations.expiresAt,
      createdAt: userInvitations.createdAt,
    })
    .from(userInvitations)
    .where(
      and(
        eq(userInvitations.tenantId, tenant.id),
        isNull(userInvitations.acceptedAt),
        gt(userInvitations.expiresAt, new Date()),
      ),
    )
    .orderBy(userInvitations.createdAt);
}

/** Revokes a pending tenant invitation (cannot revoke accepted ones). */
export async function revokeTenantInvitation(subdomain: string, invitationId: string) {
  await requireAdminPanelAccess();

  if (!validateSubdomain(subdomain)) throw new Error("Invalid subdomain.");

  const [tenant] = await platformDb.select().from(tenants).where(eq(tenants.subdomain, subdomain));
  if (!tenant) throw new Error("Tenant not found.");

  const [inv] = await platformDb
    .select()
    .from(userInvitations)
    .where(and(eq(userInvitations.id, invitationId), eq(userInvitations.tenantId, tenant.id)));

  if (!inv) throw new Error("Invitation not found.");
  if (inv.acceptedAt) throw new Error("Cannot revoke an already accepted invitation.");

  await platformDb
    .delete(userInvitations)
    .where(and(eq(userInvitations.id, invitationId), eq(userInvitations.tenantId, tenant.id)));

  revalidatePath(`/admin/tenants/${subdomain}`);
  return { success: true };
}

/** Resends the invitation email with a fresh token and extended expiry. */
export async function resendTenantInvitation(
  subdomain: string,
  invitationId: string,
): Promise<{ success: true; emailSent: boolean; inviteUrl: string }> {
  const adminSession = await requireAdminPanelAccess();

  if (!validateSubdomain(subdomain)) throw new Error("Invalid subdomain.");

  const [adminUser] = await platformDb
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, adminSession.user.id));
  const inviterName = adminUser?.name ?? "An administrator";

  const [tenant] = await platformDb.select().from(tenants).where(eq(tenants.subdomain, subdomain));
  if (!tenant) throw new Error("Tenant not found.");

  const [inv] = await platformDb
    .select()
    .from(userInvitations)
    .where(and(eq(userInvitations.id, invitationId), eq(userInvitations.tenantId, tenant.id)));

  if (!inv) throw new Error("Invitation not found.");
  if (inv.acceptedAt) throw new Error("Invitation already accepted.");

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await platformDb.update(userInvitations).set({ token, expiresAt }).where(eq(userInvitations.id, invitationId));

  const emailResult = await sendInvitationEmail(inv.email, token, inviterName, inv.tenantRole ?? "editor");

  revalidatePath(`/admin/tenants/${subdomain}`);

  return { success: true, emailSent: emailResult.success, inviteUrl: emailResult.inviteUrl };
}
