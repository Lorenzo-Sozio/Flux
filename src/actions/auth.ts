"use server";

import { revalidatePath } from "next/cache";

import bcrypt from "bcryptjs";
import { and, desc, eq, gt, isNull } from "drizzle-orm";

import { auth, signIn, signOut } from "@/auth";
import { createTenantDb, platformDb } from "@/db";
import { notifications, passwordResetTokens, tenantMembers, tenants, userInvitations, users } from "@/db/schema";
import { appUrl } from "@/lib/app-url";
import { requireActor, requireCapability } from "@/lib/auth-guard";
import { sendInvitationEmail, sendPasswordResetEmail } from "@/lib/email";
import { assignableRoles, normalizeTenantRole, outranks } from "@/lib/permissions";
import { getCurrentTenantId, getDb } from "@/lib/tenant-context";
import { decryptDbUrl } from "@/lib/tenant-db";

/**
 * Resolves the acting user together with the workspace they are acting in.
 *
 * Every people-management action below needs both: the capability answers "may
 * you manage users", and the tenant answers *whose* users. The second half was
 * missing, which is how a workspace admin could read, re-role and delete
 * accounts belonging to other customers (audit rilievi P-04, P-05).
 */
async function requireUserAdminContext() {
  const actor = await requireCapability("user:manage");
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("No active workspace.");
  return { actor, tenantId };
}

/** The membership row for a user in a workspace, or undefined when not a member. */
async function findMembership(tenantId: string, userId: string) {
  return platformDb.query.tenantMembers.findFirst({
    where: and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId)),
  });
}

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
// Accounts and credentials live on the PLATFORM database. This used to call
// getDb(), which resolves the tenant from a request header that public auth
// pages never carry, so registration threw before writing anything and the form
// reported a generic failure (audit rilievo B-03).
export async function registerAction(data: { name?: string; email: string; password: string }) {
  const { name, password } = data;
  const email = data.email.trim().toLowerCase();

  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const [existing] = await platformDb.select({ id: users.id }).from(users).where(eq(users.email, email));

  if (existing) {
    return { error: "An account with this email already exists." };
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  await platformDb.insert(users).values({
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
// Platform DB: a public page carries no tenant context (audit rilievo B-03).
export async function forgotPasswordAction(rawEmail: string) {
  const email = rawEmail.trim().toLowerCase();
  const [user] = await platformDb
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, email));

  // Return success even if user not found (prevents email enumeration)
  if (!user) return { success: true };

  // Delete existing tokens for this email
  await platformDb.delete(passwordResetTokens).where(eq(passwordResetTokens.identifier, email));

  const token = crypto.randomUUID();
  const expires = new Date(Date.now() + 1000 * 60 * 60); // 1 hour

  await platformDb.insert(passwordResetTokens).values({ identifier: email, token, expires });

  const sent = await sendPasswordResetEmail(email, token);

  // Report a delivery failure rather than always claiming the mail was sent. The
  // address is not echoed back, so this still reveals nothing about the account.
  if (sent && sent.success === false) {
    return { error: "We could not send the email right now. Please try again in a few minutes." };
  }

  return { success: true };
}

// ─── Reset Password ───────────────────────────────────────────────────────────
// Platform DB: the credential being reset is the one the login checks. Writing it
// to the tenant database left the real password untouched while reporting success
// (audit rilievo B-03).
export async function resetPasswordAction(data: { email: string; token: string; password: string }) {
  const { token, password } = data;
  const email = data.email.trim().toLowerCase();

  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const [resetToken] = await platformDb
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

  await platformDb.update(users).set({ password: hashedPassword }).where(eq(users.email, email));

  // Invalidate the token
  await platformDb.delete(passwordResetTokens).where(eq(passwordResetTokens.identifier, email));

  return { success: true };
}

// ─── Invite User ──────────────────────────────────────────────────────────────
/**
 * Invites a user into the CURRENT workspace.
 *
 * This action previously had no guard of any kind and took both the role and the
 * inviter's identity from the caller. Anyone able to reach it could mint an
 * invitation carrying the platform role `owner` and, on acceptance, hold staff
 * credentials over every customer (audit rilievi P-02, P-03).
 *
 * Now: the caller must hold `user:manage`, the role is a workspace role validated
 * against what the caller may actually grant, the inviter is read from the
 * session, and the invitation is bound to the caller's workspace. The platform
 * role of an invited user is always the non-privileged default.
 */
export async function inviteUserAction(data: { email: string; role: string }) {
  const { actor, tenantId } = await requireUserAdminContext();

  const email = data.email.trim().toLowerCase();
  if (!email.includes("@")) return { error: "Enter a valid email address." };

  const tenantRole = normalizeTenantRole(data.role);
  if (!assignableRoles(actor).includes(tenantRole)) {
    return { error: "You cannot grant a role higher than your own." };
  }

  const [inviter] = await platformDb
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, actor.userId));
  const invitedByName = inviter?.name ?? inviter?.email ?? "A teammate";

  const [existing] = await platformDb.select({ id: users.id }).from(users).where(eq(users.email, email));

  // An account can legitimately exist already and simply not be in this
  // workspace — that is an invitation, not a conflict.
  if (existing) {
    const membership = await findMembership(tenantId, existing.id);
    if (membership) return { error: "This person is already a member of this workspace." };
  }

  // Revoke this workspace's pending invitations for the same address
  await platformDb
    .delete(userInvitations)
    .where(
      and(eq(userInvitations.email, email), eq(userInvitations.tenantId, tenantId), isNull(userInvitations.acceptedAt)),
    );

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await platformDb.insert(userInvitations).values({
    email,
    token,
    role: "user", // platform role — never privileged via an invitation
    tenantId,
    tenantRole,
    invitedById: actor.userId,
    expiresAt,
  });

  const emailResult = await sendInvitationEmail(email, token, invitedByName, tenantRole);
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
    if (password.length < 8) {
      return { error: "Password must be at least 8 characters." };
    }
    const hashedPassword = await bcrypt.hash(password, 12);
    userId = crypto.randomUUID();
    await platformDb.insert(users).values({
      id: userId,
      name,
      email: invitation.email,
      // The PLATFORM role is Flux staff, never something an invitation grants.
      // Workspace authority comes from the tenant membership written below.
      role: "user",
      password: hashedPassword,
    });
  }

  // Auto-provision tenant membership if this was a tenant-scoped invitation
  if (invitation.tenantId && invitation.tenantRole) {
    const [tenant] = await platformDb.select().from(tenants).where(eq(tenants.id, invitation.tenantId));

    if (tenant) {
      const tenantRole = normalizeTenantRole(invitation.tenantRole);
      await platformDb
        .insert(tenantMembers)
        .values({ tenantId: tenant.id, userId, role: tenantRole })
        .onConflictDoNothing();

      // Best-effort: sync user record to tenant DB for FK constraints.
      // Non-fatal — membership is recorded in the platform DB above; the tenant
      // DB row will be created on the user's first authenticated request if missed here.
      try {
        const tenantDb = createTenantDb(tenant.id, decryptDbUrl(tenant.dbUrl));
        await tenantDb
          .insert(users)
          .values({ id: userId, name, email: invitation.email, role: tenantRole })
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
/**
 * Changes a member's role WITHIN the current workspace.
 *
 * It used to write `user.role`, the platform staff field, for any user id on the
 * platform. That handed a workspace admin two things they should never have: the
 * ability to re-role customers of other tenants, and a one-click path to staff
 * privileges over the whole platform via /admin/login (audit rilievi P-02, P-05).
 */
export async function updateUserRoleAction(userId: string, role: string) {
  const { actor, tenantId } = await requireUserAdminContext();

  const nextRole = normalizeTenantRole(role);
  if (!assignableRoles(actor).includes(nextRole)) {
    return { error: "You cannot grant a role higher than your own." };
  }

  if (userId === actor.userId) {
    return { error: "You cannot change your own role. Ask another admin." };
  }

  const membership = await findMembership(tenantId, userId);
  if (!membership) return { error: "That user is not a member of this workspace." };

  // An admin must not be able to demote or take over an owner.
  if (!actor.isPlatformStaff && !outranks(actor.tenantRole, membership.role) && actor.tenantRole !== "owner") {
    return { error: "You cannot change the role of someone at or above your own level." };
  }

  // A workspace must never be left without an owner.
  if (membership.role === "owner" && nextRole !== "owner") {
    const owners = await platformDb
      .select({ id: tenantMembers.id })
      .from(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.role, "owner")));
    if (owners.length <= 1) return { error: "A workspace must keep at least one owner." };
  }

  await platformDb.update(tenantMembers).set({ role: nextRole }).where(eq(tenantMembers.id, membership.id));

  // Mirror into the tenant DB, where FK-bound rows carry a role copy.
  const db = await getDb();
  await db.update(users).set({ role: nextRole }).where(eq(users.id, userId));

  revalidatePath("/dashboard/users");
  return { success: true };
}

// ─── Delete User ──────────────────────────────────────────────────────────────
/**
 * Removes a member FROM the current workspace.
 *
 * It used to delete the platform account outright, for any id, with no check that
 * the target belonged to the caller's workspace — so one customer's admin could
 * delete another customer's users (audit rilievo P-05). Revoking membership is
 * also the correct semantics: the person may belong to other workspaces.
 */
export async function deleteUserAction(userId: string) {
  const { actor, tenantId } = await requireUserAdminContext();

  if (userId === actor.userId) {
    return { error: "You cannot remove yourself from the workspace." };
  }

  const membership = await findMembership(tenantId, userId);
  if (!membership) return { error: "That user is not a member of this workspace." };

  if (membership.role === "owner" && !actor.isPlatformStaff && actor.tenantRole !== "owner") {
    return { error: "Only an owner can remove another owner." };
  }

  if (membership.role === "owner") {
    const owners = await platformDb
      .select({ id: tenantMembers.id })
      .from(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.role, "owner")));
    if (owners.length <= 1) return { error: "A workspace must keep at least one owner." };
  }

  await platformDb.delete(tenantMembers).where(eq(tenantMembers.id, membership.id));

  revalidatePath("/dashboard/users");
  return { success: true };
}

// ─── Get All Users ────────────────────────────────────────────────────────────
/**
 * Members of the CURRENT workspace, with their workspace role.
 *
 * The unfiltered version returned every account on the platform, so one
 * customer's admin screen listed the names and email addresses of every other
 * customer's staff (audit rilievo P-04).
 */
export async function getAllUsersAction() {
  const { tenantId } = await requireUserAdminContext();

  return platformDb
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: tenantMembers.role,
      emailVerified: users.emailVerified,
      image: users.image,
    })
    .from(tenantMembers)
    .innerJoin(users, eq(users.id, tenantMembers.userId))
    .where(eq(tenantMembers.tenantId, tenantId));
}

// ─── Get Pending Invitations ──────────────────────────────────────────────────
/** Pending invitations for the current workspace only (audit rilievo P-04). */
export async function getPendingInvitationsAction() {
  const { tenantId } = await requireUserAdminContext();

  return platformDb
    .select()
    .from(userInvitations)
    .where(
      and(
        eq(userInvitations.tenantId, tenantId),
        isNull(userInvitations.acceptedAt),
        gt(userInvitations.expiresAt, new Date()),
      ),
    );
}

// ─── Notifications ────────────────────────────────────────────────────────────
//
// ⚠️ All three of these took the user id from the caller, and a server action's
// caller is the browser. Anyone with a session could read another person's
// notifications by passing their id, or mark them all read. The id now comes from
// the session, and the argument is gone.

/** How many notifications the bell is ever given. */
const NOTIFICATION_PAGE = 50;

export async function getNotificationsAction() {
  const actor = await requireActor();
  const db = await getDb();
  return (
    db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, actor.userId))
      // Newest first, and capped. Ascending and unbounded meant the bell was handed
      // the whole history to draw ten rows (audit rilievo U-11).
      .orderBy(desc(notifications.createdAt))
      .limit(NOTIFICATION_PAGE)
  );
}

export async function markNotificationReadAction(notificationId: string) {
  const actor = await requireActor();
  const db = await getDb();
  // Scoped by owner in the WHERE rather than checked first: one statement, and no
  // window between the check and the write.
  await db
    .update(notifications)
    .set({ isRead: true })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, actor.userId)));
}

export async function markAllNotificationsReadAction() {
  const actor = await requireActor();
  const db = await getDb();
  await db.update(notifications).set({ isRead: true }).where(eq(notifications.userId, actor.userId));
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
// Platform DB: credentials are checked against the platform account, so writing
// the new hash into the tenant copy changed nothing while reporting success.
export async function changePasswordAction(data: { currentPassword: string; newPassword: string }) {
  const session = await auth();
  if (!session?.user?.id) return { error: "Not authenticated." };

  const [user] = await platformDb
    .select({ id: users.id, password: users.password })
    .from(users)
    .where(eq(users.id, session.user.id));

  if (!user) return { error: "User not found." };
  if (!user.password) return { error: "This account uses social login — password change is not available." };

  const valid = await bcrypt.compare(data.currentPassword, user.password);
  if (!valid) return { error: "Current password is incorrect." };

  if (data.newPassword.length < 8) return { error: "New password must be at least 8 characters." };

  const hashed = await bcrypt.hash(data.newPassword, 12);
  await platformDb.update(users).set({ password: hashed }).where(eq(users.id, user.id));

  return { success: true };
}

// ─── Admin: Send Password Reset to Another User ───────────────────────────────
// Platform DB for the token, and the target must be a member of the caller's own
// workspace — otherwise an admin could trigger a reset for any account anywhere.
export async function adminSendPasswordResetAction(targetUserId: string) {
  const { tenantId } = await requireUserAdminContext();

  const membership = await findMembership(tenantId, targetUserId);
  if (!membership) return { error: "That user is not a member of this workspace." };

  const [user] = await platformDb
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, targetUserId));

  if (!user?.email) return { error: "User not found." };

  // Reuse the existing forgot-password flow
  await platformDb.delete(passwordResetTokens).where(eq(passwordResetTokens.identifier, user.email));

  const token = crypto.randomUUID();
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24 hours

  await platformDb.insert(passwordResetTokens).values({ identifier: user.email, token, expires });

  const emailResult = await sendPasswordResetEmail(user.email, token);

  if (!emailResult?.success) {
    // Return the reset URL so the admin can share it by hand
    const resetUrl = appUrl(`/auth/v1/reset-password?token=${token}&email=${encodeURIComponent(user.email)}`);
    return { success: false, emailError: true, resetUrl };
  }

  return { success: true };
}
