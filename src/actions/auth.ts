"use server";

import { revalidatePath } from "next/cache";

import bcrypt from "bcryptjs";
import { and, eq, gt, isNull } from "drizzle-orm";

import { auth, signIn, signOut } from "@/auth";
import { createTenantDb, platformDb } from "@/db";
import { notifications, passwordResetTokens, tenantMembers, tenants, userInvitations, users } from "@/db/schema";
import { sendInvitationEmail, sendPasswordResetEmail } from "@/lib/email";
import { getDb } from "@/lib/tenant-context";
import { decryptDbUrl } from "@/lib/tenant-db";

// ─── Logout ─────────────────────────────────────────────────────────────────
export async function logoutAction() {
  await signOut({ redirectTo: "/auth/v1/login" });
}

// ─── Switch Active Tenant ─────────────────────────────────────────────────────
// Validates membership server-side. The caller (TenantSwitcher client component)
// must then call session.update({ activeTenantId }) to persist the change in JWT.
export async function validateTenantSwitchAction(tenantId: string): Promise<{
  ok: boolean;
  tenantName?: string;
  error?: string;
}> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Not authenticated." };

  const membership = await platformDb.query.tenantMembers.findFirst({
    where: and(eq(tenantMembers.userId, session.user.id), eq(tenantMembers.tenantId, tenantId)),
  });

  if (!membership) return { ok: false, error: "You are not a member of this workspace." };

  const [tenant] = await platformDb.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId));

  return { ok: true, tenantName: tenant?.name };
}

// ─── Get Tenant Memberships ───────────────────────────────────────────────────
export async function getTenantMembershipsAction() {
  const session = await auth();
  if (!session?.user?.id) return [];

  return platformDb
    .select({
      tenantId: tenantMembers.tenantId,
      role: tenantMembers.role,
      tenantName: tenants.name,
      tenantSubdomain: tenants.subdomain,
      tenantSettings: tenants.settings,
    })
    .from(tenantMembers)
    .innerJoin(tenants, eq(tenantMembers.tenantId, tenants.id))
    .where(eq(tenantMembers.userId, session.user.id));
}

// ─── Register ────────────────────────────────────────────────────────────────
export async function registerAction(data: { name?: string; email: string; password: string }) {
  const db = await getDb();
  const { name, email, password } = data;

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));

  if (existing) {
    return { error: "An account with this email already exists." };
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  await db.insert(users).values({
    name: name ?? email.split("@")[0],
    email,
    password: hashedPassword,
    role: "user",
  });

  // Auto sign-in after registration
  try {
    await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
  } catch {
    // redirect is handled by the caller
  }

  return { success: true };
}

// ─── Forgot Password ─────────────────────────────────────────────────────────
export async function forgotPasswordAction(email: string) {
  const db = await getDb();
  const [user] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.email, email));

  // Return success even if user not found (prevents email enumeration)
  if (!user) return { success: true };

  // Delete existing tokens for this email
  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.identifier, email));

  const token = crypto.randomUUID();
  const expires = new Date(Date.now() + 1000 * 60 * 60); // 1 hour

  await db.insert(passwordResetTokens).values({ identifier: email, token, expires });

  await sendPasswordResetEmail(email, token);

  return { success: true };
}

// ─── Reset Password ───────────────────────────────────────────────────────────
export async function resetPasswordAction(data: { email: string; token: string; password: string }) {
  const db = await getDb();
  const { email, token, password } = data;

  const [resetToken] = await db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.identifier, email),
        eq(passwordResetTokens.token, token),
        gt(passwordResetTokens.expires, new Date()),
      ),
    );

  if (!resetToken) {
    return { error: "Invalid or expired reset link. Please request a new one." };
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  await db.update(users).set({ password: hashedPassword }).where(eq(users.email, email));

  // Invalidate the token
  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.identifier, email));

  return { success: true };
}

// ─── Invite User ──────────────────────────────────────────────────────────────
export async function inviteUserAction(data: {
  email: string;
  role: string;
  invitedById: string;
  invitedByName: string;
}) {
  const { email, role, invitedById, invitedByName } = data;

  // Check user doesn't already exist on the platform
  const [existing] = await platformDb.select({ id: users.id }).from(users).where(eq(users.email, email));

  if (existing) {
    return { error: "This email is already registered." };
  }

  // Revoke existing pending invitations on the platform
  await platformDb
    .delete(userInvitations)
    .where(and(eq(userInvitations.email, email), isNull(userInvitations.acceptedAt)));

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await platformDb.insert(userInvitations).values({
    email,
    token,
    role,
    invitedById,
    expiresAt,
  });

  const emailResult = await sendInvitationEmail(email, token, invitedByName, role);
  revalidatePath("/dashboard/users");

  if (!emailResult.success) {
    // Invitation is saved in DB — share the link manually if email failed
    return {
      success: false,
      emailError: emailResult.error ?? "Unknown email error",
      inviteUrl: emailResult.inviteUrl,
    };
  }

  return { success: true };
}

// ─── Accept Invitation ────────────────────────────────────────────────────────
export async function acceptInvitationAction(data: { token: string; name: string; password: string }) {
  const { token, name, password } = data;

  const [invitation] = await platformDb
    .select()
    .from(userInvitations)
    .where(and(eq(userInvitations.token, token), gt(userInvitations.expiresAt, new Date())));

  if (!invitation) {
    return { error: "Invalid or expired invitation." };
  }

  if (invitation.acceptedAt) {
    return { error: "This invitation has already been used." };
  }

  // Reuse existing platform account if one already exists for this email
  // (handles double-submit retries and re-invites of existing users)
  const [existingUser] = await platformDb.select().from(users).where(eq(users.email, invitation.email));

  let userId: string;
  if (existingUser) {
    userId = existingUser.id;
  } else {
    const hashedPassword = await bcrypt.hash(password, 12);
    userId = crypto.randomUUID();
    await platformDb.insert(users).values({
      id: userId,
      name,
      email: invitation.email,
      password: hashedPassword,
      role: invitation.role,
    });
  }

  // Auto-provision tenant membership if this was a tenant-scoped invitation
  if (invitation.tenantId && invitation.tenantRole) {
    const [tenant] = await platformDb.select().from(tenants).where(eq(tenants.id, invitation.tenantId));

    if (tenant) {
      await platformDb
        .insert(tenantMembers)
        .values({ tenantId: tenant.id, userId, role: invitation.tenantRole })
        .onConflictDoNothing();

      // Best-effort: sync user record to tenant DB for FK constraints.
      // Non-fatal — membership is recorded in the platform DB above; the tenant
      // DB row will be created on the user's first authenticated request if missed here.
      try {
        const tenantDb = createTenantDb(tenant.id, decryptDbUrl(tenant.dbUrl));
        await tenantDb
          .insert(users)
          .values({ id: userId, name, email: invitation.email, role: invitation.tenantRole })
          .onConflictDoNothing();
      } catch (err) {
        console.error("[acceptInvitation] tenant DB sync failed, membership still recorded:", err);
      }

      revalidatePath(`/admin/tenants/${tenant.subdomain}`);
    }
  }

  await platformDb.update(userInvitations).set({ acceptedAt: new Date() }).where(eq(userInvitations.id, invitation.id));

  return { success: true, email: invitation.email };
}

// ─── Update User Role ─────────────────────────────────────────────────────────
export async function updateUserRoleAction(userId: string, role: string) {
  const { requireAdminAccess } = await import("@/lib/auth-guard");
  await requireAdminAccess();
  await platformDb.update(users).set({ role }).where(eq(users.id, userId));
  revalidatePath("/dashboard/users");
  return { success: true };
}

// ─── Delete User ──────────────────────────────────────────────────────────────
export async function deleteUserAction(userId: string) {
  const { requireAdminAccess } = await import("@/lib/auth-guard");
  await requireAdminAccess();
  await platformDb.delete(users).where(eq(users.id, userId));
  revalidatePath("/dashboard/users");
  return { success: true };
}

// ─── Get All Users ────────────────────────────────────────────────────────────
export async function getAllUsersAction() {
  return await platformDb
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      emailVerified: users.emailVerified,
      image: users.image,
    })
    .from(users);
}

// ─── Get Pending Invitations ──────────────────────────────────────────────────
export async function getPendingInvitationsAction() {
  return await platformDb
    .select()
    .from(userInvitations)
    .where(and(isNull(userInvitations.acceptedAt), gt(userInvitations.expiresAt, new Date())));
}

// ─── Notifications ────────────────────────────────────────────────────────────
export async function getNotificationsAction(userId: string) {
  const db = await getDb();
  return await db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(notifications.createdAt);
}

export async function markNotificationReadAction(notificationId: string) {
  const db = await getDb();
  await db.update(notifications).set({ isRead: true }).where(eq(notifications.id, notificationId));
}

export async function markAllNotificationsReadAction(userId: string) {
  const db = await getDb();
  await db.update(notifications).set({ isRead: true }).where(eq(notifications.userId, userId));
  revalidatePath("/dashboard");
}

export async function createNotificationAction(data: {
  userId: string;
  type: string;
  title: string;
  message?: string;
  link?: string;
}) {
  const db = await getDb();
  await db.insert(notifications).values(data);
}

export async function createNotificationsBatch(
  rows: { userId: string; type: string; title: string; message?: string; link?: string }[],
) {
  if (rows.length === 0) return;
  const db = await getDb();
  await db.insert(notifications).values(rows);
}

// ─── Change Own Password ──────────────────────────────────────────────────────
export async function changePasswordAction(data: { currentPassword: string; newPassword: string }) {
  const db = await getDb();
  const { auth } = await import("@/auth");
  const session = await auth();
  if (!session?.user?.id) return { error: "Not authenticated." };

  const [user] = await db
    .select({ id: users.id, password: users.password })
    .from(users)
    .where(eq(users.id, session.user.id));

  if (!user) return { error: "User not found." };
  if (!user.password) return { error: "This account uses social login — password change is not available." };

  const valid = await bcrypt.compare(data.currentPassword, user.password);
  if (!valid) return { error: "Current password is incorrect." };

  if (data.newPassword.length < 8) return { error: "New password must be at least 8 characters." };

  const hashed = await bcrypt.hash(data.newPassword, 12);
  await db.update(users).set({ password: hashed }).where(eq(users.id, user.id));

  return { success: true };
}

// ─── Admin: Send Password Reset to Another User ───────────────────────────────
export async function adminSendPasswordResetAction(targetUserId: string) {
  const { requireAdminAccess } = await import("@/lib/auth-guard");
  await requireAdminAccess();
  const db = await getDb();

  const [user] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, targetUserId));

  if (!user?.email) return { error: "User not found." };

  // Reuse the existing forgot-password flow
  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.identifier, user.email));

  const token = crypto.randomUUID();
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24 hours

  await db.insert(passwordResetTokens).values({ identifier: user.email, token, expires });

  const emailResult = await sendPasswordResetEmail(user.email, token);

  if (!emailResult?.success) {
    // Return the reset URL so admin can share it manually
    const APP_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
    const resetUrl = `${APP_URL}/auth/v1/reset-password?token=${token}&email=${encodeURIComponent(user.email)}`;
    return { success: false, emailError: true, resetUrl };
  }

  return { success: true };
}
