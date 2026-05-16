"use server";

import { redirect } from "next/navigation";

import bcrypt from "bcryptjs";
import { and, eq, gt } from "drizzle-orm";

import { platformDb } from "@/db";
import { passwordResetTokens, users } from "@/db/schema";
import { clearAdminSession, setAdminSession } from "@/lib/admin-session";
import { sendAdminOtpEmail } from "@/lib/email";

import { createHash, randomInt, timingSafeEqual } from "node:crypto";

type ActionResult = { error: string } | undefined;

function hashOtp(otp: string): string {
  return createHash("sha256").update(otp).digest("hex");
}

function safeCompare(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

function isAdminRole(role: string | null | undefined): role is "admin" | "owner" {
  return role === "admin" || role === "owner";
}

// ─── Admin Login (password OR OTP) ───────────────────────────────────────────

export async function adminLogin(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const email = (formData.get("email") as string)?.trim().toLowerCase();
  const mode = (formData.get("mode") as string) || "password";

  if (!email) return { error: "Inserisci l'indirizzo email." };

  const [user] = await platformDb.select().from(users).where(eq(users.email, email));

  if (!user || !isAdminRole(user.role)) {
    // Generic error — do not reveal whether the email exists
    return { error: "Credenziali non valide o permessi insufficienti." };
  }

  // ── OTP mode ──
  if (mode === "otp") {
    const otp = (formData.get("otp") as string)?.trim();
    if (!otp || !/^\d{6}$/.test(otp)) return { error: "Inserisci un codice OTP a 6 cifre." };

    const identifier = `admin_otp:${user.id}`;
    const [record] = await platformDb
      .select()
      .from(passwordResetTokens)
      .where(and(eq(passwordResetTokens.identifier, identifier), gt(passwordResetTokens.expires, new Date())));

    if (!record) return { error: "Codice scaduto o non trovato. Richiedi un nuovo codice." };
    if (!safeCompare(record.token, hashOtp(otp))) return { error: "Codice non valido." };

    // Invalidate immediately (one-time use)
    await platformDb.delete(passwordResetTokens).where(eq(passwordResetTokens.identifier, identifier));

    await setAdminSession(user.id, user.role);
    redirect("/admin/tenants");
  }

  // ── Password mode ──
  const password = formData.get("password") as string | null;
  if (!password?.trim()) return { error: "Inserisci la password." };

  if (!user.password) {
    return {
      error: "Questo account è autenticato tramite Google e non ha una password. Usa il codice OTP via email.",
    };
  }

  const isValid = await bcrypt.compare(password, user.password);
  if (!isValid) return { error: "Credenziali non valide o permessi insufficienti." };

  await setAdminSession(user.id, user.role);
  redirect("/admin/tenants");
}

// ─── Request OTP ──────────────────────────────────────────────────────────────

export async function requestAdminOtp(email: string): Promise<{ success: boolean; error?: string }> {
  const normalizedEmail = email.trim().toLowerCase();

  const [user] = await platformDb.select().from(users).where(eq(users.email, normalizedEmail));

  // Silently succeed when email not found or not admin — prevents email enumeration
  if (!user || !isAdminRole(user.role)) return { success: true };

  const otp = String(randomInt(100000, 1000000));
  const hashedOtp = hashOtp(otp);
  const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
  const identifier = `admin_otp:${user.id}`;

  // Replace any existing OTP for this user
  await platformDb.delete(passwordResetTokens).where(eq(passwordResetTokens.identifier, identifier));

  await platformDb.insert(passwordResetTokens).values({
    identifier,
    token: hashedOtp,
    expires,
  });

  const emailResult = await sendAdminOtpEmail(normalizedEmail, otp);
  if (!emailResult.success) {
    return { success: false, error: "Invio email non riuscito. Riprova tra qualche istante." };
  }

  return { success: true };
}

// ─── Admin Logout ─────────────────────────────────────────────────────────────

export async function adminLogout(): Promise<never> {
  await clearAdminSession();
  redirect("/admin/login");
}
