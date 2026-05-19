"use server";

import { revalidatePath } from "next/cache";

import { and, eq, ne } from "drizzle-orm";

import { platformDb } from "@/db";
import { accounts, tenantMembers, tenants, users } from "@/db/schema";
import { requireAdminPanelAccess } from "@/lib/auth-guard";

export type TenantMembership = {
  tenantId: string;
  tenantName: string;
  subdomain: string;
  tenantRole: string;
};

export type PlatformUser = {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  image: string | null;
  hasPassword: boolean;
  hasGoogle: boolean;
  tenantMemberships: TenantMembership[];
};

export async function listPlatformUsers(): Promise<PlatformUser[]> {
  await requireAdminPanelAccess();

  const [rows, googleAccounts, memberships] = await Promise.all([
    platformDb
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        image: users.image,
        password: users.password,
      })
      .from(users)
      .orderBy(users.email),

    platformDb
      .select({ userId: accounts.userId })
      .from(accounts)
      .where(eq(accounts.provider, "google")),

    platformDb
      .select({
        userId: tenantMembers.userId,
        tenantId: tenantMembers.tenantId,
        tenantRole: tenantMembers.role,
        tenantName: tenants.name,
        subdomain: tenants.subdomain,
      })
      .from(tenantMembers)
      .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId)),
  ]);

  const googleUserIds = new Set(googleAccounts.map((a) => a.userId));

  const membershipsByUser = new Map<string, TenantMembership[]>();
  for (const m of memberships) {
    const list = membershipsByUser.get(m.userId) ?? [];
    list.push({
      tenantId: m.tenantId,
      tenantName: m.tenantName,
      subdomain: m.subdomain,
      tenantRole: m.tenantRole,
    });
    membershipsByUser.set(m.userId, list);
  }

  return rows.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    image: u.image,
    hasPassword: !!u.password,
    hasGoogle: googleUserIds.has(u.id),
    tenantMemberships: membershipsByUser.get(u.id) ?? [],
  }));
}

export async function updatePlatformUserRole(userId: string, newRole: string): Promise<void> {
  const session = await requireAdminPanelAccess();

  const validRoles = ["user", "admin", "owner"];
  if (!validRoles.includes(newRole)) {
    throw new Error(`Ruolo non valido: ${newRole}`);
  }

  const [target] = await platformDb.select({ role: users.role }).from(users).where(eq(users.id, userId));
  if (!target) throw new Error("Utente non trovato.");

  // Only owners can grant or revoke the owner role (prevents admin self-escalation).
  if (newRole === "owner" || target.role === "owner") {
    if (session.user.role !== "owner") {
      throw new Error("Solo un owner può promuovere altri utenti a owner o declassare un owner esistente.");
    }
  }

  // Prevent demoting a user that would leave the platform with zero owners.
  if (target.role === "owner" && newRole !== "owner") {
    const allOwners = await platformDb.select({ id: users.id }).from(users).where(eq(users.role, "owner"));

    if (allOwners.length === 1) {
      const isSelf = userId === session.user.id;
      throw new Error(
        isSelf
          ? "Non puoi rimuovere il tuo ruolo owner: sei l'unico owner della piattaforma. Promuovi prima un altro utente."
          : "Impossibile declassare questo utente: è l'unico owner della piattaforma. Promuovi prima un altro utente.",
      );
    }
  }

  await platformDb.update(users).set({ role: newRole }).where(eq(users.id, userId));

  revalidatePath("/admin/users");
}

export async function deletePlatformUser(userId: string): Promise<void> {
  const session = await requireAdminPanelAccess();

  if (userId === session.user.id) {
    throw new Error("Non puoi eliminare il tuo account.");
  }

  const [target] = await platformDb.select({ role: users.role }).from(users).where(eq(users.id, userId));
  if (!target) throw new Error("Utente non trovato.");

  if (target.role === "owner") {
    // Only owners can delete another owner
    if (session.user.role !== "owner") {
      throw new Error("Solo un owner può eliminare un altro owner dalla piattaforma.");
    }

    const otherOwners = await platformDb
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "owner"), ne(users.id, userId)));

    if (otherOwners.length === 0) {
      throw new Error("Impossibile eliminare l'unico owner della piattaforma. Promuovi prima un altro utente.");
    }
  }

  // Deleting from users cascades to tenantMembers, accounts, sessions automatically.
  await platformDb.delete(users).where(eq(users.id, userId));

  revalidatePath("/admin/users");
}
