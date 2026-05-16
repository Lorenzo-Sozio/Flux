"use server";

import { revalidatePath } from "next/cache";

import { eq } from "drizzle-orm";

import { platformDb } from "@/db";
import { accounts, users } from "@/db/schema";
import { requireAdminPanelAccess } from "@/lib/auth-guard";

export type PlatformUser = {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  image: string | null;
  hasPassword: boolean;
  hasGoogle: boolean;
};

export async function listPlatformUsers(): Promise<PlatformUser[]> {
  await requireAdminPanelAccess();

  const rows = await platformDb
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      image: users.image,
      password: users.password,
    })
    .from(users)
    .orderBy(users.email);

  // Fetch Google accounts in one query
  const googleAccounts = await platformDb
    .select({ userId: accounts.userId })
    .from(accounts)
    .where(eq(accounts.provider, "google"));

  const googleUserIds = new Set(googleAccounts.map((a) => a.userId));

  return rows.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    image: u.image,
    hasPassword: !!u.password,
    hasGoogle: googleUserIds.has(u.id),
  }));
}

export async function updatePlatformUserRole(userId: string, newRole: string): Promise<void> {
  const session = await requireAdminPanelAccess();

  const validRoles = ["user", "admin", "owner"];
  if (!validRoles.includes(newRole)) {
    throw new Error(`Ruolo non valido: ${newRole}`);
  }

  // Prevent demoting a user that would leave the platform with zero owners.
  // Applies both to self-demotion and demoting another user.
  if (newRole !== "owner") {
    const [target] = await platformDb.select({ role: users.role }).from(users).where(eq(users.id, userId));

    if (target?.role === "owner") {
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
  }

  await platformDb.update(users).set({ role: newRole }).where(eq(users.id, userId));

  revalidatePath("/admin/users");
}
