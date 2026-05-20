import { cookies } from "next/headers";

import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "admin_sess";
const TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

function getSigningKey(): string {
  const dedicated = process.env.ADMIN_SESSION_SECRET;
  if (dedicated) return dedicated;

  // In production, a dedicated key is required so admin session cookies can be
  // rotated independently of the NextAuth JWT secret.
  if (process.env.NODE_ENV === "production") {
    throw new Error("ADMIN_SESSION_SECRET must be set in production. " + "Generate one with: openssl rand -base64 32");
  }

  // In development, fall back to AUTH_SECRET with a visible warning.
  const fallback = process.env.AUTH_SECRET ?? "";
  console.warn(
    "[admin-session] ADMIN_SESSION_SECRET is not set — falling back to AUTH_SECRET. " +
      "Set ADMIN_SESSION_SECRET in production.",
  );
  return fallback;
}

function sign(payload: string): string {
  return createHmac("sha256", getSigningKey()).update(payload).digest("hex");
}

// Cookie format: {userId}|{role}|{issuedAt}|{hmac}
function makeValue(userId: string, role: string): string {
  const issuedAt = Date.now().toString();
  const payload = `${userId}|${role}|${issuedAt}`;
  return `${payload}|${sign(payload)}`;
}

function parseValue(value: string): { userId: string; role: string } | null {
  const parts = value.split("|");
  if (parts.length !== 4) return null;

  const [userId, role, issuedAt, sig] = parts;
  const payload = `${userId}|${role}|${issuedAt}`;
  const expectedSig = sign(payload);

  try {
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expectedSig, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  const ts = parseInt(issuedAt, 10);
  if (Number.isNaN(ts) || Date.now() - ts > TTL_MS) return null;

  return { userId, role };
}

export async function setAdminSession(userId: string, role: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, makeValue(userId, role), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: TTL_MS / 1000,
  });
}

export async function getAdminSession(): Promise<{ userId: string; role: string } | null> {
  const store = await cookies();
  const cookie = store.get(COOKIE_NAME);
  if (!cookie) return null;
  return parseValue(cookie.value);
}

export async function clearAdminSession(): Promise<void> {
  const store = await cookies();
  // Clear current path
  store.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  // Also clear the legacy /admin-scoped cookie (set before the path was broadened)
  store.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/admin",
    maxAge: 0,
  });
}
