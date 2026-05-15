"use server";

import { createHash, timingSafeEqual, randomInt } from "node:crypto";
import { auth } from "@/auth";
import { platformDb } from "@/db";
import { users, passwordResetTokens } from "@/db/schema";
import { and, eq, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { setAdminSession, clearAdminSession } from "@/lib/admin-session";
import { sendAdminOtpEmail } from "@/lib/email";
import { redirect } from "next/navigation";

type ActionResult = { error: string } | undefined;

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

async function getSessionAsAdmin() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const role = (session.user as { role?: string }).role;
  if (role !== "admin" && role !== "owner") return null;
  return session;
}

// ─── Admin Login (password OR OTP) ───────────────────────────────────────────

export async function adminLogin(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const session = await getSessionAsAdmin();
  if (!session) return { error: "Non autenticato o ruolo insufficiente." };

  const mode = (formData.get("mode") as string) || "password";

  // ── OTP mode ──
  if (mode === "otp") {
    const otp = (formData.get("otp") as string)?.trim();
    if (!otp || !/^\d{6}$/.test(otp)) return { error: "Inserisci un codice OTP a 6 cifre." };

    const identifier = `admin_otp:${session.user.id}`;
    const [record] = await platformDb
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.identifier, identifier),
          gt(passwordResetTokens.expires, new Date()),
        ),
      );

    if (!record) return { error: "Codice scaduto o non trovato. Richiedi un nuovo codice." };
    if (!safeCompare(record.token, hashOtp(otp))) return { error: "Codice non valido." };

    // Invalidate immediately (one-time use)
    await platformDb
      .delete(passwordResetTokens)
      .where(eq(passwordResetTokens.identifier, identifier));

    await setAdminSession(session.user.id!);
    redirect("/admin/tenants");
  }

  // ── Password mode ──
  const password = formData.get("password") as string | null;
  if (!password?.trim()) return { error: "Inserisci la password." };

  const [user] = await platformDb
    .select({ password: users.password })
    .from(users)
    .where(eq(users.id, session.user.id!));

  if (!user) return { error: "Utente non trovato." };

  if (!user.password) {
    return {
      error:
        "Questo account utilizza Google per l'autenticazione e non ha una password. Usa il codice OTP via email.",
    };
  }

  const isValid = await bcrypt.compare(password, user.password);
  if (!isValid) return { error: "Password non corretta." };

  await setAdminSession(session.user.id!);
  redirect("/admin/tenants");
}

// ─── Request OTP (Google-only admins) ────────────────────────────────────────

export async function requestAdminOtp(): Promise<{ success: boolean; error?: string }> {
  const session = await getSessionAsAdmin();
  if (!session) return { success: false, error: "Non autenticato o ruolo insufficiente." };

  const email = session.user.email;
  if (!email) return { success: false, error: "Email non disponibile." };

  // Generate 6-digit OTP using CSPRNG (100000–999999 inclusive)
  const otp = String(randomInt(100000, 1000000));
  const hashedOtp = hashOtp(otp);
  const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
  const identifier = `admin_otp:${session.user.id}`;

  // Replace any existing OTP for this user
  await platformDb
    .delete(passwordResetTokens)
    .where(eq(passwordResetTokens.identifier, identifier));

  await platformDb.insert(passwordResetTokens).values({
    identifier,
    token: hashedOtp,
    expires,
  });

  const emailResult = await sendAdminOtpEmail(email, otp);
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
