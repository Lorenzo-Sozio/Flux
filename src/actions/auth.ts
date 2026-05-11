"use server";

import { signIn, signOut } from "@/auth";
import { getDb } from "@/lib/tenant-context";
import {
  notifications,
  passwordResetTokens,
  userInvitations,
  users,
} from "@/db/schema";
import { sendInvitationEmail, sendPasswordResetEmail } from "@/lib/email";
import bcrypt from "bcryptjs";
import { and, eq, gt } from "drizzle-orm";
import { revalidatePath } from "next/cache";

// ─── Logout ─────────────────────────────────────────────────────────────────
export async function logoutAction() {
  await signOut({ redirectTo: "/auth/v1/login" });
}

// ─── Register ────────────────────────────────────────────────────────────────
export async function registerAction(data: {

  name?: string;
  email: string;
  password: string;
}) {
  const db = await getDb();
  const { name, email, password } = data;

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));

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
  const [user] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, email));

  // Return success even if user not found (prevents email enumeration)
  if (!user) return { success: true };

  // Delete existing tokens for this email
  await db
    .delete(passwordResetTokens)
    .where(eq(passwordResetTokens.identifier, email));

  const token = crypto.randomUUID();
  const expires = new Date(Date.now() + 1000 * 60 * 60); // 1 hour

  await db.insert(passwordResetTokens).values({ identifier: email, token, expires });

  await sendPasswordResetEmail(email, token);

  return { success: true };
}

// ─── Reset Password ───────────────────────────────────────────────────────────
export async function resetPasswordAction(data: {

  email: string;
  token: string;
  password: string;
}) {
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
      )
    );

  if (!resetToken) {
    return { error: "Invalid or expired reset link. Please request a new one." };
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  await db.update(users).set({ password: hashedPassword }).where(eq(users.email, email));

  // Invalidate the token
  await db
    .delete(passwordResetTokens)
    .where(eq(passwordResetTokens.identifier, email));

  return { success: true };
}

// ─── Invite User ──────────────────────────────────────────────────────────────
export async function inviteUserAction(data: {

  email: string;
  role: string;
  invitedById: string;
  invitedByName: string;
}) {
  const db = await getDb();
  const { email, role, invitedById, invitedByName } = data;

  // Check user doesn't already exist
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));

  if (existing) {
    return { error: "This email is already registered." };
  }

  // Revoke existing pending invitations
  await db
    .delete(userInvitations)
    .where(and(eq(userInvitations.email, email), eq(userInvitations.acceptedAt, null as any)));

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await db.insert(userInvitations).values({
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
export async function acceptInvitationAction(data: {

  token: string;
  name: string;
  password: string;
}) {
  const db = await getDb();
  const { token, name, password } = data;

  const [invitation] = await db
    .select()
    .from(userInvitations)
    .where(
      and(
        eq(userInvitations.token, token),
        gt(userInvitations.expiresAt, new Date()),
      )
    );

  if (!invitation) {
    return { error: "Invalid or expired invitation." };
  }

  if (invitation.acceptedAt) {
    return { error: "This invitation has already been used." };
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  await db.insert(users).values({
    name,
    email: invitation.email,
    password: hashedPassword,
    role: invitation.role,
  });

  // Mark invitation as accepted
  await db
    .update(userInvitations)
    .set({ acceptedAt: new Date() })
    .where(eq(userInvitations.id, invitation.id));

  return { success: true, email: invitation.email };
}

// ─── Update User Role ─────────────────────────────────────────────────────────
export async function updateUserRoleAction(userId: string, role: string) {
  const { requireAdminAccess } = await import("@/lib/auth-guard");
  await requireAdminAccess();
  const db = await getDb();
  await db.update(users).set({ role }).where(eq(users.id, userId));
  revalidatePath("/dashboard/users");
  return { success: true };
}

// ─── Delete User ──────────────────────────────────────────────────────────────
export async function deleteUserAction(userId: string) {
  const { requireAdminAccess } = await import("@/lib/auth-guard");
  await requireAdminAccess();
  const db = await getDb();
  await db.delete(users).where(eq(users.id, userId));
  revalidatePath("/dashboard/users");
  return { success: true };
}

// ─── Get All Users ────────────────────────────────────────────────────────────
export async function getAllUsersAction() {
  const db = await getDb();
  return await db
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
  const db = await getDb();
  return await db
    .select()
    .from(userInvitations)
    .where(
      and(
        eq(userInvitations.acceptedAt, null as any),
        gt(userInvitations.expiresAt, new Date()),
      )
    );
}

// ─── Notifications ────────────────────────────────────────────────────────────
export async function getNotificationsAction(userId: string) {
  const db = await getDb();
  return await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(notifications.createdAt);
}

export async function markNotificationReadAction(notificationId: string) {
  const db = await getDb();
  await db
    .update(notifications)
    .set({ isRead: true })
    .where(eq(notifications.id, notificationId));
}

export async function markAllNotificationsReadAction(userId: string) {
  const db = await getDb();
  await db
    .update(notifications)
    .set({ isRead: true })
    .where(eq(notifications.userId, userId));
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
export async function changePasswordAction(data: {

  currentPassword: string;
  newPassword: string;
}) {
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

  const [user] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, targetUserId));

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
