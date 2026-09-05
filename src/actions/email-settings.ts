"use server";

import { revalidatePath } from "next/cache";

import { eq } from "drizzle-orm";

import { emailSettings } from "@/db/schema";
import { requireCapability } from "@/lib/auth-guard";
import { type EmailConfig, testEmailConfig } from "@/lib/email-provider";
import { chooseTestTarget } from "@/lib/email-test-target";
import { getDb } from "@/lib/tenant-context";

// ─── Load current settings (secrets masked) ───────────────────────────────────

export async function getEmailSettings() {
  // Reading is guarded too: the row names the provider, the sending address and
  // the host, which is reconnaissance for the write path below.
  await requireCapability("settings:manage");
  const db = await getDb();
  const [row] = await db.select().from(emailSettings).limit(1);
  if (!row) {
    return {
      id: null as string | null,
      provider: (process.env.EMAIL_PROVIDER as "resend" | "smtp") ?? "resend",
      resendApiKey: process.env.RESEND_API_KEY ? "••••••••" : "",
      smtpHost: process.env.SMTP_HOST ?? "",
      smtpPort: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587,
      smtpUser: process.env.SMTP_USER ?? "",
      smtpPassword: process.env.SMTP_PASSWORD ? "••••••••" : "",
      smtpSecure: process.env.SMTP_SECURE === "true",
      fromEmail: process.env.EMAIL_FROM_ADDRESS ?? "noreply@yourdomain.com",
      fromName: process.env.EMAIL_FROM_NAME ?? "CRM",
    };
  }
  return {
    ...row,
    resendApiKey: row.resendApiKey ? "••••••••" : "",
    smtpPassword: row.smtpPassword ? "••••••••" : "",
  };
}

// ─── Save settings ────────────────────────────────────────────────────────────

export async function saveEmailSettings(data: {
  provider: "resend" | "smtp";
  resendApiKey?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPassword?: string;
  smtpSecure?: boolean;
  fromEmail: string;
  fromName: string;
}) {
  // ⚠️ This checked only that a session existed, so any member of the workspace —
  // a read-only viewer included — could rewrite the credentials the whole
  // workspace sends mail with.
  await requireCapability("settings:manage");
  const db = await getDb();

  const base = {
    provider: data.provider,
    fromEmail: data.fromEmail,
    fromName: data.fromName,
    smtpHost: data.smtpHost || null,
    smtpPort: data.smtpPort ?? 587,
    smtpUser: data.smtpUser || null,
    smtpSecure: data.smtpSecure ?? false,
  };

  // Only persist secrets when the user typed a real value (not the masked placeholder)
  const secrets: Record<string, string | null> = {};
  if (data.resendApiKey && !data.resendApiKey.includes("•")) secrets.resendApiKey = data.resendApiKey;
  if (data.smtpPassword && !data.smtpPassword.includes("•")) secrets.smtpPassword = data.smtpPassword;
  if (data.smtpPassword === "") secrets.smtpPassword = null;
  if (data.resendApiKey === "") secrets.resendApiKey = null;

  const payload = { ...base, ...secrets };

  const [existing] = await db.select({ id: emailSettings.id }).from(emailSettings).limit(1);

  if (existing) {
    await db
      .update(emailSettings)
      .set({ ...payload, updatedAt: new Date() })
      .where(eq(emailSettings.id, existing.id));
  } else {
    await db.insert(emailSettings).values(payload);
  }

  revalidatePath("/dashboard/settings/email");
  return { success: true as const };
}

// ─── Test connection ──────────────────────────────────────────────────────────

export async function testEmailConnection(data: {
  provider: "resend" | "smtp";
  resendApiKey?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPassword?: string;
  smtpSecure?: boolean;
  fromEmail: string;
  fromName: string;
  testTo: string;
}) {
  const actor = await requireCapability("settings:manage");
  const db = await getDb();

  // ⚠️⚠️ **A masked secret means "use the one you have", and that is the whole
  // stored configuration, not this one field of it.**
  //
  // This used to take the host, the user and the port from the caller and fill in
  // only the password from the database. Anyone with a session could therefore
  // post their own `smtpHost` together with the mask and have the server open a
  // connection to them carrying the workspace's real password — the same trick
  // reads back the Resend key. It was authenticated credential exfiltration, and
  // it looked like a button called "Send test email".
  // Which configuration to test is a rule with three answers and one dangerous
  // mistake, so it lives in a module that can be tested without a mail server.
  const [row] = await db.select().from(emailSettings).limit(1);
  const target = chooseTestTarget(
    data,
    row ? { provider: row.provider, smtpHost: row.smtpHost, smtpPort: row.smtpPort, smtpUser: row.smtpUser } : null,
  );

  if (target.use === "refuse") {
    return {
      error:
        target.reason === "no-stored-config"
          ? "There is no saved configuration to test."
          : "You have changed the server, so its password has to be typed in before it can be tested. " +
            "The saved one belongs to the previous server.",
    };
  }

  const config: EmailConfig =
    target.use === "stored" && row
      ? {
          provider: row.provider as EmailConfig["provider"],
          resendApiKey: row.resendApiKey ?? undefined,
          smtpHost: row.smtpHost ?? undefined,
          smtpPort: row.smtpPort ?? 587,
          smtpUser: row.smtpUser ?? undefined,
          smtpPassword: row.smtpPassword ?? undefined,
          smtpSecure: row.smtpSecure ?? false,
          fromEmail: row.fromEmail,
          fromName: row.fromName,
        }
      : {
          provider: data.provider,
          resendApiKey: data.resendApiKey,
          smtpHost: data.smtpHost,
          smtpPort: data.smtpPort ?? 587,
          smtpUser: data.smtpUser,
          smtpPassword: data.smtpPassword,
          smtpSecure: data.smtpSecure ?? false,
          fromEmail: data.fromEmail,
          fromName: data.fromName,
        };

  // The test message goes to the person who asked for it, never to an address
  // supplied alongside someone else's credentials.
  const recipient = actor.email ?? data.testTo;
  if (!recipient) return { error: "No address to send the test to." };
  return testEmailConfig(config, recipient);
}
