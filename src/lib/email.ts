/**
 * Email service using Resend.
 * Requires RESEND_API_KEY in .env and a verified sender domain.
 * For local dev without Resend, set RESEND_API_KEY=re_test_* and emails are logged.
 */
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY ?? "re_placeholder");

const FROM_EMAIL = process.env.EMAIL_FROM ?? "CRM <noreply@yourdomain.com>";
const APP_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

// --- Password Reset ---
export async function sendPasswordResetEmail(email: string, token: string) {
  const resetUrl = `${APP_URL}/auth/v1/reset-password?token=${token}&email=${encodeURIComponent(email)}`;

  if (!process.env.RESEND_API_KEY) {
    console.log("[DEV] Password reset link:", resetUrl);
    return;
  }

  await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: "Reset your password",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2>Reset your password</h2>
        <p>Click the button below to reset your password. This link expires in 1 hour.</p>
        <a href="${resetUrl}"
           style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">
          Reset Password
        </a>
        <p style="margin-top:16px;color:#6b7280;font-size:13px">
          If you didn't request a password reset, you can safely ignore this email.
        </p>
      </div>
    `,
  });
}

// --- User Invitation ---
export async function sendInvitationEmail(email: string, token: string, invitedByName: string, role: string) {
  const inviteUrl = `${APP_URL}/auth/v1/accept-invitation?token=${token}`;

  if (!process.env.RESEND_API_KEY) {
    console.log("[DEV] Invitation link:", inviteUrl);
    return;
  }

  await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: `${invitedByName} invited you to join the CRM`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2>You've been invited</h2>
        <p><strong>${invitedByName}</strong> has invited you to join the CRM platform as <strong>${role}</strong>.</p>
        <a href="${inviteUrl}"
           style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">
          Accept Invitation
        </a>
        <p style="margin-top:16px;color:#6b7280;font-size:13px">
          This invitation expires in 7 days.
        </p>
      </div>
    `,
  });
}

// --- Email Verification ---
export async function sendVerificationEmail(email: string, token: string) {
  const verifyUrl = `${APP_URL}/auth/verify-email?token=${token}&email=${encodeURIComponent(email)}`;

  if (!process.env.RESEND_API_KEY) {
    console.log("[DEV] Email verification link:", verifyUrl);
    return;
  }

  await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: "Verify your email address",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2>Verify your email</h2>
        <p>Click the button below to verify your email address.</p>
        <a href="${verifyUrl}"
           style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">
          Verify Email
        </a>
      </div>
    `,
  });
}

// --- Task Due Reminder ---
export async function sendTaskDueEmail(email: string, taskTitle: string, taskLink: string) {
  if (!process.env.RESEND_API_KEY) {
    console.log("[DEV] Task due email to:", email);
    return;
  }

  await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: `Reminder: "${taskTitle}" is due today`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2>Task Reminder</h2>
        <p>Your task <strong>${taskTitle}</strong> is due today.</p>
        <a href="${APP_URL}${taskLink}"
           style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">
          View Task
        </a>
      </div>
    `,
  });
}

// --- Generic Campaign Email ---
export async function sendCampaignEmail(
  to: string,
  subject: string,
  html: string,
  trackingPixelUrl?: string,
) {
  const body = trackingPixelUrl ? `${html}<img src="${trackingPixelUrl}" width="1" height="1" alt="" />` : html;

  if (!process.env.RESEND_API_KEY) {
    console.log("[DEV] Campaign email to:", to, "subject:", subject);
    return { success: true };
  }

  try {
    await resend.emails.send({ from: FROM_EMAIL, to, subject, html: body });
    return { success: true };
  } catch (err) {
    console.error("Campaign email error:", err);
    return { success: false, error: err };
  }
}
