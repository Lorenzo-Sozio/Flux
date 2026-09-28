/**
 * email.ts — system email helpers (auth, invitations, task reminders).
 * Campaign email is handled separately via email-provider + marketing.ts.
 */

import { createTranslator } from "next-intl";

import { getAppUrl } from "@/lib/app-url";
import { type DocumentLanguage, fill, INVOICE_TEXT } from "@/lib/document-language";
import { getPlatformEmailConfig, sendEmail } from "@/lib/email-provider";

// Resolved per call, not at import: `getAppUrl()` refuses to guess in production,
// and a module-scope call would make that refusal a build failure rather than a
// clear error on the request that was about to send a wrong link (rilievo B-04).
function appBase(): string {
  return getAppUrl();
}

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

// ─── Admin OTP ────────────────────────────────────────────────────────────────

export async function sendAdminOtpEmail(email: string, otp: string): Promise<{ success: boolean; error?: string }> {
  const config = await getPlatformEmailConfig();
  const result = await sendEmail(
    {
      to: sanitizeHeader(email),
      subject: "Codice di accesso al pannello admin — Flux CRM",
      html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#111827">Accesso pannello di amministrazione</h2>
        <p style="color:#374151">Usa il codice seguente per completare la verifica. Scade tra <strong>10 minuti</strong>.</p>
        <div style="margin:24px 0;padding:20px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;text-align:center">
          <span style="font-family:monospace;font-size:32px;font-weight:700;letter-spacing:8px;color:#111827">${otp}</span>
        </div>
        <p style="color:#6b7280;font-size:13px">Se non hai richiesto questo codice, ignora questa email. Il tuo account è al sicuro.</p>
      </div>`,
    },
    config,
  );

  if (!result.success) console.error("[EMAIL] Admin OTP send failed:", result.error);
  return result;
}

// ─── Password Reset ───────────────────────────────────────────────────────────

export async function sendPasswordResetEmail(
  email: string,
  token: string,
): Promise<{ success: boolean; error?: string }> {
  const resetUrl = `${appBase()}/auth/v1/reset-password?token=${token}&email=${encodeURIComponent(email)}`;
  const config = await getPlatformEmailConfig();
  const result = await sendEmail(
    {
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
    },
    config,
  );

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
  const inviteUrl = `${appBase()}/auth/v1/accept-invitation?token=${token}`;
  const safeName = esc(sanitizeHeader(invitedByName));
  const safeRole = esc(sanitizeHeader(role));
  const config = await getPlatformEmailConfig();

  const result = await sendEmail(
    {
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
    },
    config,
  );

  if (!result.success) {
    console.error("[EMAIL] Invitation send failed:", result.error);
  } else {
    console.log("[EMAIL] Invitation sent to", email, "| link:", inviteUrl);
  }

  return { ...result, inviteUrl };
}

// ─── Email Verification ───────────────────────────────────────────────────────

export async function sendVerificationEmail(email: string, token: string) {
  const verifyUrl = `${appBase()}/auth/verify-email?token=${token}&email=${encodeURIComponent(email)}`;

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

// ─── Activity Reminder ────────────────────────────────────────────────────────

/**
 * ⚠️ In the recipient's language and on the workspace's clock. It was English for everybody,
 * and dated with the server's zone — UTC on Workers — so a call at ten in Rome was announced
 * for eight. `locale` is what the person reads the product in (`readLocale`), English when
 * never seen; `timeZone` is the workspace's.
 */
export async function sendActivityReminderEmail(
  to: string,
  activityType: string,
  description: string,
  scheduledAt: Date,
  link: string,
  { locale, timeZone }: { locale?: "it" | "en" | null; timeZone?: string } = {},
) {
  if (!process.env.RESEND_API_KEY && !process.env.SMTP_HOST) {
    console.log("[DEV] Activity reminder email to:", to);
    return;
  }

  const lang = locale ?? "en";
  const messages =
    lang === "it" ? (await import("../../messages/it.json")).default : (await import("../../messages/en.json")).default;
  const t = createTranslator({ locale: lang, messages, namespace: "activityReminderEmail" } as never) as unknown as (
    key: string,
    values?: Record<string, string>,
  ) => string;
  const kind = { kind: activityType === "call" || activityType === "meeting" ? activityType : "other" };

  const dateStr = scheduledAt.toLocaleString(lang === "it" ? "it-IT" : "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });

  await sendEmail({
    to: sanitizeHeader(to),
    subject: sanitizeHeader(t("subject", { ...kind, description })),
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2>${esc(t("heading", kind))}</h2>
        <p>${esc(t("intro", kind))}</p>
        <table style="border-collapse:collapse;width:100%;margin:16px 0">
          <tr>
            <td style="padding:8px 12px;background:#f3f4f6;font-weight:600;white-space:nowrap">${esc(t("topic"))}</td>
            <td style="padding:8px 12px;border:1px solid #e5e7eb">${esc(description)}</td>
          </tr>
          <tr>
            <td style="padding:8px 12px;background:#f3f4f6;font-weight:600;white-space:nowrap">${esc(t("time"))}</td>
            <td style="padding:8px 12px;border:1px solid #e5e7eb">${esc(dateStr)}</td>
          </tr>
        </table>
        <a href="${appBase()}${link}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">
          ${esc(t("open"))}
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
  /**
   * The zone the times are written in. ⚠️ Without it they are formatted on the
   * server's clock, which on Workers is UTC: a ten o'clock meeting in Rome was
   * announced for eight.
   */
  timeZone?: string;
  allDay?: boolean;
  /** "Ogni settimana il lunedì", when it repeats. */
  recurrenceText?: string | null;
  /** A change to an invitation already sent, rather than a first one. */
  isUpdate?: boolean;
}

export async function sendAppointmentInviteEmail(
  to: { email: string; name: string },
  data: AppointmentEmailData,
  rsvpLinks?: { accept: string; decline: string; tentative: string },
): Promise<{ success: boolean; error?: string }> {
  const safe = (s: string) => sanitizeHeader(s);

  const zone = data.timeZone ? { timeZone: data.timeZone } : {};
  const dayOpts = { weekday: "long", day: "numeric", month: "long", year: "numeric", ...zone } as const;
  // An all-day event ends at midnight after its last day; the last day is the one before.
  const lastDay = new Date(data.endAt.getTime() - 60_000);
  const startStr = data.allDay
    ? data.startAt.toLocaleDateString("it-IT", dayOpts)
    : data.startAt.toLocaleString("it-IT", { ...dayOpts, hour: "2-digit", minute: "2-digit" });
  const endStr = data.allDay
    ? lastDay.toLocaleDateString("it-IT", dayOpts)
    : data.endAt.toLocaleString("it-IT", { hour: "2-digit", minute: "2-digit", ...zone });
  const durationMs = data.endAt.getTime() - data.startAt.getTime();
  const durationMin = Math.round(durationMs / 60_000);
  const durationLabel = data.allDay
    ? "tutto il giorno"
    : durationMin < 60
      ? `${durationMin} min`
      : `${Math.floor(durationMin / 60)}h${durationMin % 60 ? ` ${durationMin % 60}min` : ""}`;

  const isCancel = data.method === "CANCEL";
  const subject = isCancel
    ? safe(`Cancelled: ${data.title}`)
    : data.isUpdate
      ? safe(`Updated invitation: ${data.title}`)
      : safe(`Invitation: ${data.title}`);

  const recurrenceRow = data.recurrenceText
    ? `<tr>
        <td style="padding:8px 12px;background:#f3f4f6;font-weight:600;white-space:nowrap">Ricorrenza</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb">${esc(data.recurrenceText)}</td>
      </tr>`
    : "";

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
          <h2 style="margin:0;font-size:18px">${data.isUpdate ? "Invito aggiornato" : "Invito"}: ${esc(data.title)}</h2>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px">
          <p>Salve ${esc(to.name)},</p>
          <p>${
            data.isUpdate
              ? `${esc(data.organizerName)} ha modificato un appuntamento a cui sei invitato.`
              : `${esc(data.organizerName)} ti ha invitato a un appuntamento.`
          }</p>
          <table style="border-collapse:collapse;width:100%;margin:16px 0">
            <tr>
              <td style="padding:8px 12px;background:#f3f4f6;font-weight:600;white-space:nowrap;border-radius:4px 0 0 4px">Inizio</td>
              <td style="padding:8px 12px;border:1px solid #e5e7eb">${startStr}</td>
            </tr>
            <tr>
              <td style="padding:8px 12px;background:#f3f4f6;font-weight:600;white-space:nowrap">Fine</td>
              <td style="padding:8px 12px;border:1px solid #e5e7eb">${endStr} (${durationLabel})</td>
            </tr>
            ${recurrenceRow}
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

// ─── Invoice courtesy copy ────────────────────────────────────────────────────

/**
 * The courtesy copy of an issued invoice, as a PDF attachment.
 *
 * ⚠️ Sent through the workspace's own email settings, from the workspace's own
 * address: the customer is receiving an invoice from their supplier, not from Flux.
 * The body repeats that the PDF has no fiscal value, because the attachment is the
 * part that gets forwarded to an accountant on its own.
 */
export async function sendInvoiceCopyEmail(data: {
  to: string;
  issuerName: string;
  documentType: "TD01" | "TD04";
  documentNumber: string;
  issueDate: string;
  total: string;
  dueDate: string | null;
  pdf: { filename: string; bytes: Uint8Array };
  replyTo?: string | null;
  lang: DocumentLanguage;
}) {
  const tx = INVOICE_TEXT[data.lang];
  const day = (iso: string) => iso.split("-").reverse().join("/");
  const label = data.documentType === "TD04" ? tx.creditNote : tx.invoice;
  const body =
    fill(tx.emailBody, {
      label: esc(data.lang === "it" ? label.toLowerCase() : label),
      number: `<strong>${esc(data.documentNumber)}</strong>`,
      date: day(data.issueDate),
      total: `<strong>${esc(data.total)}</strong>`,
    }) + (data.dueDate ? fill(tx.emailDue, { date: esc(day(data.dueDate)) }) : "");
  const html = `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#111827">
        <p>${esc(tx.emailGreeting)}</p>
        <p>${body}.</p>
        <p>${esc(tx.emailSignoff)}<br>${esc(data.issuerName)}</p>
        <p style="color:#6b7280;font-size:12px;margin-top:24px;border-top:1px solid #e5e7eb;padding-top:12px">
          ${esc(tx.emailNotice)}
        </p>
      </div>`;

  return sendEmail({
    to: sanitizeHeader(data.to),
    subject: sanitizeHeader(`${label} ${tx.number} ${data.documentNumber} — ${data.issuerName}`),
    html,
    ...(data.replyTo ? { replyTo: sanitizeHeader(data.replyTo) } : {}),
    attachments: [{ filename: data.pdf.filename, content: data.pdf.bytes, contentType: "application/pdf" }],
  });
}

// ─── Workspace request (to Flux's own staff) ─────────────────────────────────

export async function sendWorkspaceRequestEmail(
  staff: string[],
  person: { name: string | null; email: string },
): Promise<void> {
  const config = await getPlatformEmailConfig();
  const who = person.name ? `${esc(person.name)} &lt;${esc(person.email)}&gt;` : esc(person.email);
  // One message per person: a comma-joined `to` is one malformed address to some providers.
  const results = await Promise.all(
    staff.map((to) =>
      sendEmail(
        {
          to: sanitizeHeader(to),
          subject: sanitizeHeader(`Nuovo account senza workspace: ${person.email}`),
          html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
        <h2 style="color:#111827">Qualcuno aspetta un workspace</h2>
        <p style="color:#374151">${who} si è appena registrato e non fa parte di nessun workspace.
        Finché non ne viene creato uno, o non riceve un invito, vede solo la pagina che gli dice di aspettare.</p>
        <p style="color:#374151">Se è un collaboratore di un cliente, basta un invito dal workspace del cliente.
        Se è un cliente nuovo, crea il workspace dal pannello di amministrazione e aggiungilo come proprietario.</p>
        <p style="margin:24px 0"><a href="${appBase()}/admin/tenants" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">Apri il pannello</a></p>
      </div>`,
        },
        config,
      ),
    ),
  );
  const failed = results.filter((r) => !r.success);
  if (failed.length === results.length) throw new Error(failed[0]?.error ?? "workspace request email not sent");
}
