import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "admin_sess";
const TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

function sign(payload: string): string {
  return createHmac("sha256", process.env.AUTH_SECRET ?? "")
    .update(payload)
    .digest("hex");
}

function makeValue(userId: string): string {
  const issuedAt = Date.now().toString();
  const payload = `${userId}|${issuedAt}`;
  return `${payload}|${sign(payload)}`;
}

function parseValue(value: string): { userId: string } | null {
  const parts = value.split("|");
  if (parts.length !== 3) return null;

  const [userId, issuedAt, sig] = parts;
  const payload = `${userId}|${issuedAt}`;
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

  return { userId };
}

export async function setAdminSession(userId: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, makeValue(userId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/admin",
    maxAge: TTL_MS / 1000,
  });
}

export async function getAdminSession(): Promise<{ userId: string } | null> {
  const store = await cookies();
  const cookie = store.get(COOKIE_NAME);
  if (!cookie) return null;
  return parseValue(cookie.value);
}

export async function clearAdminSession(): Promise<void> {
  const store = await cookies();
  // Must match the same path used in setAdminSession so the browser targets
  // the correct path-scoped cookie (a bare delete() targets path "/" by default).
  store.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/admin",
    maxAge: 0,
  });
}
