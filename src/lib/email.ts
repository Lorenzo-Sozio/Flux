/**
 * email.ts — system email helpers (auth, invitations, task reminders).
 * Campaign email is handled separately via email-provider + marketing.ts.
 */

import { createTranslator } from "next-intl";

import { getAppUrl } from "@/lib/app-url";
import { DOCUMENT_LOCALE, type DocumentLanguage, fill, INVOICE_TEXT, type InvoiceText } from "@/lib/document-language";
import {
  brandFrame,
  ctaButton,
  DEFAULT_BRAND_COLOR,
  type EmailBrand,
  type EmailKit,
  ibanBox,
  inkOn,
  summaryBox,
} from "@/lib/email-brand";
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
  /** "Ogni settimana il lunedì", when it repeats — in the recipient's language. */
  recurrenceText?: string | null;
  /** A change to an invitation already sent, rather than a first one. */
  isUpdate?: boolean;
}

/** The invitation's fixed words, in the language of whoever receives it. */
const INVITE_TEXT = {
  it: {
    invitation: "Invito",
    updated: "Invito aggiornato",
    cancelled: "Appuntamento annullato",
    subjectCancelled: "Annullato",
    hello: "Salve {name},",
    invited: "{organizer} ti ha invitato a un appuntamento.",
    changed: "{organizer} ha modificato un appuntamento a cui sei invitato.",
    cancelledBody: "l'appuntamento {title} è stato annullato da {organizer}.",
    removed: "L'evento è stato rimosso dal tuo calendario.",
    appointment: "Appuntamento",
    start: "Inizio",
    end: "Fine",
    date: "Data",
    recurrence: "Ricorrenza",
    place: "Luogo",
    notes: "Note",
    video: "Partecipa alla videochiamata",
    rsvp: "Conferma la tua partecipazione:",
    accept: "Accetto",
    tentative: "Forse",
    decline: "Non posso",
    ics: "Il file .ics allegato aggiunge l'evento al tuo calendario.",
    allDay: "tutto il giorno",
    file: "appuntamento.ics",
  },
  en: {
    invitation: "Invitation",
    updated: "Updated invitation",
    cancelled: "Appointment cancelled",
    subjectCancelled: "Cancelled",
    hello: "Hello {name},",
    invited: "{organizer} has invited you to an appointment.",
    changed: "{organizer} has changed an appointment you are invited to.",
    cancelledBody: "the appointment {title} has been cancelled by {organizer}.",
    removed: "The event has been removed from your calendar.",
    appointment: "Appointment",
    start: "Starts",
    end: "Ends",
    date: "Date",
    recurrence: "Repeats",
    place: "Where",
    notes: "Notes",
    video: "Join the video call",
    rsvp: "Let us know if you can make it:",
    accept: "Accept",
    tentative: "Maybe",
    decline: "Decline",
    ics: "The attached .ics file adds the event to your calendar.",
    allDay: "all day",
    file: "appointment.ics",
  },
} satisfies Record<DocumentLanguage, Record<string, string>>;

export interface InviteLayout {
  /** The workspace's identity: the frame, the colour of the buttons. Absent: a plain frame. */
  brand?: EmailBrand | null;
  /** The organiser's compact signature, already drawn. */
  signature?: string;
  /** The recipient's language: a customer's company decides it, a colleague reads Italian. */
  lang?: DocumentLanguage;
}

/** The three answers as buttons: the first in the brand colour, the others outlined. */
function rsvpButtons(
  brand: EmailBrand,
  links: { accept: string; decline: string; tentative: string },
  tx: (typeof INVITE_TEXT)[DocumentLanguage],
): string {
  const cell = (label: string, href: string, primary: boolean) =>
    `<td style="padding:0 8px 8px 0"><a href="${esc(safeHref(href))}" style="display:inline-block;padding:11px 20px;border-radius:8px;font-weight:600;font-size:14px;text-decoration:none;${
      primary
        ? `background:${brand.color};color:${inkOn(brand.color)};border:1px solid ${brand.color}`
        : "background:#ffffff;color:#1f2430;border:1px solid #cdd2dc"
    }">${esc(label)}</a></td>`;
  return `<p style="margin:0 0 10px;font-size:14px;color:#1f2430">${esc(tx.rsvp)}</p><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;margin:0 0 18px"><tr>${cell(tx.accept, links.accept, true)}${cell(tx.tentative, links.tentative, false)}${cell(tx.decline, links.decline, false)}</tr></table>`;
}

export async function sendAppointmentInviteEmail(
  to: { email: string; name: string },
  data: AppointmentEmailData,
  rsvpLinks?: { accept: string; decline: string; tentative: string },
  layout: InviteLayout = {},
): Promise<{ success: boolean; error?: string }> {
  const safe = (s: string) => sanitizeHeader(s);
  const lang = layout.lang ?? "it";
  const tx = INVITE_TEXT[lang];
  const locale = DOCUMENT_LOCALE[lang];
  // Without the workspace's identity (a caller that has none), the same frame in neutral colours.
  const brand: EmailBrand = layout.brand ?? {
    name: data.organizerName,
    color: DEFAULT_BRAND_COLOR,
    logoUrl: null,
    website: null,
    socials: [],
    address: null,
    vatNumber: null,
    phone: null,
    email: null,
  };

  const zone = data.timeZone ? { timeZone: data.timeZone } : {};
  const dayOpts = { weekday: "long", day: "numeric", month: "long", year: "numeric", ...zone } as const;
  // An all-day event ends at midnight after its last day; the last day is the one before.
  const lastDay = new Date(data.endAt.getTime() - 60_000);
  const startStr = data.allDay
    ? data.startAt.toLocaleDateString(locale, dayOpts)
    : data.startAt.toLocaleString(locale, { ...dayOpts, hour: "2-digit", minute: "2-digit" });
  const endStr = data.allDay
    ? lastDay.toLocaleDateString(locale, dayOpts)
    : data.endAt.toLocaleString(locale, { hour: "2-digit", minute: "2-digit", ...zone });
  const durationMin = Math.round((data.endAt.getTime() - data.startAt.getTime()) / 60_000);
  const durationLabel = data.allDay
    ? tx.allDay
    : durationMin < 60
      ? `${durationMin} min`
      : `${Math.floor(durationMin / 60)}h${durationMin % 60 ? ` ${durationMin % 60}min` : ""}`;

  const isCancel = data.method === "CANCEL";
  const heading = isCancel ? tx.cancelled : data.isUpdate ? tx.updated : tx.invitation;
  const subject = safe(`${isCancel ? tx.subjectCancelled : heading}: ${data.title}`);
  const hello = `<p style="margin:0 0 14px">${esc(fill(tx.hello, { name: to.name }))}</p>`;

  let body: string;
  if (isCancel) {
    body =
      hello +
      `<p style="margin:0 0 14px">${esc(fill(tx.cancelledBody, { title: data.title, organizer: data.organizerName }))}</p>` +
      summaryBox({
        tone: "warning",
        highlight: { label: tx.cancelled, value: data.title },
        rows: [[tx.date, startStr]],
      }) +
      `<p style="margin:0 0 18px;font-size:13px;color:#5d6475">${esc(tx.removed)}</p>`;
  } else {
    const place = data.location ?? data.locationUrl ?? null;
    const rows: [string, string][] = [
      [tx.start, startStr],
      [tx.end, `${endStr} (${durationLabel})`],
      ...(data.recurrenceText ? [[tx.recurrence, data.recurrenceText] as [string, string]] : []),
      ...(place ? [[tx.place, place] as [string, string]] : []),
      ...(data.description ? [[tx.notes, data.description] as [string, string]] : []),
    ];
    body =
      hello +
      `<p style="margin:0 0 14px">${esc(fill(data.isUpdate ? tx.changed : tx.invited, { organizer: data.organizerName }))}</p>` +
      summaryBox({ highlight: { label: tx.appointment, value: data.title }, rows }) +
      (data.conferenceLink
        ? `<div style="margin:0 0 18px">${ctaButton(brand, tx.video, data.conferenceLink)}</div>`
        : "") +
      (rsvpLinks ? rsvpButtons(brand, rsvpLinks, tx) : "") +
      `<p style="margin:0 0 18px;font-size:12px;color:#7a8192">${esc(tx.ics)}</p>`;
  }

  const html = brandFrame({
    brand,
    lang,
    label: heading,
    preheader: `${data.title} · ${startStr}`,
    body: body + (layout.signature ?? ""),
  });

  const icsMethod = isCancel ? "CANCEL" : "REQUEST";
  const result = await sendEmail({
    to: safe(to.email),
    subject,
    html,
    attachments: [
      {
        filename: tx.file,
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
export interface InvoiceCopyData {
  to: string;
  issuerName: string;
  documentType: "TD01" | "TD02" | "TD04";
  documentNumber: string;
  issueDate: string;
  total: string;
  dueDate: string | null;
  /** Paid in parts (I12): each installment's day and amount, already formatted in the document's currency. */
  installments?: { dueDate: string; amount: string }[] | null;
  /** Paid by bank transfer: where to, shown in a box of its own beside the figures. */
  iban?: string | null;
  lang: DocumentLanguage;
}

const day = (iso: string) => iso.split("-").reverse().join("/");

function invoiceLabel(tx: InvoiceText, documentType: string): string {
  return documentType === "TD04" ? tx.creditNote : documentType === "TD02" ? tx.depositInvoice : tx.invoice;
}

/**
 * The courtesy copy's subject and text, in the customer's language: what the email dialog opens
 * with (actions/invoices.ts `getInvoiceEmailDraftAction`) and what `sendInvoiceCopyEmail` sends
 * when nobody changed it. One source, so the two never say different things.
 *
 * The figures — the amount, the due date or the installments, the IBAN — are not in the text:
 * `invoiceCopyLayout` puts them in a box beside it, where they cannot be edited away.
 */
export function invoiceCopyContent(data: InvoiceCopyData): { subject: string; bodyHtml: string } {
  const tx = INVOICE_TEXT[data.lang];
  const label = invoiceLabel(tx, data.documentType);
  const body = fill(tx.emailBody, {
    label: esc(data.lang === "it" ? label.toLowerCase() : label),
    number: `<strong>${esc(data.documentNumber)}</strong>`,
    date: day(data.issueDate),
    total: `<strong>${esc(data.total)}</strong>`,
  });
  return {
    subject: `${label} ${tx.number} ${data.documentNumber} — ${data.issuerName}`,
    bodyHtml:
      `<p>${esc(tx.emailGreeting)}</p><p>${body}.</p>` +
      `<p>${esc(tx.emailSignoff)}<br>${esc(data.issuerName)}</p><p><em>${esc(tx.emailNotice)}</em></p>`,
  };
}

/**
 * The courtesy copy as it leaves: the workspace's frame, the person's text, then the amount with
 * its due date — or one line per installment — and the IBAN ready to copy, with the reference.
 * No personal signature: an invoice comes from the business.
 */
export function invoiceCopyLayout(data: Omit<InvoiceCopyData, "to">): (body: string, kit: EmailKit) => string {
  const tx = INVOICE_TEXT[data.lang];
  const label = invoiceLabel(tx, data.documentType);
  const several = data.installments && data.installments.length > 1;
  const rows: [string, string][] = several
    ? (data.installments ?? []).map((i, k) => [`${tx.installment} ${k + 1} · ${day(i.dueDate)}`, i.amount])
    : data.dueDate
      ? [[tx.due, day(data.dueDate)]]
      : [];
  return (body, { brand }) =>
    brandFrame({
      brand,
      lang: data.lang,
      label: `${label} ${data.documentNumber}`,
      preheader: fill(tx.emailPreheader, { label, number: data.documentNumber, total: data.total }),
      body:
        body +
        summaryBox({ highlight: { label: tx.amount, value: data.total }, rows }) +
        // A credit note is money going the other way: nothing to pay, no bank details.
        (data.iban && data.documentType !== "TD04"
          ? ibanBox({
              iban: data.iban,
              payee: data.issuerName,
              reference: `${label} ${data.documentNumber}`,
              lang: data.lang,
            })
          : ""),
    });
}

export async function sendInvoiceCopyEmail(
  data: InvoiceCopyData & {
    pdf: { filename: string; bytes: Uint8Array };
    replyTo?: string | null;
    brand: EmailBrand;
  },
) {
  const { subject, bodyHtml } = invoiceCopyContent(data);
  return sendEmail({
    to: sanitizeHeader(data.to),
    subject: sanitizeHeader(subject),
    html: invoiceCopyLayout(data)(bodyHtml, { brand: data.brand, signature: "", lang: data.lang }),
    ...(data.replyTo ? { replyTo: sanitizeHeader(data.replyTo) } : {}),
    attachments: [{ filename: data.pdf.filename, content: data.pdf.bytes, contentType: "application/pdf" }],
  });
}

// ─── Payment reminder ─────────────────────────────────────────────────────────

/**
 * A reminder that an invoice is overdue, in the customer's language, with the courtesy PDF.
 *
 * ⚠️ Polite by construction: it says what is owed and since when, how to pay, and that a
 * payment already made makes it void — a reminder crossing a transfer in the post is the
 * common case, not the exception.
 */
export interface PaymentReminderData {
  to: string;
  issuerName: string;
  documentType: "TD01" | "TD02";
  documentNumber: string;
  issueDate: string;
  dueDate: string;
  amount: string;
  /** Whole days since the due date, on the workspace's clock. */
  daysOverdue: number;
  iban?: string | null;
  /** Whether the courtesy PDF goes with it: the notice about it is said only then. */
  withPdf: boolean;
  lang: DocumentLanguage;
}

/** The reminder's subject and text, in the customer's language — the dialog's draft and the default send. */
export function paymentReminderContent(data: PaymentReminderData): { subject: string; bodyHtml: string } {
  const tx = INVOICE_TEXT[data.lang];
  const label = invoiceLabel(tx, data.documentType);
  const body = fill(tx.reminderBody, {
    label: esc(data.lang === "it" ? label.toLowerCase() : label),
    number: `<strong>${esc(data.documentNumber)}</strong>`,
    date: day(data.issueDate),
    due: day(data.dueDate),
    amount: `<strong>${esc(data.amount)}</strong>`,
  });
  return {
    subject: `${tx.reminderSubject} — ${label} ${tx.number} ${data.documentNumber} — ${data.issuerName}`,
    bodyHtml:
      `<p>${esc(tx.emailGreeting)}</p><p>${body}.</p>` +
      `<p>${esc(tx.reminderPaid)}</p><p>${esc(tx.reminderReply)}</p>` +
      `<p>${esc(tx.emailSignoff)}<br>${esc(data.issuerName)}</p>` +
      (data.withPdf ? `<p><em>${esc(tx.emailNotice)}</em></p>` : ""),
  };
}

/**
 * The reminder as it leaves: the frame, the person's text, an amber box — overdue since when,
 * how much, which invoice, the IBAN — and the sender's compact signature. Amber, not red: it is
 * a reminder, not a demand.
 */
export function paymentReminderLayout(
  data: Omit<PaymentReminderData, "to" | "withPdf">,
): (body: string, kit: EmailKit) => string {
  const tx = INVOICE_TEXT[data.lang];
  const label = invoiceLabel(tx, data.documentType);
  const iban = (data.iban ?? "").replace(/\s+/g, "").toUpperCase();
  const overdue =
    data.daysOverdue === 1 ? tx.reminderOverdueOne : fill(tx.reminderOverdue, { days: Math.max(0, data.daysOverdue) });
  return (body, { brand, signature }) =>
    brandFrame({
      brand,
      lang: data.lang,
      label: tx.reminderSubject,
      preheader: fill(tx.reminderPreheader, { label, number: data.documentNumber, due: day(data.dueDate) }),
      body:
        body +
        summaryBox({
          tone: "warning",
          highlight: { label: overdue, value: data.amount },
          rows: [
            [label, fill(tx.documentRow, { number: data.documentNumber, date: day(data.issueDate) })],
            [tx.due, day(data.dueDate)],
            ...(iban ? [["IBAN", iban.replace(/(.{4})/g, "$1 ").trim()] as [string, string]] : []),
          ],
        }) +
        signature,
    });
}

export async function sendPaymentReminderEmail(
  data: Omit<PaymentReminderData, "withPdf"> & {
    pdf: { filename: string; bytes: Uint8Array } | null;
    replyTo?: string | null;
    brand: EmailBrand;
  },
) {
  const { subject, bodyHtml } = paymentReminderContent({ ...data, withPdf: Boolean(data.pdf) });
  return sendEmail({
    to: sanitizeHeader(data.to),
    subject: sanitizeHeader(subject),
    html: paymentReminderLayout(data)(bodyHtml, { brand: data.brand, signature: "", lang: data.lang }),
    ...(data.replyTo ? { replyTo: sanitizeHeader(data.replyTo) } : {}),
    ...(data.pdf
      ? { attachments: [{ filename: data.pdf.filename, content: data.pdf.bytes, contentType: "application/pdf" }] }
      : {}),
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
