"use server";

import { requireAdminAccess } from "@/lib/auth-guard";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { platformDb, createTenantDb, invalidateTenantDbCache } from "@/db";
import { tenants, tenantMembers, users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { encryptDbUrl, decryptDbUrl } from "@/lib/tenant-db";
import { invalidateTenantCache } from "@/lib/get-tenant";
import { auth } from "@/auth";

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
  return Object.keys(s).every((key) =>
    ["emoji", "primaryColor", "theme", "logo"].includes(key) &&
    typeof s[key] === "string"
  ) &&
    (s.emoji === undefined || (typeof s.emoji === "string" && s.emoji.length <= 10));
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
  await requireAdminAccess();


  const result = await platformDb
    .select({
      id: tenants.id,
      name: tenants.name,
      subdomain: tenants.subdomain,
      settings: tenants.settings,
      createdAt: tenants.createdAt,
      updatedAt: tenants.updatedAt,
    })
    .from(tenants)
    .orderBy(tenants.createdAt);

  return result;
}

/**
 * Get a single tenant by subdomain (admin only, main domain only)
 */
export async function getTenant(subdomain: string) {
  await requireAdminAccess();


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
export async function createTenant(
  name: string,
  subdomain: string,
  dbUrl: string,
  settings?: unknown
) {
  await requireAdminAccess();


  // Validate inputs
  if (!validateName(name)) {
    throw new Error("Invalid tenant name. Must be 1-255 characters.");
  }

  if (!validateSubdomain(subdomain)) {
    throw new Error(
      "Invalid subdomain. Must be 3-63 characters, lowercase alphanumeric with hyphens."
    );
  }

  if (!validateSettings(settings)) {
    throw new Error("Invalid settings format.");
  }

  // Check subdomain uniqueness
  const [existing] = await platformDb
    .select()
    .from(tenants)
    .where(eq(tenants.subdomain, subdomain));

  if (existing) {
    throw new Error(
      `Subdomain '${subdomain}' is already taken. Choose a different one.`
    );
  }

  // Validate dbUrl is a valid connection string (basic check)
  if (
    !dbUrl.startsWith("postgresql://") &&
    !dbUrl.startsWith("postgres://")
  ) {
    throw new Error("Invalid database URL. Must be a PostgreSQL connection string.");
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

  invalidateTenantCache(subdomain.toLowerCase());
  revalidatePath("/admin/tenants");

  return {
    id,
    name: name.trim(),
    subdomain: subdomain.toLowerCase(),
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
  }
) {
  await requireAdminAccess();


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
  const [existing] = await platformDb
    .select()
    .from(tenants)
    .where(eq(tenants.subdomain, subdomain));

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

  await platformDb
    .update(tenants)
    .set(updateData)
    .where(eq(tenants.subdomain, subdomain));

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
  await requireAdminAccess();


  if (!validateSubdomain(subdomain)) {
    throw new Error("Invalid subdomain format.");
  }

  // Prevent deletion of 'admin' or other system tenants (if any)
  if (subdomain === "admin" || subdomain === "www") {
    throw new Error(`Cannot delete reserved subdomain: ${subdomain}`);
  }

  // Verify tenant exists before deletion
  const [existing] = await platformDb
    .select()
    .from(tenants)
    .where(eq(tenants.subdomain, subdomain));

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

/**
 * Run all Drizzle migrations against a tenant's database.
 * Safe to run multiple times — Drizzle tracks applied migrations in __drizzle_migrations.
 */
export async function migrateTenantDb(subdomain: string) {
  await requireAdminAccess();


  if (!validateSubdomain(subdomain)) {
    throw new Error("Invalid subdomain format.");
  }

  const [tenant] = await platformDb
    .select()
    .from(tenants)
    .where(eq(tenants.subdomain, subdomain));

  if (!tenant) {
    throw new Error("Tenant not found.");
  }

  const dbUrl = decryptDbUrl(tenant.dbUrl);
  const sql = neon(dbUrl);
  const db = drizzle(sql);

  // pushSchema compares the Drizzle schema against the live DB and applies only
  // the missing tables/columns. Safe on fresh DBs and idempotent on existing ones.
  const { pushSchema } = await import("drizzle-kit/api");
  // Use tenant-only schema: excludes platform-only tables (tenants, tenantMembers)
  const schema = await import("@/db/schema-tenant");

  const { hasDataLoss, warnings, apply } = await pushSchema(schema, db);

  if (warnings.length > 0) {
    console.warn(`[migrateTenantDb] ${subdomain}:`, warnings);
  }

  if (hasDataLoss) {
    throw new Error("Schema push would cause data loss — aborting. Review tenant DB manually.");
  }

  await apply();
  return { success: true, warnings };
}

/**
 * Run migrations against every tenant DB in sequence.
 * Returns a per-tenant result array so callers can surface partial failures.
 */
export async function migrateAllTenants() {
  await requireAdminAccess();


  const allTenants = await platformDb
    .select({ id: tenants.id, subdomain: tenants.subdomain, dbUrl: tenants.dbUrl })
    .from(tenants)
    .orderBy(tenants.createdAt);

  const results: { subdomain: string; success: boolean; error?: string; warnings?: string[] }[] = [];

  for (const tenant of allTenants) {
    try {
      const dbUrl = decryptDbUrl(tenant.dbUrl);
      const sql = neon(dbUrl);
      const db = drizzle(sql);
      const { pushSchema } = await import("drizzle-kit/api");
      const schema = await import("@/db/schema-tenant");
      const { hasDataLoss, warnings, apply } = await pushSchema(schema, db);

      if (hasDataLoss) {
        results.push({ subdomain: tenant.subdomain, success: false, error: "Would cause data loss — skipped" });
        continue;
      }

      await apply();
      results.push({ subdomain: tenant.subdomain, success: true, warnings });
    } catch (err) {
      results.push({
        subdomain: tenant.subdomain,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  revalidatePath("/admin/tenants");
  return results;
}

// ─── Tenant member management ─────────────────────────────────────────────────

/** Returns all members of a tenant with their user details. */
export async function listTenantMembers(subdomain: string) {
  await requireAdminAccess();


  const [tenant] = await platformDb
    .select()
    .from(tenants)
    .where(eq(tenants.subdomain, subdomain));
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
export async function addTenantMember(
  subdomain: string,
  email: string,
  role: string,
) {
  await requireAdminAccess();


  if (!validateSubdomain(subdomain)) throw new Error("Invalid subdomain.");

  const validRoles = ["owner", "admin", "editor", "viewer"];
  if (!validRoles.includes(role)) throw new Error("Invalid role.");

  const [tenant] = await platformDb
    .select()
    .from(tenants)
    .where(eq(tenants.subdomain, subdomain));
  if (!tenant) throw new Error("Tenant not found.");

  // Resolve user by email in platform DB
  const [user] = await platformDb
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase().trim()));
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
  await requireAdminAccess();
  if (!validateSubdomain(subdomain)) throw new Error("Invalid subdomain.");
  if (!validateUserId(userId)) throw new Error("Invalid user ID format.");

  const [tenant] = await platformDb
    .select()
    .from(tenants)
    .where(eq(tenants.subdomain, subdomain));
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
    .where(
      and(eq(tenantMembers.tenantId, tenant.id), eq(tenantMembers.userId, userId)),
    );

  revalidatePath("/admin/tenants");
  return { success: true };
}

/** Updates the role of an existing member. */
export async function updateTenantMemberRole(
  subdomain: string,
  userId: string,
  role: string,
) {
  await requireAdminAccess();
  if (!validateSubdomain(subdomain)) throw new Error("Invalid subdomain.");
  if (!validateUserId(userId)) throw new Error("Invalid user ID format.");

  const validRoles = ["owner", "admin", "editor", "viewer"];
  if (!validRoles.includes(role)) throw new Error("Invalid role.");

  const [tenant] = await platformDb
    .select()
    .from(tenants)
    .where(eq(tenants.subdomain, subdomain));
  if (!tenant) throw new Error("Tenant not found.");

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
    .where(
      and(eq(tenantMembers.tenantId, tenant.id), eq(tenantMembers.userId, userId)),
    );

  // Keep tenant DB user role in sync
  const tenantDb = createTenantDb(tenant.id, decryptDbUrl(tenant.dbUrl));
  await tenantDb.update(users).set({ role }).where(eq(users.id, userId));

  revalidatePath("/admin/tenants");
  return { success: true };
}
