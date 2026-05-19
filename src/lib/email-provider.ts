/**
 * email-provider.ts — unified email sending abstraction.
 * Supports Resend (API) and SMTP (nodemailer).
 * Config is loaded from DB (email_settings table), falling back to env vars.
 */

import { emailSettings } from "@/db/schema";
import { getDb } from "@/lib/tenant-context";

export interface EmailConfig {
  provider: "resend" | "smtp";
  resendApiKey?: string | null;
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpUser?: string | null;
  smtpPassword?: string | null;
  smtpSecure?: boolean | null;
  fromEmail: string;
  fromName: string;
}

export interface EmailAttachment {
  filename: string;
  content: string; // UTF-8 text content
  contentType: string; // e.g. 'text/calendar; method=REQUEST'
}

export interface SendOptions {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  fromOverride?: string;
  inReplyTo?: string; // Message-ID of the message being replied to
  references?: string; // Space-separated chain of Message-IDs for thread history
  attachments?: EmailAttachment[];
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

// ─── Config loader ────────────────────────────────────────────────────────────

export async function getEmailConfig(): Promise<EmailConfig> {
  const db = await getDb();
  try {
    const [row] = await db.select().from(emailSettings).limit(1);
    if (row) {
      return {
        provider: (row.provider as "resend" | "smtp") ?? "resend",
        resendApiKey: row.resendApiKey,
        smtpHost: row.smtpHost,
        smtpPort: row.smtpPort,
        smtpUser: row.smtpUser,
        smtpPassword: row.smtpPassword,
        smtpSecure: row.smtpSecure,
        fromEmail: row.fromEmail,
        fromName: row.fromName,
      };
    }
  } catch {
    // table may not exist yet — fall through to env vars
  }

  // Fallback to environment variables
  return {
    provider: (process.env.EMAIL_PROVIDER as "resend" | "smtp") ?? "resend",
    resendApiKey: process.env.RESEND_API_KEY,
    smtpHost: process.env.SMTP_HOST,
    smtpPort: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587,
    smtpUser: process.env.SMTP_USER,
    smtpPassword: process.env.SMTP_PASSWORD,
    smtpSecure: process.env.SMTP_SECURE === "true",
    fromEmail: process.env.EMAIL_FROM_ADDRESS ?? "noreply@yourdomain.com",
    fromName: process.env.EMAIL_FROM_NAME ?? "CRM",
  };
}

// ─── Main send function ───────────────────────────────────────────────────────

export async function sendEmail(options: SendOptions, configOverride?: EmailConfig): Promise<SendResult> {
  const config = configOverride ?? (await getEmailConfig());

  if (config.provider === "smtp") {
    return sendViaSMTP(options, config);
  }
  return sendViaResend(options, config);
}

// ─── Resend ───────────────────────────────────────────────────────────────────

async function sendViaResend(options: SendOptions, config: EmailConfig): Promise<SendResult> {
  const apiKey = config.resendApiKey ?? process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.warn("[EMAIL] Resend API key not configured. Email not sent to:", options.to);
    return {
      success: false,
      error:
        "Resend API key not configured. Set RESEND_API_KEY in your environment or configure an email provider in Settings → Email.",
    };
  }

  try {
    const { Resend } = await import("resend");
    const resend = new Resend(apiKey);
    const from = options.fromOverride ?? `${config.fromName} <${config.fromEmail}>`;

    const threadHeaders: Record<string, string> = {};
    if (options.inReplyTo) threadHeaders["In-Reply-To"] = options.inReplyTo;
    if (options.references) threadHeaders.References = options.references;

    const resendAttachments = options.attachments?.map((a) => ({
      filename: a.filename,
      content: Buffer.from(a.content, "utf-8"),
    }));

    const { data, error } = await resend.emails.send({
      from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      ...(options.replyTo ? { replyTo: options.replyTo } : {}),
      ...(Object.keys(threadHeaders).length ? { headers: threadHeaders } : {}),
      ...(resendAttachments?.length ? { attachments: resendAttachments } : {}),
    });

    if (error) return { success: false, error: error.message };
    return { success: true, messageId: data?.id ?? undefined };
  } catch (err: any) {
    return { success: false, error: err?.message ?? "Resend error" };
  }
}

// ─── SMTP (nodemailer) ────────────────────────────────────────────────────────

async function sendViaSMTP(options: SendOptions, config: EmailConfig): Promise<SendResult> {
  if (!config.smtpHost) {
    return { success: false, error: "SMTP host not configured." };
  }

  try {
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort ?? 587,
      secure: config.smtpSecure ?? false,
      ...(config.smtpUser ? { auth: { user: config.smtpUser, pass: config.smtpPassword ?? "" } } : {}),
    });

    const from = options.fromOverride ?? `"${config.fromName}" <${config.fromEmail}>`;
    const smtpAttachments = options.attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType,
    }));

    const info = await transporter.sendMail({
      from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      ...(options.replyTo ? { replyTo: options.replyTo } : {}),
      ...(options.inReplyTo ? { inReplyTo: options.inReplyTo } : {}),
      ...(options.references ? { references: options.references } : {}),
      ...(smtpAttachments?.length ? { attachments: smtpAttachments } : {}),
    });

    return { success: true, messageId: info.messageId };
  } catch (err: any) {
    return { success: false, error: err?.message ?? "SMTP error" };
  }
}

// ─── Test connection ──────────────────────────────────────────────────────────

export async function testEmailConfig(config: EmailConfig, testTo: string): Promise<SendResult> {
  if (config.provider === "smtp") {
    // Verify SMTP connection first
    try {
      const nodemailer = await import("nodemailer");
      const transporter = nodemailer.createTransport({
        host: config.smtpHost ?? "",
        port: config.smtpPort ?? 587,
        secure: config.smtpSecure ?? false,
        ...(config.smtpUser ? { auth: { user: config.smtpUser, pass: config.smtpPassword ?? "" } } : {}),
      });
      await transporter.verify();
    } catch (err: any) {
      return { success: false, error: `SMTP connection failed: ${err?.message}` };
    }
  }

  return sendEmail(
    {
      to: testTo,
      subject: "✅ Email configuration test",
      html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2>Email test successful</h2>
        <p>Your email provider (<strong>${config.provider.toUpperCase()}</strong>) is correctly configured.</p>
        <p style="color:#6b7280;font-size:13px">Sent from Flux CRM</p>
      </div>`,
    },
    config,
  );
}
