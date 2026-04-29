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

/** Escape user-supplied strings before embedding in HTML email bodies. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Allow only http/https URLs in href attributes; falls back to "#". */
function safeHref(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol === "https:" || u.protocol === "http:") return url;
  } catch {
    /* invalid URL — fall through */
  }
  return "#";
}

// ─── Password Reset ───────────────────────────────────────────────────────────

export async function sendPasswordResetEmail(
  email: string,
  token: string,
): Promise<{ success: boolean; error?: string }> {
  const resetUrl = `${APP_URL}/auth/v1/reset-password?token=${token}&email=${encodeURIComponent(email)}`;

  const result = await sendEmail({
    to: sanitizeHeader(email),
    subject: "Reset your password",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2>Reset your password</h2>
        <p>Click the button below to reset your password. This link expires in 24 hours.</p>
        <a href="${resetUrl}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">
          Reset Password
        </a>
        <p style="margin-top:16px;color:#6b7280;font-size:13px">If you didn't request this, you can safely ignore it.</p>
      </div>`,
  });

  if (!result.success) console.error("[EMAIL] Password reset send failed:", result.error);
  else console.log("[EMAIL] Password reset sent to", email, "| link:", resetUrl);

  return result;
}

// ─── Invitation ───────────────────────────────────────────────────────────────

export async function sendInvitationEmail(
  email: string,
  token: string,
  invitedByName: string,
  role: string,
): Promise<{ success: boolean; inviteUrl: string; error?: string }> {
  const inviteUrl = `${APP_URL}/auth/v1/accept-invitation?token=${token}`;
  const safeName = sanitizeHeader(invitedByName);
  const safeRole = sanitizeHeader(role);

  const result = await sendEmail({
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

  if (!result.success) {
    console.error("[EMAIL] Invitation send failed:", result.error);
  } else {
    console.log("[EMAIL] Invitation sent to", email, "| link:", inviteUrl);
  }

  return { ...result, inviteUrl };
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

export async function sendCallInviteEmail(to: string, contactName: string, description: string, scheduledAt: Date) {
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

// ─── Appointment Invite / Update / Cancellation ───────────────────────────────

export interface AppointmentEmailData {
  title: string;
  description?: string | null;
  startAt: Date;
  endAt: Date;
  location?: string | null;
  locationUrl?: string | null;
  conferenceLink?: string | null;
  organizerName: string;
  icsContent: string; // pre-generated ICS string
  method: "REQUEST" | "CANCEL";
}

export async function sendAppointmentInviteEmail(
  to: { email: string; name: string },
  data: AppointmentEmailData,
  rsvpLinks?: { accept: string; decline: string; tentative: string },
): Promise<{ success: boolean; error?: string }> {
  const safe = (s: string) => sanitizeHeader(s);

  const startStr = data.startAt.toLocaleString("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const endStr = data.endAt.toLocaleString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const durationMs = data.endAt.getTime() - data.startAt.getTime();
  const durationMin = Math.round(durationMs / 60_000);
  const durationLabel =
    durationMin < 60
      ? `${durationMin} min`
      : `${Math.floor(durationMin / 60)}h${durationMin % 60 ? ` ${durationMin % 60}min` : ""}`;

  const isCancel = data.method === "CANCEL";
  const subject = isCancel ? safe(`Cancelled: ${data.title}`) : safe(`Invitation: ${data.title}`);

  const locationRow =
    (data.conferenceLink ?? data.locationUrl ?? data.location)
      ? `<tr>
        <td style="padding:8px 12px;background:#f3f4f6;font-weight:600;white-space:nowrap;border-radius:4px 0 0 4px">Luogo</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb">
          ${
            data.conferenceLink
              ? `<a href="${safeHref(data.conferenceLink)}" style="color:#2563eb">Collegamento video</a>`
              : data.locationUrl
                ? `<a href="${safeHref(data.locationUrl)}" style="color:#2563eb">${esc(data.locationUrl)}</a>`
                : esc(data.location ?? "")
          }
        </td>
      </tr>`
      : "";

  const rsvpSection =
    !isCancel && rsvpLinks
      ? `<div style="margin:24px 0">
        <p style="font-size:14px;color:#374151;margin-bottom:12px">Conferma la tua partecipazione:</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <a href="${rsvpLinks.accept}"
             style="display:inline-block;padding:10px 20px;background:#16a34a;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px">
            ✓ Accetta
          </a>
          <a href="${rsvpLinks.tentative}"
             style="display:inline-block;padding:10px 20px;background:#d97706;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px">
            ? Forse
          </a>
          <a href="${rsvpLinks.decline}"
             style="display:inline-block;padding:10px 20px;background:#dc2626;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px">
            ✗ Rifiuta
          </a>
        </div>
      </div>`
      : "";

  const html = isCancel
    ? `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
        <div style="background:#dc2626;color:#fff;padding:16px 24px;border-radius:8px 8px 0 0">
          <h2 style="margin:0;font-size:18px">Appuntamento annullato</h2>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px">
          <p>Salve ${esc(to.name)},</p>
          <p>L'appuntamento <strong>${esc(data.title)}</strong> è stato annullato da ${esc(data.organizerName)}.</p>
          <table style="border-collapse:collapse;width:100%;margin:16px 0">
            <tr>
              <td style="padding:8px 12px;background:#f3f4f6;font-weight:600;white-space:nowrap;border-radius:4px 0 0 4px">Data</td>
              <td style="padding:8px 12px;border:1px solid #e5e7eb">${startStr}</td>
            </tr>
          </table>
          <p style="color:#6b7280;font-size:13px">L'evento è stato rimosso dal tuo calendario.</p>
        </div>
      </div>`
    : `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
        <div style="background:#2563eb;color:#fff;padding:16px 24px;border-radius:8px 8px 0 0">
          <h2 style="margin:0;font-size:18px">Invito: ${esc(data.title)}</h2>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px">
          <p>Salve ${esc(to.name)},</p>
          <p>${esc(data.organizerName)} ti ha invitato a un appuntamento.</p>
          <table style="border-collapse:collapse;width:100%;margin:16px 0">
            <tr>
              <td style="padding:8px 12px;background:#f3f4f6;font-weight:600;white-space:nowrap;border-radius:4px 0 0 4px">Inizio</td>
              <td style="padding:8px 12px;border:1px solid #e5e7eb">${startStr}</td>
            </tr>
            <tr>
              <td style="padding:8px 12px;background:#f3f4f6;font-weight:600;white-space:nowrap">Fine</td>
              <td style="padding:8px 12px;border:1px solid #e5e7eb">${endStr} (${durationLabel})</td>
            </tr>
            ${locationRow}
            ${
              data.description
                ? `<tr>
              <td style="padding:8px 12px;background:#f3f4f6;font-weight:600;white-space:nowrap">Note</td>
              <td style="padding:8px 12px;border:1px solid #e5e7eb;white-space:pre-wrap">${esc(data.description)}</td>
            </tr>`
                : ""
            }
          </table>
          ${rsvpSection}
          <p style="color:#6b7280;font-size:12px;margin-top:24px">
            Il file .ics allegato ti permette di aggiungere l'evento al tuo calendario.
          </p>
        </div>
      </div>`;

  const icsMethod = isCancel ? "CANCEL" : "REQUEST";
  const result = await sendEmail({
    to: safe(to.email),
    subject,
    html,
    attachments: [
      {
        filename: "appuntamento.ics",
        content: data.icsContent,
        contentType: `text/calendar; method=${icsMethod}; charset=utf-8`,
      },
    ],
  });

  if (!result.success) {
    console.error("[EMAIL] Appointment invite failed to", to.email, result.error);
  }
  return result;
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
