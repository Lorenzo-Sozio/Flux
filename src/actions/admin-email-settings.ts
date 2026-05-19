"use server";

import { eq } from "drizzle-orm";

import { platformDb } from "@/db";
import { emailSettings } from "@/db/schema";
import { requireAdminPanelAccess } from "@/lib/auth-guard";
import type { EmailConfig } from "@/lib/email-provider";
import { getPlatformEmailConfig, testEmailConfig } from "@/lib/email-provider";
import { encryptSecret } from "@/lib/tenant-db";

export type AdminEmailSettingsRow = {
  id: string;
  provider: "resend" | "smtp";
  hasResendApiKey: boolean;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  hasSmtpPassword: boolean;
  smtpSecure: boolean | null;
  fromEmail: string;
  fromName: string;
};

export type SaveEmailSettingsInput = {
  provider: "resend" | "smtp";
  resendApiKey?: string; // empty = keep existing
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPassword?: string; // empty = keep existing
  smtpSecure?: boolean;
  fromEmail: string;
  fromName: string;
};

/** Returns the current platform email settings (sensitive fields are masked). */
export async function getAdminEmailSettings(): Promise<AdminEmailSettingsRow | null> {
  await requireAdminPanelAccess();

  const [row] = await platformDb.select().from(emailSettings).limit(1);
  if (!row) return null;

  return {
    id: row.id,
    provider: (row.provider as "resend" | "smtp") ?? "resend",
    hasResendApiKey: !!row.resendApiKey,
    smtpHost: row.smtpHost,
    smtpPort: row.smtpPort,
    smtpUser: row.smtpUser,
    hasSmtpPassword: !!row.smtpPassword,
    smtpSecure: row.smtpSecure,
    fromEmail: row.fromEmail,
    fromName: row.fromName,
  };
}

/** Upserts platform email settings. Empty secret fields keep their existing DB value. */
export async function saveAdminEmailSettings(input: SaveEmailSettingsInput): Promise<{ success: true }> {
  await requireAdminPanelAccess();

  if (!input.fromEmail?.trim()) throw new Error("From email is required.");
  if (!input.fromName?.trim()) throw new Error("From name is required.");

  const [existing] = await platformDb.select().from(emailSettings).limit(1);

  // Encrypt new secrets; keep existing encrypted value if none provided
  const rawResendKey = input.resendApiKey?.trim();
  const resendApiKey = rawResendKey ? encryptSecret(rawResendKey) : (existing?.resendApiKey ?? null);

  const rawSmtpPassword = input.smtpPassword?.trim();
  const smtpPassword = rawSmtpPassword ? encryptSecret(rawSmtpPassword) : (existing?.smtpPassword ?? null);

  const values = {
    provider: input.provider,
    resendApiKey,
    smtpHost: input.smtpHost?.trim() || null,
    smtpPort: input.smtpPort ?? 587,
    smtpUser: input.smtpUser?.trim() || null,
    smtpPassword,
    smtpSecure: input.smtpSecure ?? false,
    fromEmail: input.fromEmail.trim(),
    fromName: input.fromName.trim(),
    updatedAt: new Date(),
  };

  if (existing) {
    await platformDb.update(emailSettings).set(values).where(eq(emailSettings.id, existing.id));
  } else {
    await platformDb.insert(emailSettings).values({ ...values, id: crypto.randomUUID() });
  }

  return { success: true };
}

/** Sends a test email using the current saved platform config. */
export async function testAdminEmailSettings(testTo: string): Promise<{ success: boolean; error?: string }> {
  await requireAdminPanelAccess();

  if (!testTo?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testTo.trim())) {
    throw new Error("Invalid recipient email address.");
  }

  const config = await getPlatformEmailConfig();
  return testEmailConfig(config, testTo.trim());
}

/** Returns a sanitised version of the config for display (no secrets). */
export async function getAdminEmailConfigPreview(): Promise<{
  provider: string;
  fromEmail: string;
  fromName: string;
  configured: boolean;
}> {
  await requireAdminPanelAccess();

  const config: EmailConfig = await getPlatformEmailConfig();
  const configured = config.provider === "resend" ? !!config.resendApiKey : !!config.smtpHost && !!config.smtpUser;

  return {
    provider: config.provider,
    fromEmail: config.fromEmail,
    fromName: config.fromName,
    configured,
  };
}
