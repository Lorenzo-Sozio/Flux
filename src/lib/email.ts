/**
 * email.ts — system email helpers (auth, invitations, task reminders).
 * Campaign email is handled separately via email-provider + marketing.ts.
 */
import { sendEmail } from "@/lib/email-provider";

const APP_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

/**
 * Strip CR/LF from any string used in email headers (To, Subject, From…).
 * Prevents Email Header Injection attacks.
 */
function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n\t]/g, " ").trim();
}

// ─── Password Reset ───────────────────────────────────────────────────────────

export async function sendPasswordResetEmail(email: string, token: string) {
  const resetUrl = `${APP_URL}/auth/v1/reset-password?token=${token}&email=${encodeURIComponent(email)}`;

  if (!process.env.RESEND_API_KEY && !process.env.SMTP_HOST) {
    console.log("[DEV] Password reset link:", resetUrl);
    return;
  }

  await sendEmail({
    to: email,
    subject: "Reset your password",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2>Reset your password</h2>
        <p>Click the button below to reset your password. This link expires in 1 hour.</p>
        <a href="${resetUrl}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">
          Reset Password
        </a>
        <p style="margin-top:16px;color:#6b7280;font-size:13px">If you didn't request this, you can safely ignore it.</p>
      </div>`,
  });
}

// ─── Invitation ───────────────────────────────────────────────────────────────

export async function sendInvitationEmail(email: string, token: string, invitedByName: string, role: string) {
  const inviteUrl = `${APP_URL}/auth/v1/accept-invitation?token=${token}`;

  if (!process.env.RESEND_API_KEY && !process.env.SMTP_HOST) {
    console.log("[DEV] Invitation link:", inviteUrl);
    return;
  }

  const safeName = sanitizeHeader(invitedByName);
  const safeRole = sanitizeHeader(role);
  await sendEmail({
    to: sanitizeHeader(email),
    subject: `${safeName} invited you to join the CRM`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2>You've been invited</h2>
        <p><strong>${safeName}</strong> invited you as <strong>${safeRole}</strong>.</p>
        <a href="${inviteUrl}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">
          Accept Invitation
        </a>
        <p style="margin-top:16px;color:#6b7280;font-size:13px">This invitation expires in 7 days.</p>
      </div>`,
  });
}

// ─── Email Verification ───────────────────────────────────────────────────────

export async function sendVerificationEmail(email: string, token: string) {
  const verifyUrl = `${APP_URL}/auth/verify-email?token=${token}&email=${encodeURIComponent(email)}`;

  if (!process.env.RESEND_API_KEY && !process.env.SMTP_HOST) {
    console.log("[DEV] Email verification link:", verifyUrl);
    return;
  }

  await sendEmail({
    to: email,
    subject: "Verify your email address",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2>Verify your email</h2>
        <p>Click the button below to verify your email address.</p>
        <a href="${verifyUrl}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">
          Verify Email
        </a>
      </div>`,
  });
}

// ─── Call / Meeting Invite ────────────────────────────────────────────────────

export async function sendCallInviteEmail(
  to: string,
  contactName: string,
  description: string,
  scheduledAt: Date,
) {
  if (!process.env.RESEND_API_KEY && !process.env.SMTP_HOST) {
    console.log("[DEV] Call invite email to:", to);
    return;
  }

  const dateStr = scheduledAt.toLocaleString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  await sendEmail({
    to: sanitizeHeader(to),
    subject: sanitizeHeader(`Call scheduled: ${description}`),
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2>Call Appointment</h2>
        <p>Hi ${contactName},</p>
        <p>A call has been scheduled with you.</p>
        <table style="border-collapse:collapse;width:100%;margin:16px 0">
          <tr>
            <td style="padding:8px 12px;background:#f3f4f6;font-weight:600;border-radius:4px 0 0 4px;white-space:nowrap">Topic</td>
            <td style="padding:8px 12px;border:1px solid #e5e7eb">${description}</td>
          </tr>
          <tr>
            <td style="padding:8px 12px;background:#f3f4f6;font-weight:600;border-radius:4px 0 0 4px;white-space:nowrap">Date & Time</td>
            <td style="padding:8px 12px;border:1px solid #e5e7eb">${dateStr}</td>
          </tr>
        </table>
        <p style="color:#6b7280;font-size:13px">If you have any questions, please reply to this email.</p>
      </div>`,
  });
}

// ─── Activity Reminder ────────────────────────────────────────────────────────

export async function sendActivityReminderEmail(
  to: string,
  activityType: string,
  description: string,
  scheduledAt: Date,
  link: string,
) {
  if (!process.env.RESEND_API_KEY && !process.env.SMTP_HOST) {
    console.log("[DEV] Activity reminder email to:", to);
    return;
  }

  const dateStr = scheduledAt.toLocaleString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const typeLabel = activityType === "call" ? "Call" : "Meeting";

  await sendEmail({
    to: sanitizeHeader(to),
    subject: sanitizeHeader(`Reminder: ${typeLabel} today — ${description}`),
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2>${typeLabel} Reminder</h2>
        <p>You have a ${typeLabel.toLowerCase()} scheduled today.</p>
        <table style="border-collapse:collapse;width:100%;margin:16px 0">
          <tr>
            <td style="padding:8px 12px;background:#f3f4f6;font-weight:600;white-space:nowrap">Topic</td>
            <td style="padding:8px 12px;border:1px solid #e5e7eb">${description}</td>
          </tr>
          <tr>
            <td style="padding:8px 12px;background:#f3f4f6;font-weight:600;white-space:nowrap">Time</td>
            <td style="padding:8px 12px;border:1px solid #e5e7eb">${dateStr}</td>
          </tr>
        </table>
        <a href="${APP_URL}${link}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">
          View in CRM
        </a>
      </div>`,
  });
}

// ─── Task Due Reminder ────────────────────────────────────────────────────────

export async function sendTaskDueEmail(email: string, taskTitle: string, taskLink: string) {
  if (!process.env.RESEND_API_KEY && !process.env.SMTP_HOST) {
    console.log("[DEV] Task due email to:", email);
    return;
  }

  await sendEmail({
    to: sanitizeHeader(email),
    subject: sanitizeHeader(`Reminder: "${taskTitle}" is due today`),
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2>Task Reminder</h2>
        <p>Your task <strong>${taskTitle}</strong> is due today.</p>
        <a href="${APP_URL}${taskLink}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">
          View Task
        </a>
      </div>`,
  });
}
