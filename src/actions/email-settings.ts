"use server";

import { revalidatePath } from "next/cache";

import { eq } from "drizzle-orm";

import { auth } from "@/auth";
import { emailSettings } from "@/db/schema";
import { type EmailConfig, testEmailConfig } from "@/lib/email-provider";
import { getDb } from "@/lib/tenant-context";

// ─── Load current settings (secrets masked) ───────────────────────────────────

export async function getEmailSettings() {
  const db = await getDb();
  const [row] = await db.select().from(emailSettings).limit(1);
  if (!row) {
    return {
      id: null as string | null,
      provider: (process.env.EMAIL_PROVIDER as "resend" | "smtp") ?? "resend",
      resendApiKey: process.env.RESEND_API_KEY ? "••••••••" : "",
      smtpHost: process.env.SMTP_HOST ?? "",
      smtpPort: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 587,
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
  const db = await getDb();
  const session = await auth();
  if (!session?.user) return { error: "Unauthorized" };

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
    await db.insert(emailSettings).values(payload as any);
  }

  revalidatePath("/dashboard/settings/email");
  return { success: true };
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
  const db = await getDb();
  const session = await auth();
  if (!session?.user?.email) return { error: "Unauthorized" };

  // If user left secrets as masked placeholder, load real values from DB
  let resolvedApiKey = data.resendApiKey;
  let resolvedPassword = data.smtpPassword;

  if (resolvedApiKey?.includes("•") || resolvedPassword?.includes("•")) {
    const [row] = await db.select().from(emailSettings).limit(1);
    if (row) {
      if (resolvedApiKey?.includes("•")) resolvedApiKey = row.resendApiKey ?? undefined;
      if (resolvedPassword?.includes("•")) resolvedPassword = row.smtpPassword ?? undefined;
    }
  }

  const config: EmailConfig = {
    provider: data.provider,
    resendApiKey: resolvedApiKey,
    smtpHost: data.smtpHost,
    smtpPort: data.smtpPort ?? 587,
    smtpUser: data.smtpUser,
    smtpPassword: resolvedPassword,
    smtpSecure: data.smtpSecure ?? false,
    fromEmail: data.fromEmail,
    fromName: data.fromName,
  };

  return testEmailConfig(config, data.testTo || session.user.email!);
}
